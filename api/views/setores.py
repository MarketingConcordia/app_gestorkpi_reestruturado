from rest_framework import viewsets, status
from rest_framework.response import Response

from api.models import Setor
from api.serializers import SetorSerializer
from api.utils import registrar_log
from api.permissions import IsMasterOrReadOnly  # leitura p/ autenticados; escrita só Master


class SetorViewSet(viewsets.ModelViewSet):
    queryset = Setor.objects.all()  # respeita ordering do Model.Meta ('nome',)
    serializer_class = SetorSerializer
    permission_classes = [IsMasterOrReadOnly]  # 🔒 Apenas Master cria/edita/exclui

    def perform_create(self, serializer):
        obj = serializer.save()
        registrar_log(self.request.user, f"Cadastrou o setor '{obj.nome}'")
        return obj

    def perform_update(self, serializer):
        nome_anterior = serializer.instance.nome
        obj = serializer.save()
        registrar_log(self.request.user, f"Editou o setor '{nome_anterior}'")
        return obj

    def destroy(self, request, *args, **kwargs):
        setor = self.get_object()
        nome = setor.nome
        setor.delete()
        registrar_log(request.user, f"Excluiu o setor '{nome}'")
        return Response({"detail": "Setor excluído com sucesso."}, status=status.HTTP_204_NO_CONTENT)
