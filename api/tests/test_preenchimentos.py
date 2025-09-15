import pytest
from decimal import Decimal
from django.urls import reverse
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from api.models import Indicador, Setor

User = get_user_model()

@pytest.mark.django_db
def test_preenchimento_retroativo():
    client = APIClient()

    # ✅ Em projeto com USERNAME_FIELD = 'email'
    user = User.objects.create_user(
        email="gestor@empresa.com",
        password="123",
        perfil="gestor",
    )
    client.force_authenticate(user=user)

    setor = Setor.objects.create(nome="Financeiro")
    user.setores.add(setor)

    indicador = Indicador.objects.create(
        nome="Receita Mensal",
        setor=setor,
        valor_meta=10000,
        tipo_meta="crescente",
        tipo_valor="monetario",
        visibilidade=True,
        periodicidade=1,
        mes_inicial="2025-01-01",
        ativo=True,
    )

    payload = {
        "indicador": indicador.id,
        "valor_realizado": 12000,
        "ano": 2025,
        "mes": 8,
    }

    url = reverse("preenchimento-list")
    response = client.post(url, payload, format="json")

    assert response.status_code == 201
    data = response.json()

    # DRF serializa Decimal como string — valida com Decimal para evitar problemas de locale
    assert Decimal(data["valor_realizado"]) == Decimal("12000.00")

    # (opcional) garante que salvou a competência corretamente
    assert data["mes"] == 8
    assert data["ano"] == 2025
