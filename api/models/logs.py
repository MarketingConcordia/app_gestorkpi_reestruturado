from django.db import models
from .usuarios import Usuario


# ======================
# 🔹 LOG DE AÇÕES
# ======================
class LogDeAcao(models.Model):
    usuario = models.ForeignKey(Usuario, on_delete=models.SET_NULL, null=True)
    acao = models.CharField(max_length=255)
    data = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.usuario} - {self.acao} - {self.data.strftime('%d/%m/%Y %H:%M')}"
