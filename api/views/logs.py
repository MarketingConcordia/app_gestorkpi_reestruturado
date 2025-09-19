from django.utils.dateparse import parse_date
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from api.models import LogDeAcao
from api.serializers import LogDeAcaoSerializer


class LogDeAcaoViewSet(viewsets.ReadOnlyModelViewSet):
    """
    - Master → vê todos os logs
    - Gestor → vê apenas seus próprios logs
    """
    serializer_class = LogDeAcaoSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        is_gestor = getattr(user, 'perfil', None) == 'gestor'

        # Base queryset otimizado para ambos os perfis
        qs = LogDeAcao.objects.select_related("usuario").all()
        if is_gestor:
            qs = qs.filter(usuario=user)

        # filtros opcionais
        usuario_param = self.request.query_params.get('usuario')
        setor = self.request.query_params.get('setor')
        data_inicio = self.request.query_params.get('data_inicio')
        data_fim = self.request.query_params.get('data_fim')
        indicador_nome = self.request.query_params.get('indicador_nome')

        if usuario_param and usuario_param != "todos":
            # Gestor tentando acessar log de outro usuário → bloqueia
            if is_gestor and str(user.id) != str(usuario_param):
                return LogDeAcao.objects.none()
            try:
                qs = qs.filter(usuario_id=int(usuario_param))
            except (TypeError, ValueError):
                return LogDeAcao.objects.none()

        if setor and setor != "todos":
            try:
                qs = qs.filter(usuario__setores__id=int(setor)).distinct()
            except (TypeError, ValueError):
                return LogDeAcao.objects.none()

        if data_inicio:
            inicio = parse_date(data_inicio)
            if inicio:
                qs = qs.filter(data__date__gte=inicio)
        if data_fim:
            fim = parse_date(data_fim)
            if fim:
                qs = qs.filter(data__date__lte=fim)

        # 🔹 NOVO: filtro textual no campo 'acao' (onde o nome do indicador aparece nos logs)
        if indicador_nome:
            qs = qs.filter(acao__icontains=indicador_nome)

        return qs.order_by("-data")
