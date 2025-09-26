from __future__ import annotations
from datetime import date
from dateutil.relativedelta import relativedelta

def first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)

def months_diff(a: date, b: date) -> int:
    return (a.year - b.year) * 12 + (a.month - b.month)

def mes_alinhado(indicador, ano: int, mes: int) -> bool:
    per = int(getattr(indicador, "periodicidade", 1) or 1)
    if per < 1: per = 1
    # Âncora
    base = getattr(indicador, "mes_inicial", None)
    if base is None:
        # fallback seguro: usa criação como âncora
        criado_em = getattr(indicador, "criado_em", None)
        if not criado_em:
            return True
        base = first_of_month(criado_em.date() if hasattr(criado_em, "date") else criado_em)
    else:
        base = first_of_month(base)

    alvo = date(int(ano), int(mes), 1)
    if alvo < base:
        return False

    # Mes final (opcional)
    mf = getattr(indicador, "mes_final", None)
    if mf:
        end = first_of_month(mf)
        if alvo > end:
            return False

    d = months_diff(alvo, base)
    return (d % per) == 0

def meses_permitidos(indicador, ate: date) -> set[date]:
    per = int(getattr(indicador, "periodicidade", 1) or 1)
    if per < 1: per = 1
    base = getattr(indicador, "mes_inicial", None)
    if base is None:
        criado_em = getattr(indicador, "criado_em", None)
        if not criado_em:
            base = first_of_month(date.today())
        else:
            base = first_of_month(criado_em.date() if hasattr(criado_em, "date") else criado_em)
    else:
        base = first_of_month(base)

    limite = getattr(indicador, "mes_final", None)
    if limite:
        ate = max(first_of_month(ate), first_of_month(limite))
    else:
        ate = first_of_month(ate)

    meses = set()
    cur = base
    while cur <= ate:
        meses.add(cur)
        cur = cur + relativedelta(months=+per)
    return meses