from datetime import date
from rest_framework import serializers

from api.models import Preenchimento, MetaMensal, Indicador
from api.utils import normalize_number
from api.utils.periodicidade import mes_alinhado

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
    confirmado = serializers.BooleanField(read_only=True)

    class Meta:
        model = Preenchimento
        fields = [
            'id', 'indicador', 'valor_realizado', 'confirmado', 'data_preenchimento',
            'indicador_nome', 'setor_nome', 'setor_id', 'tipo_meta', 'tipo_valor',
            'indicador_mes_inicial', 'indicador_periodicidade',
            'meta', 'mes', 'ano',
            'comentario', 'arquivo', 'origem', 'preenchido_por'
        ]
        read_only_fields = ('id', 'data_preenchimento', 'preenchido_por', 'confirmado')
        extra_kwargs = {
            # ✅ agora pode ser nulo
            'valor_realizado': {'required': False, 'allow_null': True},
            'origem': {'required': False, 'allow_null': True, 'allow_blank': True},
        }

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
        # ✅ se não veio valor, mantenha None (placeholder/pendente)
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

    # ✅ NOVO: valida combinação indicador/ano/mês contra a periodicidade
    def validate(self, attrs):
        indicador = attrs.get("indicador") or getattr(self.instance, "indicador", None)
        ano = attrs.get("ano") or getattr(self.instance, "ano", None)
        mes = attrs.get("mes") or getattr(self.instance, "mes", None)

        # Se já temos os 3 valores, checamos alinhamento
        if indicador is not None and ano is not None and mes is not None:
            try:
                ano_i = int(ano)
                mes_i = int(mes)
            except Exception:
                # As validações específicas de ano/mes já tratam tipos/intervalo
                return attrs

            if not mes_alinhado(indicador, ano_i, mes_i):
                raise serializers.ValidationError({
                    "mes": "Mês/ano fora da periodicidade do indicador."
                })

        return attrs

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
