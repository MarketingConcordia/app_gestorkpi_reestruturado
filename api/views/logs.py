from django.utils.dateparse import parse_date
from rest_framework import viewsets

from api.models import LogDeAcao
from api.serializers import LogDeAcaoSerializer
from rest_framework.permissions import IsAuthenticated



class LogDeAcaoViewSet(viewsets.ReadOnlyModelViewSet):
    """
    - Master → vê todos os logs
    - Gestor → vê apenas seus próprios logs
    """
    serializer_class = LogDeAcaoSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.perfil == 'gestor':
            qs = LogDeAcao.objects.filter(usuario=user)
        else:
            qs = LogDeAcao.objects.select_related("usuario").all()

        # filtros opcionais
        usuario = self.request.query_params.get('usuario')
        setor = self.request.query_params.get('setor')
        data_inicio = self.request.query_params.get('data_inicio')
        data_fim = self.request.query_params.get('data_fim')

        if usuario and usuario != "todos":
            if user.perfil == "gestor" and str(user.id) != str(usuario):
                # Gestor tentando acessar log de outro usuário → bloqueia
                return LogDeAcao.objects.none()
            qs = qs.filter(usuario__id=usuario)
        if setor and setor != "todos":
            qs = qs.filter(usuario__setores__id=setor).distinct()
        if data_inicio:
            inicio = parse_date(data_inicio)
            if inicio:
                qs = qs.filter(data__date__gte=inicio)
        if data_fim:
            fim = parse_date(data_fim)
            if fim:
                qs = qs.filter(data__date__lte=fim)

        return qs.order_by("-data")
