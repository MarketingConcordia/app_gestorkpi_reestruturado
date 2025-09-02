from rest_framework import serializers
from api.models import Configuracao, ConfiguracaoArmazenamento


# =============================
# 🔹 CONFIGURAÇÃO PREENCHIMENTO
# =============================
class ConfiguracaoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Configuracao
        fields = '__all__'


# =============================
# 🔹 ARMAZENAMENTO
# =============================
class ConfiguracaoArmazenamentoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfiguracaoArmazenamento
        fields = '__all__'
