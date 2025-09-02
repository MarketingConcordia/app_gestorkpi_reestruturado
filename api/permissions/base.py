from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsMasterUser(BasePermission):
    """Permite acesso apenas para usuários Master."""
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and request.user.perfil == 'master'


class IsGestorUser(BasePermission):
    """Permite acesso apenas para usuários Gestores."""
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and request.user.perfil == 'gestor'


class IsMasterOrReadOnly(BasePermission):
    """Permite leitura para todos autenticados, escrita apenas para Master."""
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return request.user.is_authenticated
        return request.user and request.user.perfil == 'master'
