from rest_framework import serializers
from api.models import LogDeAcao


# =============================
# 🔹 LOG DE AÇÕES
# =============================
class LogDeAcaoSerializer(serializers.ModelSerializer):
    usuario_nome = serializers.SerializerMethodField()

    class Meta:
        model = LogDeAcao
        fields = ['id', 'usuario_nome', 'acao', 'data']

    def get_usuario_nome(self, obj):
        if obj.usuario:
            return obj.usuario.first_name or obj.usuario.username
        return "Usuário removido"
