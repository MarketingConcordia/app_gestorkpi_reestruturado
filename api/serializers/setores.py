from rest_framework import serializers
from api.models import Setor


class SetorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Setor
        fields = '__all__'
        read_only_fields = ('id',)


class SetorSimplesSerializer(serializers.ModelSerializer):
    class Meta:
        model = Setor
        fields = ['id', 'nome']
        read_only_fields = ('id',)
