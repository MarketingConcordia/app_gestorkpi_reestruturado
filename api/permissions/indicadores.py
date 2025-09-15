from rest_framework.permissions import BasePermission
from api.models import PermissaoIndicador


class HasIndicadorPermission(BasePermission):
    """
    Permite acesso ao indicador se:
      - Usuário é Master
      - Usuário é Gestor E o indicador pertence a um dos seus setores
      - Indicador é visível (visibilidade=True)
      - Usuário tem permissão manual (PermissaoIndicador)
    """
    def has_object_permission(self, request, view, obj):
        user = request.user

        # Master sempre pode
        if getattr(user, "perfil", None) == "master":
            return True

        # Gestor do mesmo setor do indicador
        try:
            if getattr(user, "perfil", None) == "gestor":
                if obj.setor_id in user.setores.values_list("id", flat=True):
                    return True
        except Exception:
            # se por algum motivo user.setores não estiver acessível, seguimos avaliando as demais regras
            pass

        # Indicador público
        if getattr(obj, "visibilidade", False):
            return True

        # Permissão manual
        return PermissaoIndicador.objects.filter(usuario=user, indicador=obj).exists()
