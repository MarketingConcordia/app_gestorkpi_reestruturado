from datetime import datetime, date
from django.utils.timezone import make_aware
from django.db.models import F

from rest_framework import viewsets, generics, status, serializers
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from api.models import Preenchimento, ConfiguracaoArmazenamento, Indicador
from api.serializers import PreenchimentoSerializer
from api.utils import registrar_log
from api.services.storage import upload_arquivo
from rest_framework.permissions import IsAuthenticated



# =========================
#     PREENCHIMENTOS
# =========================
class PreenchimentoViewSet(viewsets.ModelViewSet):
    queryset = Preenchimento.objects.all().select_related('indicador', 'indicador__setor', 'preenchido_por')
    serializer_class = PreenchimentoSerializer
    permission_classes = [IsAuthenticated]  # 🔒 Apenas autenticados
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user

        # 🔒 Gestor vê apenas preenchimentos dos seus setores
        if user.perfil == 'gestor':
            qs = qs.filter(indicador__setor__in=user.setores.all())

        # filtros opcionais
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

    def perform_create(self, serializer):
        usuario = self.request.user

        # Primeiro salva normalmente
        preenchimento = serializer.save(preenchido_por=usuario)

        indicador = preenchimento.indicador

        # 🔒 Regras adicionais de permissão para gestores
        if getattr(usuario, "perfil", None) == "gestor":
            if indicador.setor not in usuario.setores.all():
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("Você não tem permissão para preencher indicadores de outro setor.")

        # Ajusta a data de preenchimento para o primeiro dia do mês/ano informado
        preenchimento.data_preenchimento = make_aware(datetime(
            preenchimento.ano, preenchimento.mes, 1, 0, 0, 0
        ))

        # 🔒 Upload seguro de arquivo
        arquivo = self.request.FILES.get('arquivo')
        origem = self.request.data.get('origem')
        storage_cfg = ConfiguracaoArmazenamento.objects.filter(ativo=True).first()

        if arquivo and storage_cfg:
            import os
            ext_permitidas = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx']
            _, ext = os.path.splitext(arquivo.name.lower())
            if ext not in ext_permitidas:
                raise serializers.ValidationError(f"Extensão de arquivo não permitida: {ext}")

            url_arquivo = upload_arquivo(arquivo, arquivo.name, storage_cfg)
            preenchimento.arquivo = url_arquivo

        if origem:
            preenchimento.origem = origem

        preenchimento.save()

        if preenchimento.valor_realizado is not None:
            self._registrar_log_preenchimento(preenchimento, usuario, acao="preencheu")

    def perform_update(self, serializer):
        preenchimento = serializer.save()
        usuario = self.request.user
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
            f"{usuario.first_name or usuario.email} {acao} "  # 🔒 usa email como fallback
            f"o indicador '{nome_indicador}' com {valor_formatado} referente a {mes}/{ano}"
        )
        registrar_log(usuario, mensagem)

    @action(detail=False, methods=['get'], url_path='pendentes')
    def pendentes_action(self, request):
        hoje = date.today()
        qs = self.get_queryset().filter(valor_realizado__isnull=True, data_preenchimento__lte=hoje)
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)


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
        serializer.save(preenchido_por=self.request.user)


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
    usuario = request.user
    hoje = date.today()
    pendentes = []

    indicadores = Indicador.objects.filter(ativo=True)
    if usuario.perfil != 'master':
        if usuario.perfil != 'master':
            indicadores = indicadores.filter(setor__in=usuario.setores.all())
        else:
            indicadores = indicadores.filter(setor__in=usuario.setores.all())

    indicadores = indicadores.select_related('setor').distinct()

    for indicador in indicadores:
        if not indicador.mes_inicial:
            continue

        data_iterada = date(indicador.mes_inicial.year, indicador.mes_inicial.month, 1)
        periodicidade = indicador.periodicidade or 1

        while data_iterada <= hoje:
            mes = data_iterada.month
            ano = data_iterada.year

            ja_preenchido = Preenchimento.objects.filter(
                indicador=indicador,
                preenchido_por=usuario,
                mes=mes,
                ano=ano,
                valor_realizado__isnull=False
            ).exists()

            if not ja_preenchido:
                pendentes.append({
                    "id": indicador.id,
                    "nome": indicador.nome,
                    "mes": mes,
                    "ano": ano,
                    "tipo_valor": indicador.tipo_valor,
                    "descricao": indicador.extracao_indicador or ""
                })

            # avança para o próximo mês
            data_iterada = date(
                data_iterada.year + (data_iterada.month // 12),
                (data_iterada.month % 12) + 1,
                1
            )

    return Response(pendentes)
