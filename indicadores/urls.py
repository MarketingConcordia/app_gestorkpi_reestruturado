from django.contrib import admin
from django.urls import path, re_path, include
from django.views.generic import RedirectView
from django.conf import settings
from django.conf.urls.static import static  # opcional em DEV
from django.views.static import serve as static_serve

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
    path('api/auth/', include('rest_framework.urls')),
    path('', RedirectView.as_view(url='/front-app/index.html', permanent=False), name='home'),
    path('login/', RedirectView.as_view(url='/front-app/login.html', permanent=False), name='login'),
    path('healthz/', RedirectView.as_view(url='/front-app/healthz.html', permanent=False), name='healthz'),
]

# Servir os arquivos do front em /front-app/...
urlpatterns += [
    re_path(r'^front-app/(?P<path>.*)$', static_serve, {'document_root': settings.FRONTEND_DIR}),
]

# Servir uploads (provas) em /media/...
urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', static_serve, {'document_root': settings.MEDIA_ROOT}),
]

# (Opcional – útil em DEV) também expõe /media/ via helper do Django
# Não conflita com o re_path acima.
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
