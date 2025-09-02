from api.models import LogDeAcao


def registrar_log(usuario, acao: str):
    """
    Cria um log de ação associado ao usuário.
    Uso em qualquer ViewSet ou serviço.
    """
    LogDeAcao.objects.create(usuario=usuario, acao=acao)
