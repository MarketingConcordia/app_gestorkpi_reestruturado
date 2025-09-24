from django.db import migrations, models
from django.db.models import Q
from django.db.models.functions import Lower  # ← import correto

class Migration(migrations.Migration):

    dependencies = [
        ('api', '0007_alter_configuracao_options_and_more'),
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='setor',
            options={'ordering': ('nome',), 'verbose_name': 'Setor', 'verbose_name_plural': 'Setores'},
        ),
        migrations.AlterModelOptions(
            name='usuario',
            options={'ordering': ('email',), 'verbose_name': 'Usuário', 'verbose_name_plural': 'Usuários'},
        ),
        migrations.RemoveField(
            model_name='usuario',
            name='username',
        ),
        migrations.AddIndex(
            model_name='setor',
            index=models.Index(fields=['ativo'], name='idx_setor_ativo'),
        ),
        migrations.AddIndex(
            model_name='setor',
            index=models.Index(fields=['nome'], name='idx_setor_nome'),
        ),
        migrations.AddIndex(
            model_name='usuario',
            index=models.Index(fields=['perfil'], name='idx_usuario_perfil'),
        ),
        migrations.AddIndex(
            model_name='usuario',
            index=models.Index(fields=['is_active', 'perfil'], name='idx_usuario_ativo_perfil'),
        ),

        migrations.AddConstraint(
            model_name='setor',
            constraint=models.CheckConstraint(
                check=~Q(nome__regex=r'^\s*$'),   # nome não pode ser vazio/brancos
                name='ck_setor_nome_nao_vazio',
            ),
        ),

        migrations.AddConstraint(
            model_name='usuario',
            constraint=models.UniqueConstraint(
                Lower('email'),
                name='uq_usuario_email_lower',
            ),
        ),
    ]