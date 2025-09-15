from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db.models import Q


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
        validators=[MinValueValidator(1), MaxValueValidator(31)],
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

    class Meta:
        verbose_name = "Configuração de Armazenamento"
        verbose_name_plural = "Configurações de Armazenamento"
        ordering = ('-criado_em',)
        # 🔐 Uma única configuração ativa por vez (PostgreSQL dá suporte a índice parcial)
        constraints = [
            models.CheckConstraint(
                check=Q(dia_limite_preenchimento__gte=1) & Q(dia_limite_preenchimento__lte=31),
                name='ck_config_arm_dia_limite_1_31'
            ),
            models.UniqueConstraint(
                fields=['ativo'],
                condition=Q(ativo=True),
                name='uq_config_arm_uma_ativa'
            ),
        ]
        indexes = [
            models.Index(fields=['ativo'], name='idx_config_arm_ativo'),
            models.Index(fields=['tipo'], name='idx_config_arm_tipo'),
        ]

    def __str__(self):
        return f"Armazenamento: {self.tipo}"

    def clean(self):
        """
        Valida obrigatoriedade de credenciais de acordo com o 'tipo'.
        Observação: chame full_clean() no serializer antes de salvar.
        """
        tipo = self.tipo
        errors = {}

        if tipo == 'aws':
            required = {
                'aws_access_key': self.aws_access_key,
                'aws_secret_key': self.aws_secret_key,
                'aws_bucket_name': self.aws_bucket_name,
                'aws_region': self.aws_region,
            }
            faltando = [k for k, v in required.items() if not v]
            if faltando:
                errors['aws'] = f"Campos obrigatórios ausentes para AWS: {', '.join(faltando)}"

        elif tipo == 'azure':
            if not self.azure_connection_string or not self.azure_container:
                errors['azure'] = "Campos obrigatórios para Azure: azure_connection_string e azure_container."

        elif tipo == 'gcp':
            if not self.gcp_credentials_json or not self.gcp_bucket_name:
                errors['gcp'] = "Campos obrigatórios para GCP: gcp_credentials_json e gcp_bucket_name."

        if errors:
            from django.core.exceptions import ValidationError
            raise ValidationError(errors)


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
    dia_do_mes = models.IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(31)],
        help_text="Dia do mês em que a notificação será disparada."
    )
    repetir_todo_mes = models.BooleanField(default=True)
    destinatarios = models.CharField(max_length=10, choices=DESTINATARIOS)
    ativo = models.BooleanField(default=True)
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Configuração de Notificação"
        verbose_name_plural = "Configurações de Notificação"
        ordering = ('-criado_em',)
        constraints = [
            models.CheckConstraint(
                check=Q(dia_do_mes__gte=1) & Q(dia_do_mes__lte=31),
                name='ck_config_notif_dia_1_31'
            ),
        ]
        indexes = [
            models.Index(fields=['ativo'], name='idx_config_notif_ativo'),
            models.Index(fields=['dia_do_mes'], name='idx_config_notif_dia'),
        ]

    def __str__(self):
        return f"{self.nome} - Dia {self.dia_do_mes}"


# ======================
# 🔹 CONFIGURAÇÃO DE PREENCHIMENTO
# ======================
class Configuracao(models.Model):
    dia_limite_preenchimento = models.PositiveIntegerField(
        default=10,
        validators=[MinValueValidator(1), MaxValueValidator(31)],
        help_text="Até esse dia os gestores podem preencher indicadores."
    )

    class Meta:
        verbose_name = "Configuração de Preenchimento"
        verbose_name_plural = "Configurações de Preenchimento"

    def __str__(self):
        return f"Dia limite: {self.dia_limite_preenchimento}"
