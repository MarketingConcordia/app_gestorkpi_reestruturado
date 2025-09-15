from django.db import models
from django.conf import settings
from datetime import date
from django.core.validators import MinValueValidator, MaxValueValidator

from .setores import Setor
from .usuarios import Usuario


# ======================
# 🔹 INDICADORES (Master)
# ======================
class Indicador(models.Model):
    TIPO_META_CHOICES = [
        ('crescente', 'Para cima'),
        ('decrescente', 'Para baixo'),
        ('monitoramento', 'Monitoramento'),
    ]

    STATUS_CHOICES = [
        ('pendente', 'Pendente'),
        ('concluido', 'Concluído'),
    ]

    TIPO_VALOR_CHOICES = [
        ('numeral', 'Numeral'),
        ('monetario', 'Monetário'),
        ('percentual', 'Percentual'),
    ]

    nome = models.CharField(max_length=255)
    setor = models.ForeignKey(Setor, on_delete=models.CASCADE, related_name='indicadores')
    tipo_meta = models.CharField(max_length=20, choices=TIPO_META_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pendente')
    valor_meta = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tipo_valor = models.CharField(max_length=20, choices=TIPO_VALOR_CHOICES, default='numeral')
    criado_em = models.DateTimeField(auto_now_add=True)
    periodicidade = models.PositiveIntegerField(
        default=1,
        validators=[MinValueValidator(1), MaxValueValidator(12)],
        help_text="Periodicidade em meses (1 a 12)"
    )
    mes_inicial = models.DateField(null=True, blank=True)
    mes_final   = models.DateField(null=True, blank=True)
    visibilidade = models.BooleanField(default=True, help_text="Se o indicador será visível para todos")
    extracao_indicador = models.TextField(blank=True, help_text="Instruções de como extrair esse indicador")
    ativo = models.BooleanField(default=True, help_text="Se o indicador está ativo ou inativo")

    class Meta:
        ordering = ('-criado_em',)
        indexes = [
            models.Index(fields=['ativo'], name='idx_indicador_ativo'),
            models.Index(fields=['status'], name='idx_indicador_status'),
            models.Index(fields=['setor', 'ativo'], name='idx_indicador_setor_ativo'),
        ]

    def buscar_meta_para_mes(self, ano, mes):
        data = date(ano, mes, 1)
        return self.metas_mensais.filter(mes=data).first()

    def __str__(self):
        return self.nome


# ======================
# 🔹 METAS
# ======================
class Meta(models.Model):
    indicador = models.ForeignKey(Indicador, on_delete=models.CASCADE)
    valor_esperado = models.DecimalField(max_digits=10, decimal_places=2)
    mes = models.IntegerField(validators=[MinValueValidator(1), MaxValueValidator(12)])
    ano = models.IntegerField()
    definida_por = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        unique_together = ('indicador', 'mes', 'ano')
        indexes = [
            models.Index(fields=['indicador', 'ano', 'mes'], name='idx_meta_indicador_ano_mes'),
        ]

    def __str__(self):
        return f"Meta de {self.indicador.nome} para {self.mes}/{self.ano}"


class MetaMensal(models.Model):
    indicador = models.ForeignKey(Indicador, on_delete=models.CASCADE, related_name='metas_mensais')
    mes = models.DateField(help_text="Representa o mês da meta. Use sempre o primeiro dia do mês.")
    valor_meta = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        unique_together = ['indicador', 'mes']
        ordering = ['mes']
        indexes = [
            models.Index(fields=['mes'], name='idx_meta_mensal_mes'),
        ]

    def __str__(self):
        return f"{self.indicador.nome} - {self.mes.strftime('%m/%Y')} : {self.valor_meta}"


# ======================
# 🔹 PREENCHIMENTOS
# ======================
class Preenchimento(models.Model):
    indicador = models.ForeignKey(Indicador, on_delete=models.CASCADE, related_name='preenchimentos')
    valor_realizado = models.DecimalField(max_digits=10, decimal_places=2)
    mes = models.IntegerField(validators=[MinValueValidator(1), MaxValueValidator(12)])
    ano = models.IntegerField()
    preenchido_por = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    data_preenchimento = models.DateTimeField(auto_now_add=True)
    comentario = models.TextField(blank=True, null=True)
    arquivo = models.FileField(upload_to='provas/', blank=True, null=True)
    origem = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        unique_together = ('indicador', 'mes', 'ano', 'preenchido_por')
        indexes = [
            models.Index(fields=['indicador', 'ano', 'mes'], name='idx_preench_indicador_ano_mes'),
            models.Index(fields=['data_preenchimento'], name='idx_preench_data'),
        ]
        ordering = ('-data_preenchimento',)

    def __str__(self):
        return f"{self.indicador.nome} - {self.valor_realizado} ({self.mes}/{self.ano})"

    @property
    def competencia_primeiro_dia(self):
        """
        Utilitário para normalizar consultas por 'competência' como date(ano, mes, 1)
        sem alterar o schema atual.
        """
        return date(self.ano, self.mes, 1)


# ======================
# 🔹 PERMISSÃO POR INDICADOR
# ======================
class PermissaoIndicador(models.Model):
    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE)
    indicador = models.ForeignKey(Indicador, on_delete=models.CASCADE)

    class Meta:
        unique_together = (('usuario', 'indicador'),)
        indexes = [
            models.Index(fields=['usuario', 'indicador'], name='idx_perm_user_ind'),
        ]

    def __str__(self):
        return f"{self.usuario} - {self.indicador}"
