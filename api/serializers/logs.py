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
        read_only_fields = ['id', 'usuario_nome', 'data']

    def get_usuario_nome(self, obj):
        u = obj.usuario
        if not u:
            return "Usuário removido"
        # Prioriza first_name; se vazio, cai para o e-mail
        nome = (u.first_name or "").strip()
        return nome if nome else (u.email or "Usuário")
