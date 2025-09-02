from rest_framework import viewsets, status
from rest_framework.response import Response

from api.models import Setor
from api.serializers import SetorSerializer
from api.utils import registrar_log
from rest_framework.permissions import IsAuthenticated
from api.permissions import IsMasterUser



class SetorViewSet(viewsets.ModelViewSet):
    queryset = Setor.objects.all().order_by("id")
    serializer_class = SetorSerializer
    # 🔒 Apenas usuários autenticados Master podem criar/editar/excluir setores
    permission_classes = [IsAuthenticated]

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        nome = response.data.get('nome')
        registrar_log(request.user, f"Cadastrou o setor '{nome}'")
        return response

    def update(self, request, *args, **kwargs):
        setor = self.get_object()
        nome = setor.nome
        response = super().update(request, *args, **kwargs)
        registrar_log(request.user, f"Editou o setor '{nome}'")
        return response

    def destroy(self, request, *args, **kwargs):
        setor = self.get_object()
        nome = setor.nome
        setor.delete()
        registrar_log(request.user, f"Excluiu o setor '{nome}'")
        return Response({"detail": "Setor excluído com sucesso."}, status=status.HTTP_204_NO_CONTENT)
