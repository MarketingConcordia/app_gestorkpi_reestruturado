import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from api.models import Usuario, Setor, Indicador

@pytest.mark.django_db
def test_gestor_so_preenche_seu_setor():
    client = APIClient()

    # 🔹 Cria dois setores diferentes
    setor_fin = Setor.objects.create(nome="Financeiro")
    setor_mkt = Setor.objects.create(nome="Marketing")

    # 🔹 Cria um gestor vinculado ao setor de Financeiro (⚠️ nosso User exige email)
    user = Usuario.objects.create_user(email="gestor@empresa.com", password="123", perfil="gestor")
    user.setores.add(setor_fin)
    client.force_authenticate(user=user)

    # 🔹 Cria um indicador em cada setor
    indicador_fin = Indicador.objects.create(
        nome="Receita Financeira",
        setor=setor_fin,
        valor_meta=5000,
        tipo_meta="crescente",
        tipo_valor="monetario",
        visibilidade=True,   # permitido mesmo se não fosse do setor (mas é do setor)
        periodicidade=1,
        mes_inicial=None,
        ativo=True,
    )
    indicador_mkt = Indicador.objects.create(
        nome="Leads Marketing",
        setor=setor_mkt,
        valor_meta=100,
        tipo_meta="crescente",
        tipo_valor="numeral",  # ✅ choice válido
        visibilidade=False,    # ✅ para garantir 403 ao gestor (não é do setor e não é visível)
        periodicidade=1,
        mes_inicial=None,
        ativo=True,
    )

    url = reverse("preenchimento-list")

    # 🔹 Tentativa de preenchimento no setor permitido (Financeiro)
    payload_fin = {"indicador": indicador_fin.id, "valor_realizado": 6000, "ano": 2025, "mes": 8}
    response_fin = client.post(url, payload_fin, format="json")
    assert response_fin.status_code == 201

    # 🔹 Tentativa de preenchimento em setor NÃO permitido (Marketing e não visível)
    payload_mkt = {"indicador": indicador_mkt.id, "valor_realizado": 150, "ano": 2025, "mes": 8}
    response_mkt = client.post(url, payload_mkt, format="json")
    assert response_mkt.status_code == 403  # proibido
