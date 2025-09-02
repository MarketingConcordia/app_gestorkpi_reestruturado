from datetime import datetime, date
from dateutil.relativedelta import relativedelta
from django.utils.timezone import make_aware
from django.db import transaction
from django.db.models import Q

from rest_framework import viewsets, generics, serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import OrderingFilter

from api.models import Indicador, Preenchimento, Meta, MetaMensal
from api.serializers import (
    IndicadorSerializer,
    MetaSerializer,
    MetaMensalSerializer
)
from api.utils import registrar_log
from api.permissions import IsMasterUser, HasIndicadorPermission
from rest_framework.permissions import IsAuthenticated



# =========================
#       INDICADORES
# =========================
class IndicadorViewSet(viewsets.ModelViewSet):
    queryset = Indicador.objects.all().select_related('setor')
    serializer_class = IndicadorSerializer
    permission_classes = [IsAuthenticated, HasIndicadorPermission]  # 🔒 apenas Master ou gestores com permissão

    def get_queryset(self):
        usuario = self.request.user
        qs = Indicador.objects.all().select_related('setor')

        if usuario.perfil != 'master':
            qs = qs.filter(Q(visibilidade=True) | Q(setor__in=usuario.setores.all()))

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

        return qs
    
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
            return Response({"detail": f"Falha ao criar indicador: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        parcial = kwargs.pop('partial', False)
        indicador = self.get_object()
        nome_anterior = indicador.nome

        serializer = self.get_serializer(indicador, data=request.data, partial=parcial)
        serializer.is_valid(raise_exception=True)
        indicador_atualizado = serializer.save()

        nova_meta = indicador_atualizado.valor_meta
        periodicidade = indicador_atualizado.periodicidade or 12
        hoje = datetime.today().replace(day=1)

        for i in range(periodicidade):
            mes_alvo = (hoje + relativedelta(months=i)).date()
            ja_preenchido = Preenchimento.objects.filter(
                indicador=indicador_atualizado,
                data_preenchimento__year=mes_alvo.year,
                data_preenchimento__month=mes_alvo.month,
                valor_realizado__isnull=False
            ).exists()
            if ja_preenchido:
                continue

            MetaMensal.objects.update_or_create(
                indicador=indicador_atualizado,
                mes=mes_alvo,
                defaults={'valor_meta': nova_meta}
            )

        registrar_log(request.user, f"Editou o indicador '{nome_anterior}'")
        indicador_atualizado = Indicador.objects.select_related('setor').get(pk=indicador_atualizado.pk)
        return Response(self.get_serializer(indicador_atualizado).data)

    def destroy(self, request, *args, **kwargs):
        indicador = self.get_object()
        nome = indicador.nome
        indicador.delete()
        registrar_log(request.user, f"Excluiu o indicador '{nome}'")
        return Response({"detail": "Indicador excluído com sucesso."}, status=status.HTTP_204_NO_CONTENT)

    def perform_create(self, serializer):
        indicador = serializer.save()
        gerar_preenchimentos_retroativos(indicador)


def gerar_preenchimentos_retroativos(indicador: Indicador):
    hoje = date.today()
    if not indicador.mes_inicial:
        return

    data_iterada = indicador.mes_inicial.replace(day=1)
    periodicidade = indicador.periodicidade or 1
    pendentes = []

    while data_iterada <= hoje.replace(day=1):
        pendentes.append(
            Preenchimento(
                indicador=indicador,
                data_preenchimento=make_aware(datetime(data_iterada.year, data_iterada.month, 1, 0, 0, 0)),
                mes=data_iterada.month,
                ano=data_iterada.year,
                valor_realizado=0,
            )
        )
        data_iterada += relativedelta(months=periodicidade)

    if pendentes:
        Preenchimento.objects.bulk_create(pendentes, ignore_conflicts=True)


# =========================
#   CONSOLIDADO / CARDS
# =========================
class IndicadoresConsolidadosView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        usuario = request.user

        # 🔹 Busca otimizada: setor (FK) + metas_mensais + preenchimentos
        qs_ind = (
            Indicador.objects
            .select_related("setor")
            .prefetch_related(
                "metas_mensais",
                "preenchimento_set",  # usa related_name default
            )
        )

        if usuario.perfil == "gestor":
            qs_ind = qs_ind.filter(Q(visibilidade=True) | Q(setor__in=usuario.setores.all()))

        dados = []
        for indicador in qs_ind:
            # 🔹 Último preenchimento já carregado (sem query extra)
            preenchimentos = sorted(indicador.preenchimento_set.all(), key=lambda p: p.data_preenchimento)
            ultimo = preenchimentos[-1] if preenchimentos else None

            valor_atual = None
            atingido = False
            variacao = 0
            ultima_atualizacao = None
            responsavel = "—"
            comentarios = ""
            origem = ""
            provas = []
            valor_meta = indicador.valor_meta

            metas_dict = {m.mes.strftime("%Y-%m"): m.valor_meta for m in indicador.metas_mensais.all()}

            if ultimo:
                valor_atual = ultimo.valor_realizado
                ultima_atualizacao = ultimo.data_preenchimento

                if ultimo.preenchido_por:
                    responsavel = ultimo.preenchido_por.first_name or ultimo.preenchido_por.email

                comentarios = ultimo.comentario or ""
                origem = ultimo.origem or ""
                if ultimo.arquivo:
                    try:
                        provas = [request.build_absolute_uri(ultimo.arquivo.url)]
                    except Exception:
                        provas = [str(ultimo.arquivo)]

                chave_meta = f"{ultimo.ano}-{str(ultimo.mes).zfill(2)}"
                valor_meta = metas_dict.get(chave_meta, indicador.valor_meta)

            if valor_atual is not None and valor_meta is not None:
                if indicador.tipo_meta == "crescente":
                    atingido = valor_atual >= valor_meta
                elif indicador.tipo_meta == "decrescente":
                    atingido = valor_atual <= valor_meta
                elif indicador.tipo_meta == "monitoramento":
                    atingido = abs(valor_atual - valor_meta) <= 5
                variacao = ((valor_atual - valor_meta) / valor_meta) * 100 if valor_meta else 0

            # 🔹 Histórico sem N+1
            historico = []
            for p in preenchimentos:
                chave_meta = f"{p.ano}-{str(p.mes).zfill(2)}"
                meta_val = metas_dict.get(chave_meta, indicador.valor_meta)
                arq_url = None
                if p.arquivo:
                    try:
                        arq_url = request.build_absolute_uri(p.arquivo.url)
                    except Exception:
                        arq_url = str(p.arquivo)
                historico.append({
                    "id": p.id,
                    "valor_realizado": p.valor_realizado,
                    "data_preenchimento": p.data_preenchimento,
                    "comentario": p.comentario,
                    "origem": getattr(p, "origem", "") or "",
                    "arquivo": arq_url,
                    "mes": p.mes,
                    "ano": p.ano,
                    "meta": meta_val,
                })

            dados.append({
                "id": indicador.id,
                "nome": indicador.nome,
                "setor_nome": indicador.setor.nome if indicador.setor else "—",
                "setor": indicador.setor_id,
                "tipo_meta": indicador.tipo_meta,
                "tipo_valor": indicador.tipo_valor,
                "ativo": indicador.ativo,
                "valor_atual": valor_atual,
                "valor_meta": valor_meta,
                "atingido": atingido,
                "variacao": variacao,
                "responsavel": responsavel,
                "ultimaAtualizacao": ultima_atualizacao,
                "comentarios": comentarios,
                "origem": origem,
                "provas": provas,
                "historico": historico,
                "metas_mensais": [
                    {"mes": m.mes, "valor_meta": m.valor_meta}
                    for m in indicador.metas_mensais.all().order_by("mes")
                ],
            })

        return Response(dados)


# =========================
#  LIST/CREATE auxiliares
# =========================
class IndicadorListCreateView(generics.ListCreateAPIView):
    queryset = Indicador.objects.all()
    serializer_class = IndicadorSerializer
    permission_classes = [IsMasterUser]  # 🔒 Apenas Master pode criar

    def perform_create(self, serializer):
        ind = serializer.save()
        gerar_preenchimentos_retroativos(ind)


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
