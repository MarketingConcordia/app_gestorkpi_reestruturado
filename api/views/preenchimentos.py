from typing import Optional 
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
from django.utils.timezone import make_aware, now
from django.db import IntegrityError
from django.db.models import F, Q, Exists, OuterRef
from django.db.models.functions import ExtractMonth, ExtractYear
from rest_framework.exceptions import ValidationError

from rest_framework import viewsets, generics, status, serializers
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied

from api.models import Preenchimento, ConfiguracaoArmazenamento, Indicador, MetaMensal, PermissaoIndicador
from api.serializers import PreenchimentoSerializer
from api.utils import registrar_log
from api.services.storage import upload_arquivo


# =========================
#     PREENCHIMENTOS
# =========================
class PreenchimentoViewSet(viewsets.ModelViewSet):
    queryset = (
        Preenchimento.objects
        .all()
        .select_related('indicador', 'indicador__setor', 'preenchido_por')
    )
    serializer_class = PreenchimentoSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    # ===== Helpers de mês =====
    def _first_of_month(self, d: date) -> date:
        return date(d.year, d.month, 1)

    def _last_month_first_day(self, today: Optional[date] = None) -> date:
        t = today or date.today()
        return self._first_of_month(t) - relativedelta(months=1)

    def _autofill_zeros_until_last_month(self, autor_user):
        """
        Cria placeholders (valor_realizado=None) apenas nos meses previstos
        pela periodicidade do indicador, de mes_inicial até (mês atual - 1),
        respeitando mes_final quando existir.
        """
        limite = self._last_month_first_day()

        # usuário que assina os lançamentos automáticos
        autor = autor_user
        if not autor or not getattr(autor, "is_authenticated", False):
            from django.contrib.auth import get_user_model
            U = get_user_model()
            autor = U.objects.filter(is_superuser=True).order_by("id").first() or U.objects.first()

        # Indicadores candidatos (com periodicidade carregada)
        inds = (
            Indicador.objects
            .filter(ativo=True)
            .exclude(mes_inicial__isnull=True)
            .only('id', 'mes_inicial', 'mes_final', 'ativo', 'periodicidade')
        )

        for ind in inds:
            inicio = self._first_of_month(ind.mes_inicial)
            cap = limite
            if getattr(ind, "mes_final", None):
                cap = min(cap, self._first_of_month(ind.mes_final))
            if cap < inicio:
                continue

            # passo (periodicidade) em meses
            step = getattr(ind, "periodicidade", 1) or 1
            try:
                step = max(1, int(step))
            except Exception:
                step = 1

            # pares (ano, mes) já existentes
            existentes = set(
                Preenchimento.objects.filter(indicador=ind).values_list("ano", "mes")
            )

            atual = inicio
            to_create = []
            while atual <= cap:
                key = (atual.year, atual.month)
                if key not in existentes:
                    to_create.append(Preenchimento(
                        indicador=ind,
                        ano=atual.year,
                        mes=atual.month,
                        valor_realizado=None,  # pendente
                        preenchido_por=autor,
                        data_preenchimento=make_aware(datetime(atual.year, atual.month, 1, 0, 0, 0)),
                        origem="placeholder-auto",
                        confirmado=False,
                    ))
                # pula conforme periodicidade
                atual += relativedelta(months=step)

            if to_create:
                Preenchimento.objects.bulk_create(to_create, ignore_conflicts=True)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    # Garante os placeholders antes de listar
    def list(self, request, *args, **kwargs):
        try:
            self._autofill_zeros_until_last_month(request.user)
        except Exception:
            # falhas no autofill não devem impedir a listagem
            pass
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user

        # Regras de visibilidade para gestor
        if getattr(user, "perfil", None) == 'gestor':
            perm_subq = PermissaoIndicador.objects.filter(usuario=user, indicador=OuterRef('indicador_id'))
            qs = qs.filter(
                Q(indicador__setor__in=user.setores.all()) |
                Q(indicador__visibilidade=True) |
                Exists(perm_subq)
            )

        # Filtros opcionais
        setor = self.request.query_params.get('setor')
        mes = self.request.query_params.get('mes')
        ano = self.request.query_params.get('ano')
        indicador_id = self.request.query_params.get('indicador')
        status_param = self.request.query_params.get('status')

        if indicador_id:
            qs = qs.filter(indicador_id=indicador_id)
        if setor:
            qs = qs.filter(indicador__setor_id=setor)
        if mes:
            try:
                qs = qs.filter(mes=int(mes))
            except ValueError:
                pass
        if ano:
            try:
                qs = qs.filter(ano=int(ano))
            except ValueError:
                pass
        if status_param == 'atingido':
            qs = qs.filter(valor_realizado__gte=F('indicador__valor_meta'))
        elif status_param == 'nao-atingido':
            qs = qs.filter(valor_realizado__lt=F('indicador__valor_meta'))

        return qs

    def _user_can_write_on(self, user, indicador: Indicador) -> bool:
        """Permissões de gravação: master, visibilidade, mesmo setor, ou permissão manual."""
        if getattr(user, "perfil", None) == "master":
            return True
        if indicador.visibilidade:
            return True
        if indicador.setor_id and user.setores.filter(pk=indicador.setor_id).exists():
            return True
        return PermissaoIndicador.objects.filter(usuario=user, indicador=indicador).exists()

    def perform_create(self, serializer):
        usuario = self.request.user

        # Permissão antes de salvar
        indicador = serializer.validated_data.get('indicador')
        if not self._user_can_write_on(usuario, indicador):
            raise PermissionDenied("Você não tem permissão para preencher este indicador.")

        try:
            preenchimento = serializer.save(preenchido_por=usuario)
        except IntegrityError as e:
            raise serializers.ValidationError(
                {"detail": "Já existe preenchimento para este indicador/mês/ano por este usuário."}
            ) from e

        # Normaliza a competência para o 1º dia
        preenchimento.data_preenchimento = make_aware(datetime(
            preenchimento.ano, preenchimento.mes, 1, 0, 0, 0
        ))

        # Se tem valor, é confirmado; se ficar sem valor (None), permanece pendente
        preenchimento.confirmado = (preenchimento.valor_realizado is not None)

        # Upload/arquivo e origem
        arquivo = self.request.FILES.get('arquivo')
        origem = self.request.data.get('origem') or 'manual'
        storage_cfg = ConfiguracaoArmazenamento.objects.filter(ativo=True).first()

        if arquivo and storage_cfg:
            import os
            ext_permitidas = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx']
            _, ext = os.path.splitext(arquivo.name.lower())
            if ext not in ext_permitidas:
                raise serializers.ValidationError(f"Extensão de arquivo não permitida: {ext}")
            url_arquivo = upload_arquivo(arquivo, arquivo.name, storage_cfg)
            preenchimento.arquivo = url_arquivo

        preenchimento.origem = origem
        preenchimento.save()

        # Loga somente se houve valor (deixou de ser pendente)
        if preenchimento.valor_realizado is not None:
            self._registrar_log_preenchimento(preenchimento, usuario, acao="preencheu")

    def perform_update(self, serializer):
        usuario = self.request.user
        instance: Preenchimento = serializer.instance
        indicador_alvo = serializer.validated_data.get('indicador', instance.indicador)

        if not self._user_can_write_on(usuario, indicador_alvo):
            raise PermissionDenied("Você não tem permissão para alterar este preenchimento.")

        try:
            preenchimento = serializer.save(preenchido_por=usuario)
        except IntegrityError as e:
            raise serializers.ValidationError(
                {"detail": "Já existe preenchimento para este indicador/mês/ano por este usuário."}
            ) from e

        # Se veio 'valor_realizado' no payload, reavalia confirmação
        if 'valor_realizado' in serializer.validated_data:
            preenchimento.confirmado = (preenchimento.valor_realizado is not None)
            preenchimento.save(update_fields=['confirmado'])

        if preenchimento.valor_realizado is not None:
            self._registrar_log_preenchimento(preenchimento, usuario, acao="atualizou")

    def perform_destroy(self, instance):
        registrar_log(
            self.request.user,
            f"Excluiu preenchimento do indicador '{instance.indicador.nome}' "
            f"do mês {str(instance.mes).zfill(2)}/{instance.ano}."
        )
        instance.delete()

    def _registrar_log_preenchimento(self, preenchimento: Preenchimento, usuario, acao="preencheu"):
        valor = preenchimento.valor_realizado
        tipo = preenchimento.indicador.tipo_valor
        nome_indicador = preenchimento.indicador.nome
        mes = str(preenchimento.mes).zfill(2)
        ano = preenchimento.ano

        if tipo == 'monetario':
            valor_formatado = f"R$ {float(valor):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        elif tipo == 'percentual':
            valor_formatado = f"{float(valor):.2f}%"
        else:
            valor_formatado = f"{valor}"

        mensagem = (
            f"{(usuario.first_name or usuario.email)} {acao} "
            f"o indicador '{nome_indicador}' com {valor_formatado} referente a {mes}/{ano}"
        )
        registrar_log(usuario, mensagem)

    @action(detail=False, methods=['get'], url_path='pendentes')
    def pendentes_action(self, request):
        hoje = now().date()
        qs = self.get_queryset().filter(
            confirmado=False,
            data_preenchimento__date__lte=hoje
        )
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'], url_path='resolve-id', permission_classes=[IsAuthenticated])
    def resolve_id(self, request):
        """
        Retorna o ID do Preenchimento do usuário para (indicador, ano, mes).
        Se não existir, cria um pendente (sem valor) e retorna o ID.
        """
        try:
            indicador_id = int(request.data.get('indicador'))
            ano = int(request.data.get('ano'))
            mes = int(request.data.get('mes'))
        except (TypeError, ValueError):
            raise ValidationError("Campos 'indicador', 'ano' e 'mes' são obrigatórios e numéricos.")

        indicador = Indicador.objects.filter(pk=indicador_id).first()
        if not indicador:
            raise ValidationError("Indicador inválido.")

        # Permissão do usuário
        if not self._user_can_write_on(request.user, indicador):
            raise PermissionDenied("Você não tem permissão para preencher este indicador.")

        # Normaliza competência pro 1º dia do mês
        dt_comp = make_aware(datetime(ano, mes, 1, 0, 0, 0))
        origem = (request.data.get('origem') or 'manual')

        obj, _created = Preenchimento.objects.get_or_create(
            indicador_id=indicador_id,
            ano=ano,
            mes=mes,
            preenchido_por=request.user,
            defaults={
                'confirmado': False,
                'data_preenchimento': dt_comp,
                'origem': origem,
            }
        )
        return Response({'id': obj.id}, status=status.HTTP_200_OK)

