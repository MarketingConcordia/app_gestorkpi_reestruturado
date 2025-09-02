from rest_framework import serializers
from api.models import Usuario, Setor
from .setores import SetorSimplesSerializer


class UsuarioSerializer(serializers.ModelSerializer):
    setores = SetorSimplesSerializer(many=True, read_only=True)
    setores_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Setor.objects.all(),
        required=False,
        write_only=True
    )

    class Meta:
        model = Usuario
        fields = [
            "id", "email", "first_name", "last_name",
            "perfil", "is_active",
            "setores", "setores_ids"
        ]
        extra_kwargs = {
            'password': {'write_only': True}
        }

    def validate(self, data):
        perfil = data.get('perfil', getattr(self.instance, 'perfil', None))
        setores = data.get('setores_ids', None)

        if perfil == 'gestor' and (not setores or len(setores) == 0) and not getattr(self.instance, 'id', None):
            raise serializers.ValidationError({
                'setores_ids': 'Este campo é obrigatório para gestores.'
            })
        return data

    def create(self, validated_data):
        setores_ids = validated_data.pop('setores_ids', [])
        email = validated_data.get('email')
        username = validated_data.get('username', email)
        password = validated_data.pop('password')

        validated_data['username'] = username
        user = Usuario(**validated_data)
        user.set_password(password)
        user.save()

        if setores_ids:
            user.setores.set(setores_ids)

        return user

    def update(self, instance, validated_data):
        setores = validated_data.pop('setores_ids', None)
        password = validated_data.pop('password', None)
        username = validated_data.get('username', instance.email)

        validated_data['username'] = username

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        if setores is not None:
            instance.setores.set(setores)

        instance.save()
        return instance
