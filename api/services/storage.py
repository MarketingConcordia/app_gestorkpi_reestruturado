import os
import json
import mimetypes
from uuid import uuid4
from django.conf import settings
from django.core.files.storage import default_storage


def _safe_unique_name(original_name: str) -> str:
    """
    Gera um nome seguro e único preservando a extensão.
    Evita path traversal e colisões.
    """
    base = os.path.basename(original_name or "").strip()
    _, ext = os.path.splitext(base)
    ext = (ext or "").lower()
    uid = uuid4().hex
    return f"{uid}{ext}"


def _guess_content_type(filename: str) -> str:
    ctype, _ = mimetypes.guess_type(filename)
    return ctype or "application/octet-stream"


def _reset_stream(fobj):
    try:
        fobj.seek(0)
    except Exception:
        # Alguns storages expõem .file; tenta reposicionar
        inner = getattr(fobj, "file", None)
        if inner and hasattr(inner, "seek"):
            inner.seek(0)


def upload_arquivo(file, nome_arquivo, config) -> str:
    """
    Upload dinâmico baseado na configuração de armazenamento (local, AWS, Azure ou GCP).
    Retorna URL pública do arquivo.
    """
    # 🔒 Extensões permitidas — unificada com a view
    extensoes_permitidas = {'.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.webp'}
    _, ext = os.path.splitext((nome_arquivo or "").lower())
    if ext not in extensoes_permitidas:
        raise ValueError("Extensão de arquivo não permitida.")

    # Pastas organizadas por tipo
    pasta = "provas"

    # Gera nome único e seguro
    unique_name = _safe_unique_name(nome_arquivo)
    key_path = f"{pasta}/{unique_name}"

    # Content-Type
    content_type = _guess_content_type(nome_arquivo)

    # Reposiciona o stream antes de cada upload
    _reset_stream(file)

    # =======================
    # 🔹 AWS S3
    # =======================
    if config.tipo == 'aws':
        try:
            import boto3  # lazy import
        except Exception as e:
            raise RuntimeError("Dependência boto3 ausente. Instale com: pip install boto3") from e

        s3 = boto3.client(
            's3',
            aws_access_key_id=config.aws_access_key,
            aws_secret_access_key=config.aws_secret_key,
            region_name=config.aws_region
        )

        extra = {
            'ACL': 'public-read',
            'ContentType': content_type,
            # 'CacheControl': 'public, max-age=31536000',  # opcional
            # 'ContentDisposition': f'inline; filename="{os.path.basename(nome_arquivo)}"',
        }

        _reset_stream(file)
        s3.upload_fileobj(file, config.aws_bucket_name, key_path, ExtraArgs=extra)

        # URL virtual-hosted style (funciona na maioria das regiões):
        return f"https://{config.aws_bucket_name}.s3.{config.aws_region}.amazonaws.com/{key_path}"

    # =======================
    # 🔹 Azure Blob Storage
    # =======================
    elif config.tipo == 'azure':
        try:
            from azure.storage.blob import BlobServiceClient, ContentSettings  # lazy import
        except Exception as e:
            raise RuntimeError("Dependência azure-storage-blob ausente. pip install azure-storage-blob") from e

        blob_service_client = BlobServiceClient.from_connection_string(
            config.azure_connection_string
        )
        blob_client = blob_service_client.get_blob_client(
            container=config.azure_container,
            blob=key_path
        )

        _reset_stream(file)
        blob_client.upload_blob(
            data=file,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type)
        )

        return f"https://{blob_service_client.account_name}.blob.core.windows.net/{config.azure_container}/{key_path}"

    # =======================
    # 🔹 Google Cloud Storage
    # =======================
    elif config.tipo == 'gcp':
        try:
            from google.cloud import storage  # lazy import
        except Exception as e:
            raise RuntimeError("Dependência google-cloud-storage ausente. pip install google-cloud-storage") from e

        creds = json.loads(config.gcp_credentials_json or "{}")
        client = storage.Client.from_service_account_info(creds) if creds else storage.Client()
        bucket = client.bucket(config.gcp_bucket_name)
        blob = bucket.blob(key_path)

        _reset_stream(file)
        # Nota: upload_from_file exige um file-like; funciona com InMemoryUploadedFile/TemporaryUploadedFile.
        blob.upload_from_file(file, content_type=content_type)
        # Torna público (se o bucket permitir políticas públicas)
        try:
            blob.make_public()
        except Exception:
            # Caso a política de IAM do bucket bloqueie, ao menos retorna a URL assinável
            return blob.public_url  # pode ser None dependendo das políticas
        return blob.public_url

    # =======================
    # 🔹 Local (servidor local)
    # =======================
    else:
        caminho = os.path.join(pasta, unique_name)
        file_path = default_storage.save(caminho, file)
        # MEDIA_URL pode ser relativo; o front costuma montar absoluto com request.build_absolute_uri
        base = settings.MEDIA_URL.rstrip('/')
        return f"{base}/{file_path}"
