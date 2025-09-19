from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.timezone import now
from dateutil.relativedelta import relativedelta
from datetime import date

from api.models import Indicador, Preenchimento, MetaMensal

def first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)

def last_month_first_day(today: date | None = None) -> date:
    t = today or date.today()
    return first_of_month(t) - relativedelta(months=1)

class Command(BaseCommand):
    help = (
        "Saneia preenchimentos automáticos incorretos: "
        "(a) zera '0 pendente' para None dentro da periodicidade, "
        "(b) remove pendentes (0/None) fora da periodicidade, "
        "(c) consolida pendentes duplicados por competência, "
        "(d) cria placeholders pendentes onde faltar."
    )

    def add_arguments(self, parser):
        parser.add_argument("--indicador-id", type=int, default=None, help="Rodar para um único indicador.")
        parser.add_argument("--desde", type=str, default=None, help="AAAA-MM (limite inferior opcional).")
        parser.add_argument("--ate", type=str, default=None, help="AAAA-MM (limite superior opcional).")
        parser.add_argument("--no-create-missing", action="store_true", help="Não criar placeholders ausentes.")
        parser.add_argument("--hard-cap", action="store_true", help="Se indicador tiver mes_final, respeita como teto.")
        parser.add_argument("--dry-run", action="store_true", help="Só reporta, não altera (padrão).")
        parser.add_argument("--verbose", action="store_true", help="Mostra detalhes por competência.")

    def handle(self, *args, **opts):
        dry = opts["dry_run"]
        verbose = opts["verbose"]
        only_id = opts["indicador_id"]
        no_create_missing = opts["no_create_missing"]
        hard_cap = opts["hard_cap"]

        def parse_ym(s: str | None):
            if not s: return None
            y, m = s.split("-")
            return date(int(y), int(m), 1)

        since = parse_ym(opts["desde"])
        until = parse_ym(opts["ate"])
        cap_global = last_month_first_day()

        qs = Indicador.objects.filter(ativo=True)
        if only_id:
            qs = qs.filter(id=only_id)

        total_changed = {"set_null": 0, "deleted": 0, "created": 0, "dedup": 0}
        started = now()

        for ind in qs.only("id", "mes_inicial", "mes_final", "periodicidade", "ativo", "valor_meta"):
            if not ind.mes_inicial:
                continue

            step = max(1, int(ind.periodicidade or 1))
            base = first_of_month(ind.mes_inicial)

            # Teto por indicador
            cap = cap_global
            if hard_cap and getattr(ind, "mes_final", None):
                cap = min(cap, first_of_month(ind.mes_final))

            # Aplica filtros opcionais
            if since: base = max(base, first_of_month(since))
            if until: cap  = min(cap,  first_of_month(until))
            if cap < base:
                continue

            # Conjunto de competências previstas pela periodicidade
            periodic_keys = set()
            cur = base
            while cur <= cap:
                periodic_keys.add((cur.year, cur.month))
                cur = cur + relativedelta(months=+step)

            # Busca todos Preenchimentos do range para o indicador
            ps = Preenchimento.objects.filter(indicador=ind).values(
                "id", "ano", "mes", "valor_realizado", "confirmado", "preenchido_por_id"
            )

            # 1) Se há confirmado em uma competência, removemos pendentes daquela competência.
            confirmed_keys = set((p["ano"], p["mes"]) for p in ps if p["confirmado"])

            # 2) Normalização: dentro da periodicidade → 0 pendente vira None; fora → deletar pendentes
            to_set_null_ids = []
            to_delete_ids = []

            # Agrupar pendentes por (ano,mes) para deduplicar depois
            pendentes_by_key = {}
            for p in ps:
                key = (p["ano"], p["mes"])
                is_pending = not p["confirmado"]
                is_zero = (p["valor_realizado"] is not None and str(p["valor_realizado"]) == "0.00")

                if key in confirmed_keys:
                    # Se existe confirmado, todos pendentes da mesma competência podem ser removidos
                    if is_pending:
                        to_delete_ids.append(p["id"])
                    continue

                if key in periodic_keys:
                    if is_pending and is_zero:
                        to_set_null_ids.append(p["id"])
                    if is_pending and (p["valor_realizado"] is None):
                        pendentes_by_key.setdefault(key, []).append(p["id"])
                else:
                    # Fora da periodicidade: pendente (0/None) deve sumir
                    if is_pending:
                        to_delete_ids.append(p["id"])

            # 3) Deduplicar pendentes dentro da periodicidade: manter o mais antigo (menor id) e remover o resto
            dedup_delete = []
            for key, ids in pendentes_by_key.items():
                if len(ids) > 1:
                    ids_sorted = sorted(ids)
                    keep = ids_sorted[0]
                    dedup_delete.extend(ids_sorted[1:])
                    if verbose:
                        self.stdout.write(f"[dedup] indicador={ind.id} {key} keep={keep} drop={ids_sorted[1:]}")

            # 4) Criar placeholders ausentes dentro da periodicidade (se permitido)
            #    Critério: não existe nenhum Preenchimento (confirmado ou pendente) para a competência.
            existing_keys = set((p["ano"], p["mes"]) for p in ps)
            missing_keys = [k for k in periodic_keys if k not in existing_keys]

            # Execução (dentro de transação por indicador)
            with transaction.atomic():
                if dry:
                    if verbose:
                        self.stdout.write(f"Indicador {ind.id}: set_null={len(to_set_null_ids)} "
                                          f"del={len(to_delete_ids)+len(dedup_delete)} "
                                          f"create={(0 if no_create_missing else len(missing_keys))}")
                else:
                    if to_set_null_ids:
                        Preenchimento.objects.filter(id__in=to_set_null_ids).update(valor_realizado=None)
                        total_changed["set_null"] += len(to_set_null_ids)
                    if to_delete_ids:
                        Preenchimento.objects.filter(id__in=to_delete_ids).delete()
                        total_changed["deleted"] += len(to_delete_ids)
                    if dedup_delete:
                        Preenchimento.objects.filter(id__in=dedup_delete).delete()
                        total_changed["dedup"] += len(dedup_delete)
                    if not no_create_missing and missing_keys:
                        bulk = [
                            Preenchimento(
                                indicador=ind, ano=y, mes=m,
                                valor_realizado=None, confirmado=False,
                                origem="sanitizer-placeholder"
                            ) for (y, m) in missing_keys
                        ]
                        Preenchimento.objects.bulk_create(bulk, ignore_conflicts=True)
                        total_changed["created"] += len(bulk)

        finished = now()
        self.stdout.write(self.style.SUCCESS(
            f"✔ Saneamento concluído. dry_run={dry} changed={total_changed} "
            f"in {(finished - started).total_seconds():.2f}s"
        ))