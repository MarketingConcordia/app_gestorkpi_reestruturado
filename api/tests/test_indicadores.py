import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from api.models import Indicador, Setor

User = get_user_model()


@pytest.mark.django_db
def test_criar_indicador_como_master():
    client = APIClient()
    # ✅ Em projeto com USERNAME_FIELD = 'email'
    user = User.objects.create_user(
        email="master@empresa.com",
        password="123",
        perfil="master",
    )
    client.force_authenticate(user=user)

    setor = Setor.objects.create(nome="Marketing")

    payload = {
        "nome": "Taxa de Conversão",
        "setor": setor.id,
        "valor_meta": 10,
        "tipo_meta": "crescente",
        "tipo_valor": "percentual",
        "visibilidade": True,
    }

    # Use reverse para manter o teste robusto
    url = reverse("indicador-list")
    response = client.post(url, payload, format="json")

    assert response.status_code == 201
    assert Indicador.objects.filter(nome="Taxa de Conversão").exists()
