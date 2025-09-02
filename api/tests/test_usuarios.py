import pytest
from rest_framework.test import APIClient
from api.models import Usuario, Setor, Indicador

@pytest.mark.django_db
def test_gestor_so_preenche_seu_setor():
    client = APIClient()

    # 🔹 Cria dois setores diferentes
    setor_fin = Setor.objects.create(nome="Financeiro")
    setor_mkt = Setor.objects.create(nome="Marketing")

    # 🔹 Cria um gestor vinculado ao setor de Financeiro
    user = Usuario.objects.create_user(username="gestor", password="123", perfil="gestor")
    user.setores.add(setor_fin)
    client.force_authenticate(user=user)

    # 🔹 Cria um indicador em cada setor
    indicador_fin = Indicador.objects.create(
        nome="Receita Financeira",
        setor=setor_fin,
        valor_meta=5000,
        tipo_meta="crescente",
        tipo_valor="monetario",
        visibilidade=True
    )
    indicador_mkt = Indicador.objects.create(
        nome="Leads Marketing",
        setor=setor_mkt,
        valor_meta=100,
        tipo_meta="crescente",
        tipo_valor="numerico",
        visibilidade=True
    )

    # 🔹 Tentativa de preenchimento no setor permitido (Financeiro)
    payload_fin = {"indicador": indicador_fin.id, "valor_realizado": 6000, "ano": 2025, "mes": 8}
    response_fin = client.post("/api/preenchimentos/", payload_fin, format="json")
    assert response_fin.status_code == 201

    # 🔹 Tentativa de preenchimento em setor NÃO permitido (Marketing)
    payload_mkt = {"indicador": indicador_mkt.id, "valor_realizado": 150, "ano": 2025, "mes": 8}
    response_mkt = client.post("/api/preenchimentos/", payload_mkt, format="json")
    assert response_mkt.status_code == 403  # proibido
