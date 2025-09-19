from django.core.management.base import BaseCommand
from django.db import transaction
from datetime import date
from dateutil.relativedelta import relativedelta
from api.models import MetaMensal, Preenchimento

def first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)

class Command(BaseCommand):
    help = "Remove MetaMensal e Preenchimento PENDENTE em competências no futuro (>= início do mês atual)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Só reporta, não altera (padrão).")

    def handle(self, *args, **opts):
        dry = opts.get("dry_run", True)
        hoje0 = first_of_month(date.today())

        metas_qs = MetaMensal.objects.filter(mes__gte=hoje0)
        fut_preench_qs = Preenchimento.objects.extra(
            where=["(ano > %s) OR (ano = %s AND mes >= %s)"],
            params=[hoje0.year, hoje0.year, hoje0.month]
        ).filter(confirmado=False)

        self.stdout.write(f"Metas futuras: {metas_qs.count()}")
        self.stdout.write(f"Preenchimentos pendentes futuros: {fut_preench_qs.count()}")

        if dry:
            self.stdout.write(self.style.WARNING("DRY-RUN: nenhuma alteração aplicada."))
            return

        with transaction.atomic():
            metas_deleted, _ = metas_qs.delete()
            pre_deleted, _ = fut_preench_qs.delete()
            self.stdout.write(self.style.SUCCESS(
                f"Removidos: metas={metas_deleted}, preenchimentos_pendentes={pre_deleted}"
            ))
