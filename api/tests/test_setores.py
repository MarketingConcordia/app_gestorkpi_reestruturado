import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from api.models import Setor

User = get_user_model()


@pytest.mark.django_db
def test_master_cria_setor():
    client = APIClient()
    master = User.objects.create_user(
        email="master@empresa.com",
        password="123",
        perfil="master",
    )
    client.force_authenticate(user=master)

    payload = {"nome": "Financeiro"}
    url = reverse("setor-list")  # ViewSet basename='setor'
    response = client.post(url, payload, format="json")

    assert response.status_code == 201
    data = response.json()
    assert data["nome"] == "Financeiro"


@pytest.mark.django_db
def test_gestor_nao_cria_setor():
    client = APIClient()
    gestor = User.objects.create_user(
        email="gestor@empresa.com",
        password="123",
        perfil="gestor",
    )
    client.force_authenticate(user=gestor)

    payload = {"nome": "Marketing"}
    url = reverse("setor-list")
    response = client.post(url, payload, format="json")

    # Gestor não deve ter permissão de criar setor (IsMasterOrReadOnly)
    assert response.status_code == 403


@pytest.mark.django_db
def test_listagem_setores():
    client = APIClient()
    master = User.objects.create_user(
        email="master@empresa.com",
        password="123",
        perfil="master",
    )
    client.force_authenticate(user=master)

    Setor.objects.create(nome="Financeiro")
    Setor.objects.create(nome="Marketing")

    url = reverse("setor-list")
    response = client.get(url)
    assert response.status_code == 200
    data = response.json()

    # Se houver paginação, os setores estarão em data["results"]
    setores = data["results"] if isinstance(data, dict) and "results" in data else data
    nomes = [s["nome"] for s in setores]

    assert "Financeiro" in nomes
    assert "Marketing" in nomes
