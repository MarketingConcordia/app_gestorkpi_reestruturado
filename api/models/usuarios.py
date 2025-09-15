from django.db import models
from django.contrib.auth.models import AbstractUser
from django.db.models.functions import Lower
from .setores import Setor
from .managers import UsuarioManager  # importar o novo manager


class Usuario(AbstractUser):
    # Removemos o username do AbstractUser para usar e-mail como identificador
    username = None

    PERFIS = (
        ('master', 'Master'),
        ('gestor', 'Gestor'),
    )

    email = models.EmailField(unique=True)
    perfil = models.CharField(max_length=10, choices=PERFIS, default='gestor')
    setores = models.ManyToManyField(Setor, blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []  # não pede username
    objects = UsuarioManager()  # usar o manager certo

    class Meta:
        verbose_name = "Usuário"
        verbose_name_plural = "Usuários"
        ordering = ('email',)
        constraints = [
            # Unicidade case-insensitive no e-mail (PostgreSQL)
            models.UniqueConstraint(
                Lower('email'),
                name='uq_usuario_email_lower'
            )
        ]
        indexes = [
            models.Index(fields=['perfil'], name='idx_usuario_perfil'),
            models.Index(fields=['is_active', 'perfil'], name='idx_usuario_ativo_perfil'),
        ]

    def __str__(self):
        nome = (self.first_name or '').strip()
        return nome + f" ({self.get_perfil_display()})" if nome else f"{self.email} ({self.get_perfil_display()})"
