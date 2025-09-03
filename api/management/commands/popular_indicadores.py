from django.core.management.base import BaseCommand
from django.utils import timezone
from api.models import Indicador
import random

class Command(BaseCommand):
    help = "Popula a tabela de indicadores com 277 registros de teste"

    def handle(self, *args, **kwargs):
        tipos_meta = ["crescente", "decrescente", "monitoramento"]
        tipos_valor = ["monetario", "percentual", "numeral"]

        total = 277
        for i in range(3, total + 3):  # começa no id=3 pois já tem 2 no banco
            tipo_meta = random.choice(tipos_meta)
            tipo_valor = random.choice(tipos_valor)

            valor_meta = 0 if tipo_meta == "monitoramento" else round(random.uniform(100, 10000), 2)

            Indicador.objects.create(
                nome=f"Indicador de teste número {i}",
                tipo_meta=tipo_meta,
                status="pendente",
                valor_meta=valor_meta,
                tipo_valor=tipo_valor,
                criado_em=timezone.now(),
                periodicidade=1,
                mes_inicial="2025-01-01",
                visibilidade=random.choice([True, False]),
                extracao_indicador=f"Comentário automático para o indicador {i}",
                ativo=True,
                setor_id=random.randint(1, 5),
            )

        self.stdout.write(self.style.SUCCESS(f"✔ População concluída com {total} indicadores."))
