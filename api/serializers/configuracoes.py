from rest_framework import serializers
from django.core.exceptions import ValidationError as DjangoValidationError

from api.models import Configuracao, ConfiguracaoArmazenamento


# =============================
# 🔧 Base com full_clean
# =============================
class CleanModelSerializer(serializers.ModelSerializer):
    """
    Serializer base que garante full_clean() antes de salvar,
    convertendo ValidationError do Django em DRF ValidationError.
    """

    def perform_full_clean_and_save(self, instance):
        try:
            instance.full_clean()  # aciona validators + clean() do model
        except DjangoValidationError as e:
            # Converte erros de model para DRF-friendly
            raise serializers.ValidationError(e.message_dict or e.messages)
        instance.save()
        return instance

    def create(self, validated_data):
        instance = super().create(validated_data)
        return self.perform_full_clean_and_save(instance)

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        return self.perform_full_clean_and_save(instance)


# =============================
# 🔹 CONFIGURAÇÃO PREENCHIMENTO
# =============================
class ConfiguracaoSerializer(CleanModelSerializer):
    # torna explícito (não é obrigatório, mas ajuda na leitura)
    permitir_editar_meta_gestor = serializers.BooleanField(required=False)

    class Meta:
        model = Configuracao
        fields = '__all__'          # inclui permitir_editar_meta_gestor
        read_only_fields = ('id',)

    def validate_dia_limite_preenchimento(self, value):
        if not (1 <= value <= 31):
            raise serializers.ValidationError("O dia limite deve estar entre 1 e 31.")
        return value

    # 🔁 Mapeia camelCase -> snake_case ao receber do frontend
    def to_internal_value(self, data):
        if 'permitirEditarMetaGestor' in data and 'permitir_editar_meta_gestor' not in data:
            data = data.copy()
            data['permitir_editar_meta_gestor'] = data.pop('permitirEditarMetaGestor')
        return super().to_internal_value(data)

    # 🔁 Também devolve camelCase no GET (sem quebrar quem usa snake_case)
    def to_representation(self, instance):
        rep = super().to_representation(instance)
        rep['permitirEditarMetaGestor'] = rep.get('permitir_editar_meta_gestor')
        return rep


# =============================
# 🔹 ARMAZENAMENTO
# =============================
class ConfiguracaoArmazenamentoSerializer(CleanModelSerializer):
    class Meta:
        model = ConfiguracaoArmazenamento
        fields = '__all__'
        read_only_fields = ('id', 'criado_em')

    def validate_dia_limite_preenchimento(self, value):
        if not (1 <= value <= 31):
            raise serializers.ValidationError("O dia limite deve estar entre 1 e 31.")
        return value

    def validate(self, attrs):
        """
        Mensagens mais claras antes mesmo do clean() do model.
        O clean() do model continuará rodando em create/update, reforçando a regra.
        """
        tipo = attrs.get('tipo', getattr(self.instance, 'tipo', 'local'))

        if tipo == 'aws':
            req = ['aws_access_key', 'aws_secret_key', 'aws_bucket_name', 'aws_region']
            faltando = [f for f in req if not (attrs.get(f) or getattr(self.instance, f, None))]
            if faltando:
                raise serializers.ValidationError({
                    'aws': f"Campos obrigatórios para AWS ausentes: {', '.join(faltando)}"
                })

        elif tipo == 'azure':
            req = ['azure_connection_string', 'azure_container']
            faltando = [f for f in req if not (attrs.get(f) or getattr(self.instance, f, None))]
            if faltando:
                raise serializers.ValidationError({
                    'azure': "Campos obrigatórios para Azure: azure_connection_string e azure_container."
                })

        elif tipo == 'gcp':
            req = ['gcp_credentials_json', 'gcp_bucket_name']
            faltando = [f for f in req if not (attrs.get(f) or getattr(self.instance, f, None))]
            if faltando:
                raise serializers.ValidationError({
                    'gcp': "Campos obrigatórios para GCP: gcp_credentials_json e gcp_bucket_name."
                })

        return attrs
