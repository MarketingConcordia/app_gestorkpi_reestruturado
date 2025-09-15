from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework import routers
from rest_framework_simplejwt.views import TokenRefreshView

# ---- Imports explícitos por módulo (mais robusto) ----
from api.views.setores import SetorViewSet
from api.views.usuarios import UsuarioViewSet
from api.views.indicadores import IndicadorViewSet, MetaMensalViewSet, IndicadoresConsolidadosView, MetaCreateView
from api.views.preenchimentos import PreenchimentoViewSet, meus_preenchimentos, indicadores_pendentes
from api.views.configuracoes import ConfiguracaoArmazenamentoViewSet, ConfiguracaoViewSet
from api.views.logs import LogDeAcaoViewSet
from api.views.relatorios import RelatorioView, relatorio_pdf, relatorio_excel
from api.views.auth import MyTokenObtainPairView, me, meu_usuario, usuario_logado

# -----------------------------
# Router (ViewSets)
# -----------------------------
router = routers.DefaultRouter()
router.register(r'setores', SetorViewSet, basename='setor')
router.register(r'usuarios', UsuarioViewSet, basename='usuario')
router.register(r'indicadores', IndicadorViewSet, basename='indicador')
router.register(r'preenchimentos', PreenchimentoViewSet, basename='preenchimento')
router.register(r'configuracoes-arm', ConfiguracaoArmazenamentoViewSet, basename='configuracao-arm')
router.register(r'logs', LogDeAcaoViewSet, basename='log')
router.register(r'configuracoes', ConfiguracaoViewSet, basename='configuracao')
router.register(r'metas-mensais', MetaMensalViewSet, basename='meta-mensal')

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
    path('relatorios/pdf/', relatorio_pdf, name='relatorio-pdf'),       # <- usa a view correta
    path('relatorios/excel/', relatorio_excel, name='relatorio-excel'), # <- usa a view correta

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
