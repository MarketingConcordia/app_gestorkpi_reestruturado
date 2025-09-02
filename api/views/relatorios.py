from django.db.models import F, Q, Count
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import Preenchimento, Indicador, PermissaoIndicador
from api.services.reports import gerar_relatorio_pdf, gerar_relatorio_excel
from rest_framework.permissions import IsAuthenticated



# =========================
#       RELATÓRIOS
# =========================
class RelatorioView(APIView):
    """
    - Master → vê todos os indicadores
    - Gestor → vê apenas indicadores de seus setores ou liberados manualmente
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        setor = request.query_params.get('setor')
        mes = request.query_params.get('mes')
        indicador = request.query_params.get('indicador')

        preenchimentos = Preenchimento.objects.all()

        # 🔒 Regra de visibilidade do Gestor
        if user.perfil == 'gestor':
            setores_ids = user.setores.values_list('id', flat=True)
            indicadores_ids_setor = Indicador.objects.filter(
                setor_id__in=setores_ids
            ).values_list('id', flat=True)
            indicadores_ids_manual = PermissaoIndicador.objects.filter(
                usuario=user
            ).values_list('indicador_id', flat=True)

            indicadores_ids = list(indicadores_ids_setor) + list(indicadores_ids_manual)
            preenchimentos = preenchimentos.filter(indicador_id__in=indicadores_ids)

        # 🔎 Filtros opcionais
        if setor:
            preenchimentos = preenchimentos.filter(indicador__setor__id=setor)
        if mes:
            try:
                preenchimentos = preenchimentos.filter(mes=int(mes))
            except ValueError:
                pass
        if indicador:
            preenchimentos = preenchimentos.filter(indicador__id=indicador)

        # 📊 Agregados
        total = preenchimentos.count()
        atingidos = preenchimentos.filter(valor_realizado__gte=F('indicador__valor_meta')).count()
        nao_atingidos = total - atingidos

        dados_por_indicador = preenchimentos.values('indicador__nome').annotate(
            total=Count('id'),
            atingidos=Count('id', filter=Q(valor_realizado__gte=F('indicador__valor_meta'))),
            nao_atingidos=Count('id', filter=Q(valor_realizado__lt=F('indicador__valor_meta')))
        )

        return Response({
            "total_registros": total,
            "atingidos": atingidos,
            "nao_atingidos": nao_atingidos,
            "detalhes_por_indicador": dados_por_indicador
        })


# =========================
#    EXPORTAÇÕES (PDF/XLSX)
# =========================
def relatorio_pdf(request):
    return gerar_relatorio_pdf()


def relatorio_excel(request):
    return gerar_relatorio_excel()
