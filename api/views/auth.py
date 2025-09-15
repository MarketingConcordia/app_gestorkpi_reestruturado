from rest_framework import serializers, permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import authenticate

from api.serializers import UsuarioSerializer

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser


# =========================
#   LOGIN (JWT custom)
# =========================
class MyTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        # Normaliza e-mail para evitar falhas por caixa/espaços
        email = (attrs.get("email") or "").strip().lower()
        password = attrs.get("password")

        if not email or not password:
            raise serializers.ValidationError({"detail": "Email e senha são obrigatórios."})

        user = authenticate(request=self.context.get("request"), email=email, password=password)
        if not user:
            # Mensagem neutra (não revela qual campo errou)
            raise serializers.ValidationError({"detail": "Email ou senha incorretos."})

        if not user.is_active:
            raise serializers.ValidationError({"detail": "Conta inativa."})

        # Garante que o SimpleJWT continue o fluxo normal (gera tokens)
        self.user = user
        # Opcional: atualiza o attrs com e-mail normalizado (não é estritamente necessário)
        attrs["email"] = email
        return super().validate(attrs)


class MyTokenObtainPairView(TokenObtainPairView):
    serializer_class = MyTokenObtainPairSerializer


# =========================
#  ENDPOINT AUXILIAR
# =========================
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    """
    Retorna os dados do usuário autenticado.
    - Usado pelo frontend após login para obter perfil (Master/Gestor, setores, etc.)
    """
    serializer = UsuarioSerializer(request.user)
    return Response(serializer.data, status=status.HTTP_200_OK)


UserModel = get_user_model()

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def meu_usuario(request):
    """
    Retorna os dados do usuário autenticado, de forma defensiva:
    - Se for o modelo correto -> Usa UsuarioSerializer
    - Se vier outro tipo inesperado -> devolve payload mínimo (sem 500)
    """
    user = request.user

    if isinstance(user, AnonymousUser) or not getattr(user, "is_authenticated", False):
        return Response({"detail": "Usuário não autenticado."}, status=401)

    try:
        # Caminho feliz: nosso model custom
        if isinstance(user, UserModel):
            return Response(UsuarioSerializer(user).data)

        # Fallback seguro: monta um JSON básico e evita 500
        data = {
            "id": getattr(user, "id", None),
            "email": getattr(user, "email", "") or getattr(user, "username", ""),
            "first_name": getattr(user, "first_name", "") or "",
            "last_name": getattr(user, "last_name", "") or "",
            "perfil": getattr(user, "perfil", None)
                      or ("master" if getattr(user, "is_superuser", False) else "gestor"),
            "is_active": getattr(user, "is_active", True),
            "setores": [],  # evita acessar M2M se não existir
        }
        return Response(data)
    except Exception as e:
        # Nunca envie HTML de erro para o front nesta rota
        return Response({"detail": f"Falha ao serializar usuário: {str(e)}"}, status=500)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def usuario_logado(request):
    # Mantém compat e elimina duplicação
    return me(request)
