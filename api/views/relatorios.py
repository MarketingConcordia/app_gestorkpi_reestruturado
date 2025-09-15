from django.db.models import F, Q, Count, Exists, OuterRef, Subquery, IntegerField, Sum, Case, When
from django.db.models.functions import ExtractMonth, ExtractYear, Coalesce
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

from api.models import Preenchimento, Indicador, PermissaoIndicador, MetaMensal
from api.services.reports import gerar_relatorio_pdf, gerar_relatorio_excel


# =========================
#       RELATÓRIOS
# =========================
class RelatorioView(APIView):
    """
    - Master → vê todos os indicadores
    - Gestor → vê indicadores visíveis, dos seus setores ou liberados manualmente
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        setor = request.query_params.get('setor')
        mes = request.query_params.get('mes')
        ano = request.query_params.get('ano')
        indicador = request.query_params.get('indicador')

        # Base otimizada
        preenchimentos = (
            Preenchimento.objects
            .select_related('indicador', 'indicador__setor')
            .all()
        )

        # 🔒 Regra de visibilidade do Gestor (visível | setor | permissão manual)
        if getattr(user, 'perfil', None) == 'gestor':
            perm_subq = PermissaoIndicador.objects.filter(usuario=user, indicador=OuterRef('indicador_id'))
            preenchimentos = preenchimentos.filter(
                Q(indicador__visibilidade=True) |
                Q(indicador__setor__in=user.setores.all()) |
                Exists(perm_subq)
            )

        # 🔎 Filtros opcionais
        if setor:
            preenchimentos = preenchimentos.filter(indicador__setor_id=setor)
        if indicador:
            preenchimentos = preenchimentos.filter(indicador_id=indicador)
        if mes:
            try:
                preenchimentos = preenchimentos.filter(mes=int(mes))
            except ValueError:
                pass
        if ano:
            try:
                preenchimentos = preenchimentos.filter(ano=int(ano))
            except ValueError:
                pass

        # 📊 Atingidos usando MetaMensal (se existir) com fallback para Indicador.valor_meta
        meta_subq = (
            MetaMensal.objects
            .filter(indicador_id=OuterRef('indicador_id'))
            .annotate(y=ExtractYear('mes'), m=ExtractMonth('mes'))
            .filter(y=OuterRef('ano'), m=OuterRef('mes'))
            .values('valor_meta')[:1]
        )

        preenchimentos = preenchimentos.annotate(
            valor_meta_ref=Coalesce(Subquery(meta_subq), F('indicador__valor_meta'))
        )

        agregados = preenchimentos.aggregate(
            total=Count('id'),
            atingidos=Sum(
                Case(
                    When(valor_realizado__gte=F('valor_meta_ref'), then=1),
                    default=0,
                    output_field=IntegerField()
                )
            )
        )
        total = agregados.get('total') or 0
        atingidos = agregados.get('atingidos') or 0
        nao_atingidos = total - atingidos

        dados_por_indicador_qs = (
            preenchimentos
            .values('indicador__nome')
            .annotate(
                total=Count('id'),
                atingidos=Sum(
                    Case(
                        When(valor_realizado__gte=F('valor_meta_ref'), then=1),
                        default=0,
                        output_field=IntegerField()
                    )
                ),
                nao_atingidos=Sum(
                    Case(
                        When(valor_realizado__lt=F('valor_meta_ref'), then=1),
                        default=0,
                        output_field=IntegerField()
                    )
                ),
            )
            .order_by('indicador__nome')
        )

        dados_por_indicador = list(dados_por_indicador_qs)

        return Response({
            "total_registros": total,
            "atingidos": atingidos,
            "nao_atingidos": nao_atingidos,
            "detalhes_por_indicador": dados_por_indicador
        })


# =========================
#    EXPORTAÇÕES (PDF/XLSX)
# =========================
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def relatorio_pdf(request):
    return gerar_relatorio_pdf()


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def relatorio_excel(request):
    return gerar_relatorio_excel()
