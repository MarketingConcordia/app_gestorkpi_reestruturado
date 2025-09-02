from .base import IsMasterUser, IsGestorUser, IsMasterOrReadOnly
from .indicadores import HasIndicadorPermission

__all__ = [
    "IsMasterUser",
    "IsGestorUser",
    "IsMasterOrReadOnly",
    "HasIndicadorPermission",
]
