# services/metas.py
from datetime import date
from dateutil.relativedelta import relativedelta
from django.utils.timezone import localdate

from api.models import Indicador, MetaMensal


def _first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)


def _coerce_step(raw) -> int:
    """
    Garante periodicidade coerente [1..12].
    """
    try:
        step = int(raw or 1)
    except Exception:
        step = 1
    if step < 1:
        step = 1
    if step > 12:
        step = 12
    return step


def _ensure_range(indicador: Indicador, start: date, end: date, step: int, *, hard_cap: bool) -> None:
    """
    Garante a existência de MetaMensal para o 'indicador' do mês 'start' até 'end' (inclusive),
    avançando de 'step' em 'step'. Se 'hard_cap=True', remove metas além de 'end'.
    """
    start = _first_of_month(start)
    end = _first_of_month(end)

    if start > end:
        # Nada a criar; se hard_cap, apenas remova além do 'end'.
        if hard_cap:
            MetaMensal.objects.filter(indicador=indicador, mes__gt=end).delete()
        return

    # Meses que já existem
    existentes = set(
        MetaMensal.objects.filter(indicador=indicador).values_list("mes", flat=True)
    )

    # Colete a criar
    atual = start
    novos = []
    while atual <= end:
        if atual not in existentes:
            novos.append(MetaMensal(
                indicador=indicador,
                mes=atual,
                valor_meta=indicador.valor_meta,
            ))
        atual = atual + relativedelta(months=+step)

    if novos:
        # unique_together (indicador, mes) é respeitado pelo ignore_conflicts
        MetaMensal.objects.bulk_create(novos, ignore_conflicts=True)

    if hard_cap:
        MetaMensal.objects.filter(indicador=indicador, mes__gt=end).delete()


def ensure_metas_ate_hoje(indicador: Indicador) -> None:
    """
    Sincroniza metas mensais do indicador conforme o estado aberto/fechado:
      - Se indicador.mes_final for None (ABERTO): cria metas retroativas até o mês atual.
      - Se indicador.mes_final estiver setado (FECHADO): cria metas até mes_final e remove além.
    """
    if not indicador:
        return

    if not indicador.mes_inicial:
        # Sem base de início, não há como gerar linha do tempo.
        return

    step = _coerce_step(indicador.periodicidade)
    start = _first_of_month(indicador.mes_inicial)

    if indicador.mes_final:
        # FECHADO: garante até mes_final e remove metas posteriores
        end = _first_of_month(indicador.mes_final)
        _ensure_range(indicador, start, end, step, hard_cap=True)
    else:
        # ABERTO: garante até o mês corrente (não remove além)
        hoje1 = _first_of_month(localdate())
        _ensure_range(indicador, start, hoje1, step, hard_cap=False)


def ensure_metas_ate(indicador: Indicador, target_end: date, *, hard_cap: bool = False) -> None:
    """
    Utilitário público para garantir metas até um 'target_end' arbitrário.
    Útil para rotinas administrativas/reprocessamentos.
    """
    if not indicador or not indicador.mes_inicial:
        return
    step = _coerce_step(indicador.periodicidade)
    start = _first_of_month(indicador.mes_inicial)
    _ensure_range(indicador, start, _first_of_month(target_end), step, hard_cap=hard_cap)
