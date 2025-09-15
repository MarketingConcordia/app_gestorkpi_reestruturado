from django.db import models
from django.db.models import Q


class Setor(models.Model):
    nome = models.CharField(max_length=100, unique=True)
    ativo = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Setor"
        verbose_name_plural = "Setores"
        ordering = ('nome',)
        constraints = [
            # Evita nome vazio ou apenas espaços
            models.CheckConstraint(
                check=~Q(nome__regex=r'^\s*$'),
                name='ck_setor_nome_nao_vazio'
            ),
        ]
        indexes = [
            models.Index(fields=['ativo'], name='idx_setor_ativo'),
            models.Index(fields=['nome'], name='idx_setor_nome'),
        ]

    def __str__(self):
        return self.nome
