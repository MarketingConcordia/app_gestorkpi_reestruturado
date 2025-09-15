from datetime import date
from rest_framework import serializers

from api.models import Preenchimento, MetaMensal, Indicador
from api.utils import normalize_number


# =============================
# 🔹 PREENCHIMENTOS
# =============================
class PreenchimentoSerializer(serializers.ModelSerializer):
    indicador = serializers.PrimaryKeyRelatedField(
        queryset=Indicador.objects.all()
    )
    indicador_nome = serializers.CharField(source='indicador.nome', read_only=True)
    setor_nome = serializers.CharField(source='indicador.setor.nome', read_only=True)
    tipo_meta = serializers.CharField(source='indicador.tipo_meta', read_only=True)
    tipo_valor = serializers.CharField(source='indicador.tipo_valor', read_only=True)
    indicador_mes_inicial = serializers.DateField(source='indicador.mes_inicial', read_only=True)
    indicador_periodicidade = serializers.IntegerField(source='indicador.periodicidade', read_only=True)
    preenchido_por = serializers.SerializerMethodField()
    meta = serializers.SerializerMethodField()
    setor_id = serializers.IntegerField(source='indicador.setor.id', read_only=True)

    class Meta:
        model = Preenchimento
        fields = [
            'id', 'indicador', 'valor_realizado', 'data_preenchimento',
            'indicador_nome', 'setor_nome', 'setor_id', 'tipo_meta', 'tipo_valor',
            'indicador_mes_inicial', 'indicador_periodicidade',
            'meta', 'mes', 'ano',
            'comentario', 'arquivo', 'preenchido_por'
        ]
        read_only_fields = ('id', 'data_preenchimento', 'preenchido_por')

    # ---- validações ----
    def validate_mes(self, v):
        try:
            v = int(v)
        except Exception:
            raise serializers.ValidationError("mes deve ser inteiro.")
        if v < 1 or v > 12:
            raise serializers.ValidationError("mes deve estar entre 1 e 12.")
        return v

    def validate_ano(self, v):
        try:
            v = int(v)
        except Exception:
            raise serializers.ValidationError("ano deve ser inteiro.")
        if v < 1900 or v > 2100:
            raise serializers.ValidationError("ano inválido.")
        return v

    def validate_valor_realizado(self, v):
        if v in (None, ''):
            return None
        return normalize_number(v, "valor_realizado")

    def validate_arquivo(self, value):
        if not value:
            return value
        max_size = 2 * 1024 * 1024  # 2MB
        try:
            if value.size > max_size:
                raise serializers.ValidationError("O arquivo enviado é muito grande. Máx: 2MB.")
        except AttributeError:
            pass
        return value

    def get_meta(self, obj):
        try:
            mes_data = date(obj.ano, obj.mes, 1)
            meta_obj = MetaMensal.objects.filter(indicador=obj.indicador, mes=mes_data).first()
            if meta_obj:
                return float(meta_obj.valor_meta)
            # fallback para meta padrão do indicador
            return float(obj.indicador.valor_meta) if obj.indicador and obj.indicador.valor_meta is not None else None
        except Exception:
            return float(obj.indicador.valor_meta) if obj.indicador and obj.indicador.valor_meta is not None else None

    def get_preenchido_por(self, obj):
        """
        Mantém a chave 'username' por compatibilidade com o front,
        mas usa o e-mail, pois o modelo de usuário não tem mais 'username'.
        """
        u = obj.preenchido_por
        if not u:
            return None
        return {
            "id": u.id,
            "first_name": u.first_name,
            "username": u.email  # compat: front continua lendo 'username'
        }


# =============================
# 🔹 HISTÓRICO SIMPLES
# =============================
class PreenchimentoHistoricoSerializer(serializers.ModelSerializer):
    tipo_valor = serializers.CharField(source='indicador.tipo_valor', read_only=True)

    class Meta:
        model = Preenchimento
        fields = [
            'data_preenchimento', 'valor_realizado', 'comentario',
            'arquivo', 'mes', 'ano', 'tipo_valor'
        ]
        read_only_fields = ('data_preenchimento',)
