from django.db import IntegrityError
from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from api.models import Configuracao, ConfiguracaoArmazenamento
from api.serializers import (
    ConfiguracaoSerializer,
    ConfiguracaoArmazenamentoSerializer
)
from api.utils import registrar_log
from api.permissions import IsMasterOrReadOnly # leitura p/ autenticados, escrita só Master


# =========================
#     CONFIGURAÇÕES
# =========================
class ConfiguracaoViewSet(viewsets.ModelViewSet):
    serializer_class = ConfiguracaoSerializer
    permission_classes = [IsMasterOrReadOnly]  # 🔒 Apenas Master edita; autenticados leem

    # Sempre mantenha ordenado para garantir consistência em operações auxiliares
    def get_queryset(self):
        return Configuracao.objects.order_by("-id")

    # 🔸 Garante que SEMPRE exista/retorne a mesma instância (singleton)
    def _ensure_instance(self):
        obj = self.get_queryset().first()
        if not obj:
            # se nunca foi criado, cria um com defaults
            obj = Configuracao.objects.create()
        return obj

    # 🔸 /configuracoes/  -> devolve 1 objeto (não lista)
    def list(self, request, *args, **kwargs):
        obj = self._ensure_instance()
        ser = self.get_serializer(obj)
        return Response(ser.data)

    # 🔸 /configuracoes/{id}/  -> ignora id variável e retorna o singleton
    def get_object(self):
        return self._ensure_instance()

    # 🔸 POST vira UPSERT: atualiza o existente em vez de criar um novo
    def create(self, request, *args, **kwargs):
        instance = self._ensure_instance()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        registrar_log(self.request.user, "Atualizou as configurações do sistema (upsert via POST).")
        return Response(self.get_serializer(obj).data, status=status.HTTP_200_OK)

    # 🔸 PATCH/PUT mantém logs centralizados e não criam duplicatas
    def perform_update(self, serializer):
        obj = serializer.save()
        registrar_log(self.request.user, "Atualizou as configurações do sistema.")
        return obj

    # 🔸 Bloqueia DELETE para evitar ficar sem registro (opcional; remova se quiser permitir)
    def perform_destroy(self, instance):
        # Opcionalmente, você pode impedir a remoção:
        # raise ValidationError({"detail": "Remoção de Configuração não é permitida."})
        registrar_log(self.request.user, "Removeu as configurações do sistema.")
        instance.delete()


class ConfiguracaoArmazenamentoViewSet(viewsets.ModelViewSet):
    serializer_class = ConfiguracaoArmazenamentoSerializer
    permission_classes = [IsMasterOrReadOnly]

    def get_queryset(self):
        # segue o ordering do Model (Meta.ordering = ('-criado_em',)), mas explicitamos
        return ConfiguracaoArmazenamento.objects.order_by("-criado_em")

    def perform_create(self, serializer):
        try:
            obj = serializer.save()
        except IntegrityError as e:
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
