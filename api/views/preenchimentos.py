from datetime import datetime, date
from django.utils.timezone import make_aware, now
from django.db import IntegrityError
from django.db.models import F, Q, Exists, OuterRef
from django.db.models.functions import ExtractMonth, ExtractYear

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
    permission_classes = [IsAuthenticated]  # 🔒 Apenas autenticados
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user

        # 🔒 Gestor vê preenchimentos:
        # - de indicadores dos seus setores
        # - OU indicadores visíveis
        # - OU indicadores com permissão manual (PermissaoIndicador)
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
        """Regra de escrita para gestores: setor OU visibilidade OU permissão manual."""
        if getattr(user, "perfil", None) == "master":
            return True
        if indicador.visibilidade:
            return True
        if indicador.setor_id and user.setores.filter(pk=indicador.setor_id).exists():
            return True
        return PermissaoIndicador.objects.filter(usuario=user, indicador=indicador).exists()

    def perform_create(self, serializer):
        usuario = self.request.user

        # 🔒 Verifica permissão ANTES de salvar
        indicador = serializer.validated_data.get('indicador')
        if not self._user_can_write_on(usuario, indicador):
            raise PermissionDenied("Você não tem permissão para preencher este indicador.")

        try:
            preenchimento = serializer.save(preenchido_por=usuario)
        except IntegrityError as e:
            # Violações de unicidade (indicador, mes, ano, preenchido_por)
            raise serializers.ValidationError(
                {"detail": "Já existe preenchimento para este indicador/mês/ano por este usuário."}
            ) from e

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
            # Observação: se upload_arquivo retornar URL absoluta, o FileField aceitará string;
            # o acesso .url pode não estar disponível; o código do projeto já trata via try/except.
            preenchimento.arquivo = url_arquivo

        if origem:
            preenchimento.origem = origem

        preenchimento.save()

        if preenchimento.valor_realizado is not None:
            self._registrar_log_preenchimento(preenchimento, usuario, acao="preencheu")

    def perform_update(self, serializer):
        usuario = self.request.user
        instance: Preenchimento = serializer.instance
        indicador_alvo = serializer.validated_data.get('indicador', instance.indicador)

        # 🔒 Checa permissão ANTES de salvar
        if not self._user_can_write_on(usuario, indicador_alvo):
            raise PermissionDenied("Você não tem permissão para alterar este preenchimento.")

        try:
            preenchimento = serializer.save(preenchido_por=usuario)
        except IntegrityError as e:
            raise serializers.ValidationError(
                {"detail": "Já existe preenchimento para este indicador/mês/ano por este usuário."}
            ) from e

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
        hoje = now().date()  # evita comparações ingênuas entre date e datetime aware
        qs = self.get_queryset().filter(
            valor_realizado__isnull=True,
            data_preenchimento__date__lte=hoje
        )
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
        """
        Mantém o mesmo comportamento do ViewSet:
        - checa permissão antes
        - define preenchido_por
        - ajusta data_preenchimento para 1º dia do mês/ano informado
        """
        user = self.request.user
        indicador = serializer.validated_data.get('indicador')
        # Reutiliza a regra da viewset
        if not PreenchimentoViewSet._user_can_write_on(self, user, indicador):
            raise PermissionDenied("Você não tem permissão para preencher este indicador.")

        try:
            instancia = serializer.save(preenchido_por=user)
        except IntegrityError as e:
            raise serializers.ValidationError(
                {"detail": "Já existe preenchimento para este indicador/mês/ano por este usuário."}
            ) from e

        instancia.data_preenchimento = make_aware(datetime(instancia.ano, instancia.mes, 1, 0, 0, 0))
        instancia.save(update_fields=["data_preenchimento"])


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
        valor_realizado__isnull=False
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
