from django.http import HttpResponse
from openpyxl import Workbook
from reportlab.pdfgen import canvas
from api.models import Preenchimento


def gerar_relatorio_pdf():
    """
    Gera relatório de preenchimentos em formato PDF.
    Retorna um HttpResponse com o PDF pronto para download.
    """
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="relatorio.pdf"'

    p = canvas.Canvas(response)
    p.setFont("Helvetica", 14)
    p.drawString(100, 800, "Relatório de Indicadores")

    y = 760
    preenchimentos = Preenchimento.objects.select_related('indicador').all().order_by('indicador__nome', 'ano', 'mes')

    for pch in preenchimentos:
        texto = (
            f"{pch.indicador.nome} - {str(pch.mes).zfill(2)}/{pch.ano} "
            f"- Valor: {pch.valor_realizado} - Meta: {pch.indicador.valor_meta}"
        )
        p.drawString(100, y, texto)
        y -= 20
        if y < 50:
            p.showPage()
            y = 800

    p.showPage()
    p.save()
    return response


def gerar_relatorio_excel():
    """
    Gera relatório de preenchimentos em formato Excel.
    Retorna um HttpResponse com o arquivo XLSX pronto para download.
    """
    response = HttpResponse(
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    response['Content-Disposition'] = 'attachment; filename=relatorio.xlsx'

    wb = Workbook()
    ws = wb.active
    ws.title = "Relatório"

    ws.append(["Indicador", "Mês/Ano", "Valor", "Meta", "Comentário"])

    preenchimentos = Preenchimento.objects.select_related('indicador').all().order_by('indicador__nome', 'ano', 'mes')

    for pch in preenchimentos:
        ws.append([
            pch.indicador.nome,
            f"{str(pch.mes).zfill(2)}/{pch.ano}",
            pch.valor_realizado if pch.valor_realizado is not None else "",
            pch.indicador.valor_meta,
            pch.comentario or ""
        ])

    wb.save(response)
    return response
