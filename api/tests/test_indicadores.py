import pytest
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from api.models.indicadores import Indicador
from api.models.setores import Setor

User = get_user_model()

@pytest.mark.django_db
def test_criar_indicador_como_master():
    client = APIClient()
    user = User.objects.create_user(username="master", password="123", perfil="master")
    client.force_authenticate(user=user)

    setor = Setor.objects.create(nome="Marketing")
    payload = {
        "nome": "Taxa de Conversão",
        "setor": setor.id,
        "valor_meta": 10,
        "tipo_meta": "crescente",
        "tipo_valor": "percentual",
        "visibilidade": True
    }

    response = client.post("/api/indicadores/", payload, format="json")
    assert response.status_code == 201
    assert Indicador.objects.filter(nome="Taxa de Conversão").exists()
