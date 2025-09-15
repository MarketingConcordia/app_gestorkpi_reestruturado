from django.db import IntegrityError
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
            "id",
            "email", "first_name", "last_name",
            "perfil", "is_active",
            "setores", "setores_ids",
            "password",
        ]
        extra_kwargs = {
            "password": {"write_only": True, "required": True},
            "email": {"required": True},
        }

    # -------- validações de campo --------
    def validate_email(self, value):
        v = (value or "").strip().lower()
        if not v:
            raise serializers.ValidationError("E-mail é obrigatório.")
        qs = Usuario.objects.filter(email__iexact=v)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Já existe um usuário com este e-mail.")
        return v

    # -------- validação de payload --------
    def validate(self, data):
        perfil = data.get('perfil', getattr(self.instance, 'perfil', None))
        setores = data.get('setores_ids', None)

        # Gestor novo precisa ser ligado a pelo menos um setor
        if perfil == 'gestor' and (not setores or len(setores) == 0) and not getattr(self.instance, 'id', None):
            raise serializers.ValidationError({'setores_ids': 'Este campo é obrigatório para gestores.'})

        senha = data.get('password')
        if senha and len(str(senha)) < 6:
            raise serializers.ValidationError({'password': 'A senha deve ter pelo menos 6 caracteres.'})
        return data

    # -------- criação --------
    def create(self, validated_data):
        setores_ids = validated_data.pop('setores_ids', [])
        password = validated_data.pop('password', None)
        email = validated_data.get('email')

        if not email:
            raise serializers.ValidationError({'email': 'E-mail é obrigatório.'})
        if not password:
            raise serializers.ValidationError({'password': 'Senha é obrigatória.'})

        try:
            user = Usuario(**validated_data)
            user.set_password(password)
            user.save()
        except IntegrityError as e:
            el = str(e).lower()
            msg = "Não foi possível criar o usuário."
            if "unique" in el and "email" in el:
                msg = "Já existe um usuário com este e-mail."
            raise serializers.ValidationError({'detail': msg})

        if setores_ids:
            user.setores.set(setores_ids)

        return user

    # -------- atualização --------
    def update(self, instance, validated_data):
        setores = validated_data.pop('setores_ids', None)
        password = validated_data.pop('password', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        if setores is not None:
            instance.setores.set(setores)

        try:
            instance.save()
        except IntegrityError as e:
            el = str(e).lower()
            msg = "Não foi possível atualizar o usuário."
            if "unique" in el and "email" in el:
                msg = "Já existe um usuário com este e-mail."
            raise serializers.ValidationError({'detail': msg})

        return instance
