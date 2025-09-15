from django.db import models
from django.db.models import Q
from .usuarios import Usuario


# ======================
# 🔹 LOG DE AÇÕES
# ======================
class LogDeAcao(models.Model):
    usuario = models.ForeignKey(Usuario, on_delete=models.SET_NULL, null=True)
    acao = models.CharField(max_length=255)
    data = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Log de Ação"
        verbose_name_plural = "Logs de Ações"
        ordering = ('-data',)
        constraints = [
            # Evita salvar acao em branco (apenas espaços)
            models.CheckConstraint(
                check=~Q(acao__regex=r'^\s*$'),
                name='ck_log_de_acao_acoes_nao_vazias'
            ),
        ]
        indexes = [
            models.Index(fields=['usuario', 'data'], name='idx_log_usuario_data'),
            models.Index(fields=['data'], name='idx_log_data'),
        ]

    def __str__(self):
        return f"{self.usuario} - {self.acao} - {self.data.strftime('%d/%m/%Y %H:%M')}"
