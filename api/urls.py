from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework import routers
from rest_framework_simplejwt.views import TokenRefreshView

from api.views import (
    # ViewSets
    SetorViewSet,
    UsuarioViewSet,
    IndicadorViewSet,
    PreenchimentoViewSet,
    ConfiguracaoArmazenamentoViewSet,
    LogDeAcaoViewSet,
    ConfiguracaoViewSet,
    MetaMensalViewSet,

    # Views customizadas / auxiliares
    me,
    meu_usuario,
    meus_preenchimentos,
    indicadores_pendentes,
    gerar_relatorio_pdf,
    gerar_relatorio_excel,
    usuario_logado,
    RelatorioView,
    MetaCreateView,
    MyTokenObtainPairView,
    IndicadoresConsolidadosView,
)

# -----------------------------
# Router (ViewSets)
# -----------------------------
router = routers.DefaultRouter()
router.register(r'setores', SetorViewSet)
router.register(r'usuarios', UsuarioViewSet)
router.register(r'indicadores', IndicadorViewSet, basename='indicadores')
router.register(r'preenchimentos', PreenchimentoViewSet, basename='preenchimentos')
router.register(r'configuracoes-arm', ConfiguracaoArmazenamentoViewSet)
router.register(r'logs', LogDeAcaoViewSet, basename='logs')
router.register(r'configuracoes', ConfiguracaoViewSet)
router.register(r'metas-mensais', MetaMensalViewSet)

# -----------------------------
# URL Patterns
# -----------------------------
urlpatterns = [
    # Auth (JWT)
    path('token/', MyTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # Usuário atual
    path('me/', me, name="me"),
    path('meu-usuario/', meu_usuario, name="meu-usuario"),
    path('usuario-logado/', usuario_logado, name='usuario-logado'),

    # Relatórios
    path('relatorios/', RelatorioView.as_view(), name='relatorios'),
    path('relatorios/pdf/', gerar_relatorio_pdf, name='relatorio-pdf'),
    path('relatorios/excel/', gerar_relatorio_excel, name='relatorio-excel'),

    # Criação de Meta (não conflita com metas-mensais do router)
    path('metas/', MetaCreateView.as_view(), name='criar-meta'),

    # Endpoints custom usados pelo frontend
    path('preenchimentos/meus/', meus_preenchimentos, name='meus-preenchimentos'),
    path('indicadores/pendentes/', indicadores_pendentes, name='indicadores-pendentes'),
    path('indicadores/dados-consolidados/', IndicadoresConsolidadosView.as_view(), name='indicadores-consolidados'),

    # Por último: rotas dos ViewSets
    path('', include(router.urls)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