# =========================
#  LIST/CREATE auxiliares
# =========================
class PreenchimentoListCreateView(generics.ListCreateAPIView):
    queryset = Preenchimento.objects.all()
    serializer_class = PreenchimentoSerializer
    permission_classes = [IsAuthenticated]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    def perform_create(self, serializer):
        user = self.request.user
        indicador = serializer.validated_data.get('indicador')
        if not PreenchimentoViewSet._user_can_write_on(self, user, indicador):
            raise PermissionDenied("Você não tem permissão para preencher este indicador.")

        try:
            instancia = serializer.save(preenchido_por=user)
        except IntegrityError as e:
            raise serializers.ValidationError(
                {"detail": "Já existe preenchimento para este indicador/mês/ano por este usuário."}
            ) from e

        instancia.data_preenchimento = make_aware(datetime(instancia.ano, instancia.mes, 1, 0, 0, 0))
        instancia.confirmado = (instancia.valor_realizado is not None)  # ✅
        instancia.origem = (self.request.data.get('origem') or 'manual')  # ✅
        instancia.save(update_fields=["data_preenchimento", "confirmado", "origem"])

# =========================
#  ENDPOINTS AUXILIARES
# =========================
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def meus_preenchimentos(request):
    preenchimentos = (
        Preenchimento.objects
        .filter(preenchido_por=request.user)
        .select_related('indicador', 'indicador__setor')
        .order_by('-data_preenchimento')
    )
    serializer = PreenchimentoSerializer(preenchimentos, many=True, context={"request": request})
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def indicadores_pendentes(request):
    """
    Lista pendências com base EXCLUSIVAMENTE nas metas existentes (MetaMensal),
    respeitando o intervalo que foi criado no serializer (mes_inicial..mes_final).
    Não cria meses automaticamente até 'hoje'.
    """
    usuario = request.user

    # 1) Indicadores ativos e visíveis ao usuário (ou concedidos via permissão manual)
    indicadores = Indicador.objects.filter(ativo=True)
    if getattr(usuario, "perfil", None) != 'master':
        perm_subq = PermissaoIndicador.objects.filter(usuario=usuario, indicador=OuterRef('pk'))
        indicadores = indicadores.filter(
            Q(setor__in=usuario.setores.all()) | Q(visibilidade=True) | Exists(perm_subq)
        )

    # 2) Metas já criadas são a 'fonte da verdade' do range
    metas = (
        MetaMensal.objects
        .select_related('indicador', 'indicador__setor')
        .filter(indicador__in=indicadores)
    )

    # 3) Verifica se há Preenchimento correspondente por competência
    preench_qs = Preenchimento.objects.filter(
        indicador_id=OuterRef('indicador_id'),
        mes=ExtractMonth(OuterRef('mes')),
        ano=ExtractYear(OuterRef('mes')),
        confirmado=True
    )

    metas_sem_preenchimento = (
        metas
        .annotate(tem_preenchimento=Exists(preench_qs))
        .filter(tem_preenchimento=False)
        .order_by('indicador_id', 'mes')
    )

    # 4) Monta o payload esperado pelo front
    pendentes = []
    for m in metas_sem_preenchimento:
        pendentes.append({
            "id": m.indicador_id,
            "nome": m.indicador.nome,
            "mes": m.mes.month,
            "ano": m.mes.year,
            "tipo_valor": m.indicador.tipo_valor,
            "descricao": m.indicador.extracao_indicador or "",
            "setor": m.indicador.setor_id,
            "setor_nome": m.indicador.setor.nome,
        })

    return Response(pendentes)
