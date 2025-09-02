from rest_framework import viewsets

from api.models import Configuracao, ConfiguracaoArmazenamento
from api.serializers import (
    ConfiguracaoSerializer,
    ConfiguracaoArmazenamentoSerializer
)
from api.utils import registrar_log
from api.permissions import IsMasterUser


# =========================
#     CONFIGURAÇÕES
# =========================
class ConfiguracaoViewSet(viewsets.ModelViewSet):
    queryset = Configuracao.objects.all()
    serializer_class = ConfiguracaoSerializer
    permission_classes = [IsMasterUser]  # 🔒 Apenas Master pode editar

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        registrar_log(request.user, "Atualizou as configurações do sistema.")
        return response


class ConfiguracaoArmazenamentoViewSet(viewsets.ModelViewSet):
    queryset = ConfiguracaoArmazenamento.objects.all()
    serializer_class = ConfiguracaoArmazenamentoSerializer
    permission_classes = [IsMasterUser]  # 🔒 Apenas Master pode editar
