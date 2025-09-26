from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.timezone import make_aware
from django.conf import settings
from typing import Optional
from datetime import date, datetime
from dateutil.relativedelta import relativedelta
import logging, traceback

from rest_framework import viewsets, generics, serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter
from rest_framework.permissions import IsAuthenticated

from api.models import Indicador, Preenchimento, Meta, MetaMensal, PermissaoIndicador
from api.serializers import (
    IndicadorSerializer,
    MetaSerializer,
    MetaMensalSerializer
)
from api.utils import registrar_log
from api.permissions import IsMasterUser, HasIndicadorPermission
from api.utils.periodicidade import mes_alinhado, meses_permitidos

logger = logging.getLogger(__name__)

# -------------------------
# Helpers seguros
# -------------------------
def _to_float(v):
    from decimal import Decimal
    if v is None:
        return None
    if isinstance(v, Decimal):
        try:
            return float(v)
        except Exception:
            return None
    try:
        return float(v)
    except Exception:
        return None

def _to_iso(dt):
    if not dt:
        return None
    try:
        return dt.isoformat()
    except Exception:
        return str(dt)

def _ts_or_0(dt):
    if not dt:
        return 0.0
    try:
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt.timestamp()
    except Exception:
        return 0.0

def _ym_key(d):  # YYYY-MM
    try:
        return d.strftime("%Y-%m")
    except Exception:
        return None

def _ymd(d):     # YYYY-MM-DD
    try:
        return d.strftime("%Y-%m-%d")
    except Exception:
        return None

def _safe_file_url(request, fieldfile):
    """
    Retorna uma URL segura para o arquivo:
    - tenta fieldfile.url → absoluto
    - fallback para str(fieldfile) se for uma URL http/https
    - caso contrário, None
    NUNCA levanta exceção.
    """
    if not fieldfile:
        return None
    # 1) Tenta .url
    try:
        url = fieldfile.url
        # se vier relativo, torna absoluto
        try:
            return request.build_absolute_uri(url)
        except Exception:
            return url
    except Exception:
        pass
    # 2) Fallback: nome bruto pode ser uma URL completa se você salvou string
    try:
        raw = str(fieldfile)
        if raw and (raw.startswith("http://") or raw.startswith("https://")):
            return raw
    except Exception:
        pass
    return None

# -------------------------
# Helpers de mês/backfill  👇 ADD
# -------------------------
def _first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)

def _last_month_first_day(today: Optional[date] = None) -> date:
    """Retorna o 1º dia do mês anterior ao mês atual."""
    t = today or date.today()
    return _first_of_month(t) - relativedelta(months=1)

def _backfill_preenchimentos_zero(indicador, autor):
    """
    Cria Preenchimento(valor_realizado=0) apenas nos meses alinhados
    à periodicidade/âncora, do mes_inicial até (mês atual - 1). Idempotente.
    """
    if not getattr(indicador, "mes_inicial", None):
        return 0

    limite = _last_month_first_day()
    if limite < _first_of_month(indicador.mes_inicial):
        return 0

    # (ano, mes) já existentes para este indicador (independente do usuário)
    existentes = set(
        Preenchimento.objects.filter(indicador=indicador)
        .values_list("ano", "mes")
    )

    # 👇 meses alinhados (YYYY-MM-01) até o limite
    permitidos = meses_permitidos(indicador, ate=limite)

    to_create = []
    for d in sorted(permitidos):
        chave = (d.year, d.month)
        if chave not in existentes:
            to_create.append(Preenchimento(
                indicador=indicador,
                ano=d.year,
                mes=d.month,
                valor_realizado=0,
                preenchido_por=autor,
                data_preenchimento=make_aware(datetime(d.year, d.month, 1, 0, 0, 0)),
                origem="backfill-auto",
            ))

    if to_create:
        Preenchimento.objects.bulk_create(to_create, ignore_conflicts=True)
    return len(to_create)

