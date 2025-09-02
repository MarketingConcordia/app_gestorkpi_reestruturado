from django.db import models


# ======================
# 🔹 CONFIGURAÇÃO DE ARMAZENAMENTO
# ======================
class ConfiguracaoArmazenamento(models.Model):
    TIPOS_ARMAZENAMENTO = [
        ('local', 'Local'),
        ('aws', 'AWS S3'),
        ('azure', 'Azure Blob Storage'),
        ('gcp', 'Google Cloud Storage'),
    ]

    tipo = models.CharField(max_length=10, choices=TIPOS_ARMAZENAMENTO, default='local')

    dia_limite_preenchimento = models.PositiveSmallIntegerField(
        default=10,
        verbose_name="Dia limite para preenchimento",
        help_text="Apenas até esse dia do mês os gestores poderão preencher indicadores."
    )

    # AWS
    aws_access_key = models.CharField(max_length=200, blank=True, null=True)
    aws_secret_key = models.CharField(max_length=200, blank=True, null=True)
    aws_bucket_name = models.CharField(max_length=200, blank=True, null=True)
    aws_region = models.CharField(max_length=50, blank=True, null=True)

    # Azure
    azure_connection_string = models.TextField(blank=True, null=True)
    azure_container = models.CharField(max_length=200, blank=True, null=True)

    # Google Cloud
    gcp_credentials_json = models.TextField(blank=True, null=True)
    gcp_bucket_name = models.CharField(max_length=200, blank=True, null=True)

    ativo = models.BooleanField(default=True)

    criado_em = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Armazenamento: {self.tipo}"


# ======================
# 🔹 CONFIGURAÇÃO DE NOTIFICAÇÕES
# ======================
class ConfiguracaoNotificacao(models.Model):
    DESTINATARIOS = [
        ('master', 'Master (CEO)'),
        ('gestor', 'Gestores'),
        ('todos', 'Master e Gestores'),
    ]

    nome = models.CharField(max_length=100)
    mensagem = models.TextField()
    dia_do_mes = models.IntegerField()
    repetir_todo_mes = models.BooleanField(default=True)
    destinatarios = models.CharField(max_length=10, choices=DESTINATARIOS)
    ativo = models.BooleanField(default=True)
    criado_em = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.nome} - Dia {self.dia_do_mes}"


# ======================
# 🔹 CONFIGURAÇÃO DE PREENCHIMENTO
# ======================
class Configuracao(models.Model):
    dia_limite_preenchimento = models.PositiveIntegerField(default=10)

    def __str__(self):
        return f"Dia limite: {self.dia_limite_preenchimento}"
