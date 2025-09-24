from django.db import migrations

SQL_FWD = """
ALTER TABLE public.api_usuario ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE public.api_usuario ALTER COLUMN last_name  DROP NOT NULL;
ALTER TABLE public.api_usuario DROP CONSTRAINT IF EXISTS api_usuario_username_key;
DROP INDEX IF EXISTS public.api_usuario_username_48ebbbd7_like;
ALTER TABLE public.api_usuario DROP COLUMN IF EXISTS username;
"""

SQL_REV = """
-- rollback best-effort (não recomendo usar em prod depois que usuários forem criados)
ALTER TABLE public.api_usuario ADD COLUMN IF NOT EXISTS username varchar(150);
ALTER TABLE public.api_usuario ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE public.api_usuario ALTER COLUMN last_name  SET NOT NULL;
"""

class Migration(migrations.Migration):
    dependencies = [
        ('api', '0011_preenchimento_confirmado_and_more'),
    ]

    operations = [
        migrations.RunSQL(SQL_FWD, reverse_sql=SQL_REV),
    ]
