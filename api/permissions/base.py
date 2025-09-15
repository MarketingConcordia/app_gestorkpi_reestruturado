from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsMasterUser(BasePermission):
    """Permite acesso apenas para usuários Master."""
    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and getattr(user, "perfil", None) == "master")

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


class IsGestorUser(BasePermission):
    """Permite acesso apenas para usuários Gestores."""
    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and getattr(user, "perfil", None) == "gestor")

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


class IsMasterOrReadOnly(BasePermission):
    """Permite leitura para todos autenticados; escrita apenas para Master."""
    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if request.method in SAFE_METHODS:
            return bool(user and user.is_authenticated)
        return bool(user and user.is_authenticated and getattr(user, "perfil", None) == "master")

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)
