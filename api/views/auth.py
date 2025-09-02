from rest_framework import serializers, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import authenticate

from api.serializers import UsuarioSerializer
from django.contrib.auth.models import AnonymousUser


# =========================
#   LOGIN (JWT custom)
# =========================
class MyTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        email = attrs.get("email")
        password = attrs.get("password")

        if not email or not password:
            raise serializers.ValidationError({"detail": "Email e senha são obrigatórios."})

        user = authenticate(request=self.context.get("request"), email=email, password=password)
        if not user:
            raise serializers.ValidationError({"detail": "Email ou senha incorretos."})

        if not user.is_active:
            raise serializers.ValidationError({"detail": "Conta inativa."})

        self.user = user
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
    return Response(serializer.data)

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def meu_usuario(request):
    if isinstance(request.user, AnonymousUser):
        return Response({"detail": "Usuário não autenticado."}, status=401)
    serializer = UsuarioSerializer(request.user)
    return Response(serializer.data)

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def usuario_logado(request):
    return me(request)
