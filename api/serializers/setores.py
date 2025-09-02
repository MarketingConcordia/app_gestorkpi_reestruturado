from rest_framework import serializers
from api.models import Setor


class SetorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Setor
        fields = '__all__'


class SetorSimplesSerializer(serializers.ModelSerializer):
    class Meta:
        model = Setor
        fields = ['id', 'nome']
