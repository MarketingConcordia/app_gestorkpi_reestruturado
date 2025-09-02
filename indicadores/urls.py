from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import TemplateView
from django.views.static import serve
from django.http import HttpResponse
import os

urlpatterns = [
    # Admin
    path('admin/', admin.site.urls),

    # 🔹 API (tokens e demais endpoints estão definidos em api/urls.py)
    path('api/', include('api.urls')),
    path('api/auth/', include('rest_framework.urls')),

    # 🔸 Páginas do front (usando FRONTEND_DIR configurado em TEMPLATES.DIRS)
    path('', TemplateView.as_view(template_name="index.html"), name='home'),
    path('login/', TemplateView.as_view(template_name="login.html"), name='login'),

    # ✅ Healthcheck
    path('healthz/', lambda request: HttpResponse('ok'), name='healthz'),
]

# === Mídia em DEV ===
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# === Navegar arquivos do front-app (útil em dev) ===
urlpatterns += [
    re_path(
        r'^front-app/(?P<path>.*)$',
        serve,
        {
            'document_root': os.path.join(settings.BASE_DIR, 'front-app'),
            'show_indexes': True,
        },
    ),
]
