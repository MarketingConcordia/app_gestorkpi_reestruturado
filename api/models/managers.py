from django.contrib.auth.base_user import BaseUserManager


class UsuarioManager(BaseUserManager):
    """
    Manager customizado para usar email como identificador principal
    em vez de username.
    """
    use_in_migrations = True

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("O email é obrigatório")

        # Normaliza e força lowercase total para evitar duplicidade invisível
        email = self.normalize_email(email).lower()

        # Ativo por padrão, a menos que explicitamente definido
        extra_fields.setdefault("is_active", True)

        user = self.model(email=email, **extra_fields)

        if password:
            user.set_password(password)
        else:
            # Explicita a intenção: usuário sem senha utilizável (ex.: convite, SSO)
            user.set_unusable_password()

        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        if not password:
            raise ValueError("Superuser precisa de uma senha definida.")

        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        # Mantém sua regra: perfil padrão para superuser é 'master'
        extra_fields.setdefault("perfil", "master")

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser precisa ter is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser precisa ter is_superuser=True.")

        return self.create_user(email, password, **extra_fields)
