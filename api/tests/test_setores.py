import pytest
from rest_framework.test import APIClient
from api.models.usuarios import Usuario
from api.models.setores import Setor


@pytest.mark.django_db
def test_master_cria_setor():
    client = APIClient()
    master = Usuario.objects.create_user(username="master", password="123", perfil="master")
    client.force_authenticate(user=master)

    payload = {"nome": "Financeiro"}
    response = client.post("/api/setores/", payload, format="json")

    assert response.status_code == 201
    data = response.json()
    assert data["nome"] == "Financeiro"


@pytest.mark.django_db
def test_gestor_nao_cria_setor():
    client = APIClient()
    gestor = Usuario.objects.create_user(username="gestor", password="123", perfil="gestor")
    client.force_authenticate(user=gestor)

    payload = {"nome": "Marketing"}
    response = client.post("/api/setores/", payload, format="json")

    # Gestor não deve ter permissão de criar setor
    assert response.status_code == 403


@pytest.mark.django_db
def test_listagem_setores():
    client = APIClient()
    master = Usuario.objects.create_user(username="master", password="123", perfil="master")
    client.force_authenticate(user=master)

    Setor.objects.create(nome="Financeiro")
    Setor.objects.create(nome="Marketing")

    response = client.get("/api/setores/")
    assert response.status_code == 200
    data = response.json()

    # Se houver paginação, os setores estarão em data["results"]
    if isinstance(data, dict) and "results" in data:
        setores = data["results"]
    else:
        setores = data

    nomes = [s["nome"] for s in setores]

    assert "Financeiro" in nomes
    assert "Marketing" in nomes
