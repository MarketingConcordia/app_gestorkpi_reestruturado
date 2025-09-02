from rest_framework.permissions import BasePermission
from api.models import PermissaoIndicador


class HasIndicadorPermission(BasePermission):
    """
    Permite acesso ao indicador se:
      - Usuário é Master
      - Usuário é Gestor e o indicador é visível
      - Usuário é Gestor e tem permissão manual (PermissaoIndicador)
    """
    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.perfil == 'master':
            return True
        if obj.visibilidade:
            return True
        return PermissaoIndicador.objects.filter(usuario=user, indicador=obj).exists()
