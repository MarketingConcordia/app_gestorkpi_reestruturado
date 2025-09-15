from django.db import IntegrityError
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from api.models import Configuracao, ConfiguracaoArmazenamento
from api.serializers import (
    ConfiguracaoSerializer,
    ConfiguracaoArmazenamentoSerializer
)
from api.utils import registrar_log
from api.permissions import IsMasterOrReadOnly  # leitura p/ autenticados, escrita só Master


# =========================
#     CONFIGURAÇÕES
# =========================
class ConfiguracaoViewSet(viewsets.ModelViewSet):
    queryset = Configuracao.objects.all()
    serializer_class = ConfiguracaoSerializer
    permission_classes = [IsMasterOrReadOnly]  # 🔒 Apenas Master edita; autenticados leem

    # Centraliza logs nos hooks perform_* para cobrir update e partial_update
    def perform_create(self, serializer):
        obj = serializer.save()
        registrar_log(self.request.user, "Criou as configurações do sistema.")
        return obj

    def perform_update(self, serializer):
        obj = serializer.save()
        registrar_log(self.request.user, "Atualizou as configurações do sistema.")
        return obj

    def perform_destroy(self, instance):
        registrar_log(self.request.user, "Removeu as configurações do sistema.")
        instance.delete()


class ConfiguracaoArmazenamentoViewSet(viewsets.ModelViewSet):
    queryset = ConfiguracaoArmazenamento.objects.all()
    serializer_class = ConfiguracaoArmazenamentoSerializer
    permission_classes = [IsMasterOrReadOnly]  # 🔒 Apenas Master edita; autenticados leem

    def perform_create(self, serializer):
        try:
            obj = serializer.save()
        except IntegrityError as e:
            # Captura violação da UniqueConstraint condicional (uma ativa por vez)
            raise ValidationError({
                "ativo": "Já existe uma configuração de armazenamento ativa. "
                         "Desative a atual antes de criar outra."
            }) from e
        registrar_log(self.request.user, f"Criou configuração de armazenamento ({obj.tipo}).")
        return obj

    def perform_update(self, serializer):
        try:
            obj = serializer.save()
        except IntegrityError as e:
            raise ValidationError({
                "ativo": "Já existe uma configuração de armazenamento ativa. "
                         "Desative a atual antes de ativar outra."
            }) from e
        registrar_log(self.request.user, f"Atualizou configuração de armazenamento ({obj.tipo}).")
        return obj

    def perform_destroy(self, instance):
        registrar_log(self.request.user, f"Removeu configuração de armazenamento ({instance.tipo}).")
        instance.delete()
