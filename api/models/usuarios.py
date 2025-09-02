from django.db import models
from django.contrib.auth.models import AbstractUser
from .setores import Setor
from .managers import UsuarioManager  # importar o novo manager

class Usuario(AbstractUser):
    PERFIS = (
        ('master', 'Master'),
        ('gestor', 'Gestor'),
    )

    email = models.EmailField(unique=True)
    perfil = models.CharField(max_length=10, choices=PERFIS, default='gestor')
    setores = models.ManyToManyField(Setor, blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []  # não pede username mais
    objects = UsuarioManager()  # usar o manager certo

    def __str__(self):
        return f"{self.first_name} ({self.get_perfil_display()})"
