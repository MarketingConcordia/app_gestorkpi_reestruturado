from datetime import date, datetime
from dateutil.relativedelta import relativedelta
from rest_framework import serializers

from api.models import Indicador, Meta, MetaMensal
from api.utils import parse_mes_inicial, normalize_number


# =============================
# 🔹 Helpers
# =============================
def _parse_mes_inicial(v):
    """
    Aceita:
      - None / '' → None
      - date
      - 'YYYY-MM' → primeiro dia do mês
      - 'YYYY-MM-DD' → normaliza para primeiro dia do mês
    """
    if v in (None, ''):
        return None
    if isinstance(v, date):
        return date(v.year, v.month, 1)
    if isinstance(v, str):
        s = v.strip()
        if len(s) == 7 and s.count('-') == 1:  # 'YYYY-MM'
            year = int(s[:4])
            month = int(s[5:7])
            return date(year, month, 1)
        if len(s) == 10 and s.count('-') == 2:  # 'YYYY-MM-DD'
            dt = datetime.strptime(s, '%Y-%m-%d').date()
            return date(dt.year, dt.month, 1)
    return v


def _normalize_number(value, field_name="valor"):
    """
    Normaliza número aceitando formatos como:
      - "100", "100,5", "100.5", "1.234,56", "1,234.56"
    Regra: o ÚLTIMO separador (',' ou '.') é o decimal; os demais são milhares.
    Retorna float.
    """
    if value in (None, ''):
        return None

    s = str(value).strip().replace(' ', '')
    last_comma = s.rfind(',')
    last_dot = s.rfind('.')
    dec_pos = max(last_comma, last_dot)

    digits = ''.join(ch for ch in s if ch.isdigit())

    if dec_pos == -1:
        try:
            return float(digits)
        except Exception:
            raise serializers.ValidationError(f"{field_name} deve ser numérico.")

    after = ''.join(ch for ch in s[dec_pos + 1:] if ch.isdigit())

    if after == '':
        try:
            return float(digits)
        except Exception:
            raise serializers.ValidationError(f"{field_name} deve ser numérico.")

    int_len = len(digits) - len(after)
    if int_len <= 0:
        num_str = "0." + digits.zfill(len(after))
    else:
        num_str = digits[:int_len] + "." + digits[int_len:]

    try:
        return float(num_str)
    except Exception:
        raise serializers.ValidationError(f"{field_name} deve ser numérico.")


# =============================
# 🔹 INDICADORES
# =============================
class IndicadorSerializer(serializers.ModelSerializer):
    setor_nome = serializers.CharField(source='setor.nome', read_only=True)
    status = serializers.SerializerMethodField()
    metas_mensais = serializers.SerializerMethodField()

    class Meta:
        model = Indicador
        fields = [
            'id', 'nome', 'setor', 'setor_nome',
            'tipo_meta', 'tipo_valor',
            'status', 'valor_meta',
            'criado_em', 'periodicidade',
            'mes_inicial', 'visibilidade',
            'extracao_indicador',
            'metas_mensais', 'ativo',
        ]
        extra_kwargs = {
            'extracao_indicador': {'required': False, 'allow_null': True, 'allow_blank': True},
            'mes_inicial': {'required': False, 'allow_null': True},
            'periodicidade': {'required': False},
        }

    def validate_mes_inicial(self, v):
        return parse_mes_inicial(v)

    def validate_valor_meta(self, v):
        if v in (None, ''):
            raise serializers.ValidationError("valor_meta é obrigatório.")
        return normalize_number(v, "valor_meta")

    def validate_periodicidade(self, v):
        if v in (None, ''):
            return 1
        try:
            v = int(v)
        except Exception:
            raise serializers.ValidationError("periodicidade deve ser inteiro.")
        if v <= 0:
            raise serializers.ValidationError("periodicidade deve ser >= 1.")
        return v

    def get_status(self, obj):
        hoje = date.today()
        preenchido = obj.preenchimento_set.filter(
            mes=hoje.month, ano=hoje.year, valor_realizado__isnull=False
        ).exists()
        return "Concluído" if preenchido else "Pendente"

    def get_metas_mensais(self, obj):
        metas_qs = MetaMensal.objects.filter(indicador=obj).order_by("mes")
        if not metas_qs.exists() and obj.mes_inicial:
            data_base = date(obj.mes_inicial.year, obj.mes_inicial.month, 1)
            for i in range(12):
                mes = data_base + relativedelta(months=i)
                MetaMensal.objects.create(
                    indicador=obj,
                    mes=mes,
                    valor_meta=obj.valor_meta
                )
            metas_qs = MetaMensal.objects.filter(indicador=obj).order_by("mes")

        return [
            {
                "id": meta.id,
                "mes": meta.mes.strftime("%Y-%m-%d"),
                "valor_meta": float(meta.valor_meta),
            }
            for meta in metas_qs
        ]


    def create(self, validated_data):
        indicador = super().create(validated_data)

        data_base = validated_data.get('mes_inicial') or date.today()
        data_base = date(data_base.year, data_base.month, 1)

        if not MetaMensal.objects.filter(indicador=indicador).exists():
            for i in range(12):
                mes = data_base + relativedelta(months=i)
                MetaMensal.objects.create(
                    indicador=indicador,
                    mes=mes,
                    valor_meta=indicador.valor_meta
                )

        return indicador


# =============================
# 🔹 METAS
# =============================
class MetaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Meta
        fields = '__all__'


class MetaMensalSerializer(serializers.ModelSerializer):
    mes = serializers.DateField(format='%Y-%m-%d')

    class Meta:
        model = MetaMensal
        fields = ['id', 'indicador', 'mes', 'valor_meta']
