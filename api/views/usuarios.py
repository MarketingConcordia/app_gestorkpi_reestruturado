from rest_framework import viewsets, status, serializers
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from api.models import Usuario, LogDeAcao
from api.serializers import UsuarioSerializer
from api.permissions import IsMasterUser


class UsuarioViewSet(viewsets.ModelViewSet):
    queryset = Usuario.objects.all()
    serializer_class = UsuarioSerializer
    # 🔒 Apenas Master pode listar/criar/editar/excluir usuários
    permission_classes = [IsMasterUser]

    # --- Hardened endpoints: nunca devolver HTML para o front ---
    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except serializers.ValidationError:
            # DRF já formata 400 JSON corretamente
            raise
        except Exception as e:
            # Evita 500/HTML
            return Response({"detail": f"Falha ao criar usuário: {str(e)}"}, status=400)

    def update(self, request, *args, **kwargs):
        try:
            return super().update(request, *args, **kwargs)
        except serializers.ValidationError:
            raise
        except Exception as e:
            return Response({"detail": f"Falha ao atualizar usuário: {str(e)}"}, status=400)

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except Exception as e:
            return Response({"detail": f"Falha ao excluir usuário: {str(e)}"}, status=400)

    @action(
        detail=True,
        methods=["post"],
        url_path="trocar_senha",
        permission_classes=[IsAuthenticated]  # 🔒 Master pode trocar de qualquer usuário; Gestor só a própria
    )
    def trocar_senha(self, request, pk=None):
        """
        - Master → pode alterar a senha de qualquer usuário
        - Gestor → só pode alterar a própria senha
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
