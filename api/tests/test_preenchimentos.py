import pytest
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from api.models.indicadores import Indicador
from api.models.setores import Setor
from api.models.usuarios import Usuario

User = get_user_model()

@pytest.mark.django_db
def test_preenchimento_retroativo():
    client = APIClient()
    user = Usuario.objects.create_user(username="gestor", password="123", perfil="gestor")
    client.force_authenticate(user=user)

    setor = Setor.objects.create(nome="Financeiro")
    user.setores.add(setor)
    indicador = Indicador.objects.create(
        nome="Receita Mensal",
        setor=setor,
        valor_meta=10000,
        tipo_meta="crescente",
        tipo_valor="monetario",
        visibilidade=True
    )

    payload = {"indicador": indicador.id, "valor_realizado": 12000, "ano": 2025, "mes": 8}
    response = client.post("/api/preenchimentos/", payload, format="json")

    assert response.status_code == 201
    data = response.json()
    from decimal import Decimal
    assert Decimal(data["valor_realizado"]) == Decimal("12000.00")

