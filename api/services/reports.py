from django.http import HttpResponse
from django.db.models import F, Q, Exists, OuterRef, Subquery, IntegerField
from django.db.models.functions import ExtractMonth, ExtractYear, Coalesce

from openpyxl import Workbook
from reportlab.pdfgen import canvas

from api.models import Preenchimento, Indicador, PermissaoIndicador, MetaMensal


def _build_base_queryset(user=None, params=None):
    """
    Monta o queryset base de Preenchimento com:
      - select_related para evitar N+1
      - regra de visibilidade p/ gestor (visível | setor | permissão manual)
      - filtros opcionais (setor, mes, ano, indicador)
      - annotation 'valor_meta_ref' vindo de MetaMensal (fallback para Indicador.valor_meta)

    Se 'user' for None, não aplica regra de permissão (compat retro).
    Se 'params' for None, não aplica filtros adicionais.
    """
    qs = Preenchimento.objects.select_related('indicador', 'indicador__setor').all()

    # Regra de visibilidade do Gestor
    if user is not None and getattr(user, 'perfil', None) == 'gestor':
        perm_subq = PermissaoIndicador.objects.filter(usuario=user, indicador=OuterRef('indicador_id'))
        qs = qs.filter(
            Q(indicador__visibilidade=True) |
            Q(indicador__setor__in=user.setores.all()) |
            Exists(perm_subq)
        )

    # Filtros opcionais
    if params:
        setor = params.get('setor')
        mes = params.get('mes')
        ano = params.get('ano')
        indicador_id = params.get('indicador')

        if setor:
            qs = qs.filter(indicador__setor_id=setor)
        if indicador_id:
            qs = qs.filter(indicador_id=indicador_id)
        if mes:
            try:
                qs = qs.filter(mes=int(mes))
            except (TypeError, ValueError):
                pass
        if ano:
            try:
                qs = qs.filter(ano=int(ano))
            except (TypeError, ValueError):
                pass

    # MetaMensal do mês/ano (se existir) com fallback para Indicador.valor_meta
    meta_subq = (
        MetaMensal.objects
        .filter(indicador_id=OuterRef('indicador_id'))
        .annotate(y=ExtractYear('mes'), m=ExtractMonth('mes'))
        .filter(y=OuterRef('ano'), m=OuterRef('mes'))
        .values('valor_meta')[:1]
    )
    qs = qs.annotate(
        valor_meta_ref=Coalesce(Subquery(meta_subq), F('indicador__valor_meta'))
    )

    return qs.order_by('indicador__nome', 'ano', 'mes')


def gerar_relatorio_pdf(user=None, params=None, qs=None):
    """
    Gera relatório PDF dos preenchimentos.
    - Se 'qs' for fornecido, usa o queryset pronto (preferível para garantir mesmíssima filtragem da View).
    - Caso contrário, usa 'user' e 'params' para montar o queryset.
    - Se nada for passado, mantém compat e exporta tudo (com metas corretas).
    """
    queryset = qs if qs is not None else _build_base_queryset(user=user, params=params)

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="relatorio.pdf"'

    pdf = canvas.Canvas(response)
    pdf.setFont("Helvetica", 14)
    pdf.drawString(100, 800, "Relatório de Indicadores")

    y = 780
    pdf.setFont("Helvetica", 10)

    for pch in queryset:
        # valor_meta_ref vem anotado; se por algum motivo faltar, cai para indicador.valor_meta
        meta = pch.valor_meta_ref if getattr(pch, 'valor_meta_ref', None) is not None else pch.indicador.valor_meta
        val_str = "" if pch.valor_realizado is None else f"{float(pch.valor_realizado):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        meta_str = "" if meta is None else f"{float(meta):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        texto = (
            f"{pch.indicador.nome} - {str(pch.mes).zfill(2)}/{pch.ano} "
            f"- Valor: {val_str} - Meta: {meta_str}"
        )
        pdf.drawString(100, y, texto)
        y -= 18
        if y < 50:
            pdf.showPage()
            pdf.setFont("Helvetica", 10)
            y = 800

    pdf.showPage()
    pdf.save()
    return response


def gerar_relatorio_excel(user=None, params=None, qs=None):
    """
    Gera relatório XLSX dos preenchimentos.
    - Se 'qs' for fornecido, usa o queryset pronto (preferível para garantir mesmíssima filtragem da View).
    - Caso contrário, usa 'user' e 'params' para montar o queryset.
    - Se nada for passado, mantém compat e exporta tudo (com metas corretas).
    """
    queryset = qs if qs is not None else _build_base_queryset(user=user, params=params)

    response = HttpResponse(
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response['Content-Disposition'] = 'attachment; filename=relatorio.xlsx'

    wb = Workbook()
    ws = wb.active
    ws.title = "Relatório"

    # Mantém o mesmo contrato de colunas
    ws.append(["Indicador", "Mês/Ano", "Valor", "Meta", "Comentário"])

    for pch in queryset:
        meta = pch.valor_meta_ref if getattr(pch, 'valor_meta_ref', None) is not None else pch.indicador.valor_meta
        valor = "" if pch.valor_realizado is None else float(pch.valor_realizado)
        meta_v = "" if meta is None else float(meta)

        ws.append([
            pch.indicador.nome,
            f"{str(pch.mes).zfill(2)}/{pch.ano}",
            valor,
            meta_v,
            pch.comentario or ""
        ])

    wb.save(response)
    return response
