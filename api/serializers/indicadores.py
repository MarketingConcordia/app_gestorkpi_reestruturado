from typing import Optional
from datetime import date
from dateutil.relativedelta import relativedelta
from django.db import transaction
from django.db.models import Q
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from api.models import Indicador, Meta, MetaMensal, Preenchimento
from api.utils import parse_mes_inicial, normalize_number
from api.utils.periodicidade import meses_permitidos

def _first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)

def _last_month_first_day(today: Optional[date] = None) -> date:
    t = today or date.today()
    # início do mês passado
    return _first_of_month(t) - relativedelta(months=1)

# ========= NOVOS HELPERS =========
# =============================
# 🔧 Base com full_clean
# =============================
class CleanModelSerializer(serializers.ModelSerializer):
    """
    Serializer base que garante full_clean() antes de salvar,
    convertendo ValidationError do Django em DRF ValidationError.
    """
    def _full_clean_and_save(self, instance):
        try:
            instance.full_clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.message_dict or e.messages)
        instance.save()
        return instance

    def create(self, validated_data):
        instance = super().create(validated_data)
        return self._full_clean_and_save(instance)

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        return self._full_clean_and_save(instance)


# =============================
# 🔹 INDICADORES
# =============================
class IndicadorSerializer(CleanModelSerializer):
    setor_nome = serializers.CharField(source='setor.nome', read_only=True)
    status = serializers.SerializerMethodField()
    metas_mensais = serializers.SerializerMethodField()

    # Agora mes_final é persistido no Model e legível (não write_only)
    mes_final = serializers.DateField(required=False, allow_null=True)

    class Meta:
        model = Indicador
        fields = [
            'id', 'nome', 'setor', 'setor_nome',
            'tipo_meta', 'tipo_valor',
            'status', 'valor_meta',
            'criado_em', 'periodicidade',
            'mes_inicial', 'mes_final',
            'visibilidade',
            'extracao_indicador',
            'metas_mensais', 'ativo',
        ]
        read_only_fields = ('id', 'criado_em')
        extra_kwargs = {
            'extracao_indicador': {'required': False, 'allow_null': True, 'allow_blank': True},
            'mes_inicial': {'required': False, 'allow_null': True},
            # 👇 não marcar write_only aqui
            'mes_final': {'required': False, 'allow_null': True},
            'periodicidade': {'required': False},
        }

    # ---------- Validations ----------
    def validate_mes_inicial(self, v):
        return parse_mes_inicial(v)

    def validate_mes_final(self, v):
        return parse_mes_inicial(v)

    def validate(self, attrs):
        """
        Garante que mes_final >= mes_inicial quando ambos existirem.
        """
        attrs = super().validate(attrs)
        mes_inicial = attrs.get('mes_inicial') or getattr(self.instance, 'mes_inicial', None)
        mes_final = attrs.get('mes_final', getattr(self.instance, 'mes_final', None))
        if mes_inicial and mes_final and _first_of_month(mes_final) < _first_of_month(mes_inicial):
            raise serializers.ValidationError({"mes_final": "mes_final não pode ser anterior a mes_inicial."})
        return attrs

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
        if v < 1 or v > 12:
            raise serializers.ValidationError("periodicidade deve estar entre 1 e 12.")
        return v

    # ---------- Computed fields ----------
    def get_status(self, obj):
        hoje = _first_of_month(date.today())
        # se o mês corrente não pertence ao calendário do indicador, não cobre status
        if hoje not in meses_permitidos(obj, ate=hoje):
            return "Fora do período"

        preenchido = obj.preenchimentos.filter(
            mes=hoje.month, ano=hoje.year, valor_realizado__isnull=False
        ).exists()
        return "Concluído" if preenchido else "Pendente"

    def get_metas_mensais(self, obj):
        # Somente leitura: NÃO cria nada aqui
        metas_qs = MetaMensal.objects.filter(indicador=obj).order_by("mes")
        return [
            {"id": m.id, "mes": m.mes.strftime("%Y-%m-%d"), "valor_meta": float(m.valor_meta)}
            for m in metas_qs
        ]

    # ---------- Helpers internos ----------
    def _ensure_metas_ate(self, indicador: Indicador, target_end: date, hard_cap: bool):
        """
        Reconciliador:
        1) Calcula meses PERMITIDOS pela periodicidade/âncora até target_end (respeita mes_final).
        2) Cria metas FALTANTES para esses meses.
        3) Remove metas DESALINHADAS dentro do range.
        4) Se hard_cap=True, remove metas > target_end.
        """
        target_end = _first_of_month(target_end)

        # 1) meses permitidos pela regra centralizada
        permitidos = meses_permitidos(indicador, ate=target_end)

        existentes_qs = MetaMensal.objects.filter(indicador=indicador)
        existentes = set(existentes_qs.values_list('mes', flat=True))

        # 2) criar faltantes alinhadas
        to_create = [
            MetaMensal(indicador=indicador, mes=m, valor_meta=indicador.valor_meta)
            for m in permitidos if m not in existentes
        ]
        if to_create:
            MetaMensal.objects.bulk_create(to_create, ignore_conflicts=True)

        # 3) remover desalinhadas dentro do range
        if permitidos:
            base_range = min(permitidos)
            (existentes_qs
            .filter(mes__gte=base_range, mes__lte=target_end)
            .exclude(mes__in=permitidos)
            .delete())

        # 4) hard cap: corta qualquer coisa após target_end
        if hard_cap:
            MetaMensal.objects.filter(indicador=indicador, mes__gt=target_end).delete()

    # ---------- Create ----------
    @transaction.atomic
    def create(self, validated_data):
        instance = super().create(validated_data)  # full_clean depois via CleanModelSerializer

        if instance.mes_final:
            target_end = min(_first_of_month(instance.mes_final), _last_month_first_day())
            hard_cap = True
        else:
            target_end = _last_month_first_day()
            hard_cap = True  # força remoção de metas "no futuro", se existirem

        # Garante metas (até mês passado, removendo o futuro)
        self._ensure_metas_ate(instance, target_end, hard_cap)

        return instance

    # ---------- Update ----------
    @transaction.atomic
    def update(self, instance, validated_data):
        old_start = instance.mes_inicial
        instance = super().update(instance, validated_data)

        if instance.mes_final:
            target_end = min(_first_of_month(instance.mes_final), _last_month_first_day())
            hard_cap = True
        else:
            target_end = _last_month_first_day()
            hard_cap = True  # remove metas >= início do mês atual

        if instance.mes_inicial and (old_start is None or instance.mes_inicial > old_start):
            start = _first_of_month(instance.mes_inicial)
            MetaMensal.objects.filter(indicador=instance, mes__lt=start).delete()
            Preenchimento.objects.filter(indicador=instance).filter(
                Q(ano__lt=start.year) | (Q(ano=start.year) & Q(mes__lt=start.month))
            ).delete()

        # Garante metas mensais (até mês passado, removendo o futuro)
        self._ensure_metas_ate(instance, target_end, hard_cap)

        return instance


# =============================
# 🔹 METAS
# =============================
class MetaSerializer(CleanModelSerializer):
    class Meta:
        model = Meta
        fields = '__all__'


class MetaMensalSerializer(CleanModelSerializer):
    mes = serializers.DateField(format='%Y-%m-%d')

    class Meta:
        model = MetaMensal
        fields = ['id', 'indicador', 'mes', 'valor_meta']
