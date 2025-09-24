from django.db import IntegrityError
from django.contrib.auth.password_validation import validate_password
from rest_framework import viewsets, status, serializers
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import ValidationError

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
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
        except ValidationError as e:
            # Erros por campo vindos do serializer (ex.: {"email":["já existe"], "password":["curta"]})
            return Response(e.detail, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            msg = str(e).lower()
            # Unique em email/username → erro no campo correspondente
            if "unique" in msg and "email" in msg:
                return Response({"email": ["Já existe um usuário com este e-mail."]}, status=status.HTTP_400_BAD_REQUEST)
            if "unique" in msg and "username" in msg:
                return Response({"username": ["Já existe um usuário com este username."]}, status=status.HTTP_400_BAD_REQUEST)
            return Response({"detail": "Não foi possível criar o usuário."}, status=status.HTTP_400_BAD_REQUEST)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        try:
            serializer.is_valid(raise_exception=True)
            self.perform_update(serializer)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except ValidationError as e:
            return Response(e.detail, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            msg = str(e).lower()
            if "unique" in msg and "email" in msg:
                return Response({"email": ["Já existe um usuário com este e-mail."]}, status=status.HTTP_400_BAD_REQUEST)
            if "unique" in msg and "username" in msg:
                return Response({"username": ["Já existe um usuário com este username."]}, status=status.HTTP_400_BAD_REQUEST)
            return Response({"detail": "Não foi possível atualizar o usuário."}, status=status.HTTP_400_BAD_REQUEST)

    def destroy(self, request, *args, **kwargs):
        try:
            super().destroy(request, *args, **kwargs)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            return Response({"detail": f"Falha ao excluir usuário: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)

    @action(
        detail=True,
        methods=["post"],
        url_path="trocar_senha",
        permission_classes=[IsAuthenticated]
    )
    def trocar_senha(self, request, pk=None):
        """
        - Master → pode alterar a senha de qualquer usuário (NÃO exige senha atual do alvo)
        - Gestor → só pode alterar a própria senha (EXIGE senha atual)
        Retorna erros por campo: {"senha_atual": [...], "nova_senha": [...]}.
        """
        usuario_alvo = self.get_object()
        solicitante = request.user
        is_master = (solicitante.perfil == "master")
        is_self = (solicitante.id == usuario_alvo.id)

        # 🔒 Permissão
        if not is_master and not is_self:
            return Response({"detail": "Você não tem permissão para alterar a senha de outro usuário."},
                            status=status.HTTP_403_FORBIDDEN)

        senha_atual = request.data.get("senha_atual")
        nova_senha = request.data.get("nova_senha")
        confirmar  = request.data.get("confirmar_senha")

        # Campos obrigatórios
        errors = {}
        if not nova_senha:
            errors["nova_senha"] = ["Campo obrigatório."]
        if confirmar is not None and nova_senha and confirmar != nova_senha:
            errors["confirmar_senha"] = ["A confirmação não confere."]
        # Gestor (ou auto alteração) precisa informar senha_atual correta
        if not is_master or is_self:
            if not senha_atual:
                errors["senha_atual"] = ["Campo obrigatório."]
            elif not usuario_alvo.check_password(senha_atual):
                errors["senha_atual"] = ["Senha atual incorreta."]

        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        # Validação de complexidade da nova senha
        try:
            validate_password(nova_senha, user=usuario_alvo)
        except ValidationError as e:
            # DRF ValidationError contém lista de mensagens
            return Response({"nova_senha": e.detail}, status=status.HTTP_400_BAD_REQUEST)

        # Persistir
        usuario_alvo.set_password(nova_senha)
        usuario_alvo.save()

        LogDeAcao.objects.create(
            usuario=solicitante,
            acao=f"Alterou a senha do usuário '{usuario_alvo.first_name or usuario_alvo.email}'"
        )
        return Response({"mensagem": "Senha alterada com sucesso."}, status=status.HTTP_200_OK)
