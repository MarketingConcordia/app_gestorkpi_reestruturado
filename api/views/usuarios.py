from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from api.models import Usuario, LogDeAcao
from api.serializers import UsuarioSerializer
from rest_framework.permissions import IsAuthenticated
from api.permissions import IsMasterUser



class UsuarioViewSet(viewsets.ModelViewSet):
    queryset = Usuario.objects.all()
    serializer_class = UsuarioSerializer

    # 🔒 Apenas Master pode listar, criar, editar ou excluir usuários
    permission_classes = [IsMasterUser]

    @action(
        detail=True,
        methods=["post"],
        url_path="trocar_senha",
        permission_classes=[IsAuthenticated]
    )
    def trocar_senha(self, request, pk=None):
        """
        Endpoint para troca de senha:
        - Se Master → pode alterar a senha de qualquer usuário
        - Se Gestor → só pode alterar a própria senha
        """
        usuario = self.get_object()

        # 🔒 Se não for Master, só pode alterar a própria senha
        if request.user.perfil == "gestor" and request.user.id != usuario.id:
            return Response({"erro": "Você não tem permissão para alterar a senha de outro usuário."}, status=403)

        senha_atual = request.data.get("senha_atual")
        nova_senha = request.data.get("nova_senha")

        if not senha_atual or not nova_senha:
            return Response({"erro": "Campos obrigatórios não fornecidos."}, status=400)

        if not usuario.check_password(senha_atual):
            return Response({"erro": "Senha atual incorreta."}, status=400)

        usuario.set_password(nova_senha)
        usuario.save()

        LogDeAcao.objects.create(
            usuario=request.user,
            acao=f"Alterou a senha do usuário '{usuario.first_name or usuario.email}'"
        )
        return Response({"mensagem": "Senha alterada com sucesso."}, status=200)