# =========================
#       INDICADORES
# =========================
class IndicadorViewSet(viewsets.ModelViewSet):
    serializer_class = IndicadorSerializer
    permission_classes = [IsAuthenticated, HasIndicadorPermission]

    def get_queryset(self):
        usuario = self.request.user
        qs = (
            Indicador.objects
            .select_related('setor')
        )

        if getattr(usuario, "perfil", None) != 'master':
            ids_perm_manuais = PermissaoIndicador.objects.filter(
                usuario=usuario
            ).values_list('indicador_id', flat=True)

            qs = qs.filter(
                Q(setor__in=usuario.setores.all()) |
                Q(visibilidade=True) |
                Q(id__in=ids_perm_manuais)
            ).distinct()

        # ---- filtros opcionais ----
        somente_preenchidos = self.request.query_params.get('somente_preenchidos')
        apenas_meus = self.request.query_params.get('apenas_meus')
        mes = self.request.query_params.get('mes')
        ano = self.request.query_params.get('ano')

        pchs = Preenchimento.objects.filter(valor_realizado__isnull=False)

        if mes:
            try:
                pchs = pchs.filter(mes=int(mes))
            except ValueError:
                pass
        if ano:
            try:
                pchs = pchs.filter(ano=int(ano))
            except ValueError:
                pass
        if str(apenas_meus).lower() in ('1', 'true', 't', 'yes', 'y'):
            pchs = pchs.filter(preenchido_por=usuario)
        if str(somente_preenchidos).lower() in ('1', 'true', 't', 'yes', 'y'):
            ids = pchs.values_list('indicador_id', flat=True).distinct()
            qs = qs.filter(id__in=ids)

        # ✅ Prefetch consistente
        return qs.prefetch_related('metas_mensais', 'preenchimentos')

    @action(detail=False, methods=['get'], url_path='meus')
    def meus_indicadores(self, request):
        user = request.user
        qs = self.get_queryset()
        if user.perfil == "gestor":
            qs = qs.filter(setor__in=user.setores.all())
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        try:
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            indicador = serializer.save()
            indicador = Indicador.objects.select_related('setor').get(pk=indicador.pk)
            data = self.get_serializer(indicador).data
            registrar_log(request.user, f"Cadastrou o indicador '{data.get('nome')}'")
            headers = self.get_success_headers(serializer.validated_data)
            return Response(data, status=status.HTTP_201_CREATED, headers=headers)
        except serializers.ValidationError:
            raise
        except Exception as e:
            logger.exception("Falha ao criar indicador")
            return Response({"detail": f"Falha ao criar indicador: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        parcial = kwargs.pop('partial', False)
        indicador = self.get_object()
        nome_anterior = indicador.nome
        serializer = self.get_serializer(indicador, data=request.data, partial=parcial)
        serializer.is_valid(raise_exception=True)
        indicador_atualizado = serializer.save()
        registrar_log(request.user, f"Editou o indicador '{nome_anterior}'")
        indicador_atualizado = Indicador.objects.select_related('setor').get(pk=indicador_atualizado.pk)
        return Response(self.get_serializer(indicador_atualizado).data)

    def destroy(self, request, *args, **kwargs):
        indicador = self.get_object()
        nome = indicador.nome
        indicador.delete()
        registrar_log(request.user, f"Excluiu o indicador '{nome}'")
        return Response({"detail": "Indicador excluído com sucesso."}, status=status.HTTP_204_NO_CONTENT)
    
    @action(detail=False, methods=['POST'], url_path='backfill-zeros', permission_classes=[IsAuthenticated])
    @transaction.atomic
    def backfill_zeros(self, request):
        """
        Preenche automaticamente, para TODOS os indicadores ativos com mes_inicial definido,
        os meses retroativos SEM preenchimento com valor_realizado=0, até (mês atual - 1).
        Assina com o usuário autenticado que chamou a ação.
        """
        usuario = request.user
        criados_total = 0

        qs = Indicador.objects.filter(ativo=True).exclude(mes_inicial__isnull=True)
        # Se quiser restringir ao escopo do usuário (gestor), pode reusar a mesma lógica do get_queryset()
        # qs = self.get_queryset().filter(ativo=True).exclude(mes_inicial__isnull=True)

        for ind in qs.select_related('setor'):
            try:
                criados = _backfill_preenchimentos_zero(ind, usuario)
                criados_total += criados
            except Exception:
                logger.exception("Falha no backfill do indicador id=%s", ind.id)

        return Response({"detail": "Backfill concluído.", "criados": criados_total}, status=200)


# =========================
#   CONSOLIDADO / CARDS
# =========================
class IndicadoresConsolidadosView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        try:
            usuario = request.user

            qs_ind = (
                Indicador.objects
                .select_related("setor")
                .prefetch_related("metas_mensais", "preenchimentos")
            )

            if getattr(usuario, "perfil", None) == "gestor":
                ids_perm_manuais = PermissaoIndicador.objects.filter(
                    usuario=usuario
                ).values_list("indicador_id", flat=True)

                qs_ind = qs_ind.filter(
                    Q(setor__in=usuario.setores.all()) |
                    Q(visibilidade=True) |
                    Q(id__in=ids_perm_manuais)
                ).distinct()

            dados = []

            for indicador in qs_ind:
                try:
                    # Ordenação segura
                    preenchimentos = [
                        p for p in indicador.preenchimentos.all()
                        if mes_alinhado(indicador, p.ano, p.mes)
                    ]
                    # ordena por data de preenchimento (fallback para 0)
                    preenchimentos = sorted(preenchimentos, key=lambda p: _ts_or_0(p.data_preenchimento))
                    ultimo = preenchimentos[-1] if preenchimentos else None

                    # metas_dict (ignora None)
                    metas_dict = {}
                    # 👇 calcule meses alinhados até HOJE (ou use um "horizonte" se preferir)
                    permitidos = meses_permitidos(indicador, ate=date.today())

                    for m in indicador.metas_mensais.all():
                        mes_m = getattr(m, "mes", None)
                        if not mes_m:
                            continue
                        if _first_of_month(mes_m) not in permitidos:
                            continue  # ignora metas desalinhadas
                        k = _ym_key(mes_m)
                        if k:
                            metas_dict[k] = _to_float(m.valor_meta)

                    valor_atual = None
                    atingido = False
                    variacao = 0.0
                    ultima_atualizacao = None
                    responsavel = "—"
                    comentarios = ""
                    origem = ""
                    provas = []
                    valor_meta_atual = _to_float(indicador.valor_meta)

                    if ultimo:
                        valor_atual = _to_float(ultimo.valor_realizado)
                        ultima_atualizacao = ultimo.data_preenchimento

                        if ultimo.preenchido_por:
                            responsavel = ultimo.preenchido_por.first_name or ultimo.preenchido_por.email

                        comentarios = ultimo.comentario or ""
                        origem = ultimo.origem or ""

                        # Provas seguras
                        arq = _safe_file_url(request, getattr(ultimo, "arquivo", None))
                        if arq:
                            provas.append(arq)
                        if origem and str(origem).startswith(("http://", "https://")):
                            provas.append(origem)

                        chave_meta = f"{ultimo.ano}-{str(ultimo.mes).zfill(2)}"
                        valor_meta_atual = metas_dict.get(chave_meta, valor_meta_atual)

                    v_atual = _to_float(valor_atual)
                    v_meta = _to_float(valor_meta_atual)

                    if v_atual is not None and v_meta not in (None, 0):
                        if indicador.tipo_meta == "crescente":
                            atingido = v_atual >= v_meta
                        elif indicador.tipo_meta == "decrescente":
                            atingido = v_atual <= v_meta
                        elif indicador.tipo_meta == "monitoramento":
                            atingido = abs(v_atual - v_meta) <= 5
                        try:
                            variacao = round(((v_atual - v_meta) / v_meta) * 100, 2)
                        except Exception:
                            variacao = 0.0

                    historico = []
                    for p in preenchimentos:
                        try:
                            chave_meta = f"{p.ano}-{str(p.mes).zfill(2)}"
                            meta_val = metas_dict.get(chave_meta, _to_float(indicador.valor_meta))

                            arq_url = _safe_file_url(request, getattr(p, "arquivo", None))
                            urls_provas = []
                            if arq_url:
                                urls_provas.append(arq_url)
                            if getattr(p, "origem", "") and str(p.origem).startswith(("http://", "https://")):
                                urls_provas.append(p.origem)

                            historico.append({
                                "id": p.id,
                                "valor_realizado": _to_float(p.valor_realizado),
                                "data_preenchimento": _to_iso(p.data_preenchimento),
                                "comentario": p.comentario,
                                "origem": getattr(p, "origem", "") or "",
                                "arquivo": arq_url,
                                "mes": p.mes,
                                "ano": p.ano,
                                "meta": _to_float(meta_val),
                                "provas": urls_provas,
                            })
                        except Exception:
                            logger.exception("Falha ao montar histórico (preenchimento id=%s)", getattr(p, "id", None))
                            continue

                    dados.append({
                        "id": indicador.id,
                        "nome": indicador.nome,
                        "setor_nome": indicador.setor.nome if indicador.setor else "—",
                        "setor": indicador.setor_id,
                        "tipo_meta": indicador.tipo_meta,
                        "tipo_valor": indicador.tipo_valor,
                        "ativo": indicador.ativo,
                        "valor_atual": _to_float(valor_atual),
                        "valor_meta": _to_float(valor_meta_atual),
                        "atingido": bool(atingido),
                        "variacao": _to_float(variacao) or 0.0,
                        "responsavel": responsavel,
                        "ultimaAtualizacao": _to_iso(ultima_atualizacao),
                        "comentarios": comentarios,
                        "origem": origem,
                        "provas": provas,
                        "historico": historico,
                        "metas_mensais": [
                            {"mes": _ymd(getattr(m, "mes", None)), "valor_meta": _to_float(m.valor_meta)}
                            for m in indicador.metas_mensais.all().order_by("mes")
                            if _ymd(getattr(m, "mes", None)) and _first_of_month(m.mes) in permitidos  # 👈 apenas alinhadas
                        ],
                    })

                except Exception:
                    logger.exception("Falha ao consolidar indicador id=%s", getattr(indicador, "id", None))
                    continue  # não derruba o endpoint por 1 indicador

            return Response(dados)

        except Exception as e:
            # Se algo escapar acima, garantimos JSON (não HTML) e logamos a stack
            logger.error("Erro em dados-consolidados: %s", e, exc_info=True)
            if settings.DEBUG:
                return Response(
                    {"detail": str(e), "trace": traceback.format_exc() },
                    status=500
                )
            return Response({"detail": "Erro interno ao consolidar indicadores."}, status=500)


# =========================
#  LIST/CREATE auxiliares
# =========================
class IndicadorListCreateView(generics.ListCreateAPIView):
    queryset = Indicador.objects.all()
    serializer_class = IndicadorSerializer
    permission_classes = [IsMasterUser]  # 🔒 Apenas Master pode criar

    def perform_create(self, serializer):
        serializer.save()


class MetaCreateView(generics.CreateAPIView):
    queryset = Meta.objects.all()
    serializer_class = MetaSerializer
    permission_classes = [IsMasterUser]  # 🔒 Apenas Master pode criar metas

    def perform_create(self, serializer):
        serializer.save(definida_por=self.request.user)


class MetaMensalViewSet(viewsets.ModelViewSet):
    queryset = MetaMensal.objects.all()
    serializer_class = MetaMensalSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['indicador', 'mes']
    ordering_fields = ['mes']
    ordering = ['mes']
