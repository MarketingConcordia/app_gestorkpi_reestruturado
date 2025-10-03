function carregarDadosUsuario() {
  const nomeUsuario = localStorage.getItem("nome_usuario") || "Usuário";
  const perfil = localStorage.getItem("perfil_usuario") || "master";

  document.getElementById("campo-nome-usuario").textContent = nomeUsuario;
  document.getElementById("campo-detalhe-perfil").textContent = `Perfil: ${perfil}`;
  document.getElementById("iniciais-usuario").textContent = nomeUsuario.charAt(0).toUpperCase();
}

function isTokenExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiry = payload.exp;
    const now = Math.floor(Date.now() / 1000);
    return now >= expiry;
  } catch (e) {
    console.error("Erro ao verificar token:", e);
    return true;
  }
}

async function renovarToken() {
  const refresh = localStorage.getItem("refresh");
  if (!refresh) throw new Error("Refresh token ausente.");

  const res = await fetch(`${window.API_BASE_URL}/api/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh })
  });

  if (!res.ok) throw new Error("Falha ao renovar o token.");

  const data = await res.json();
  localStorage.setItem("access", data.access);
  return data.access;
}

async function fetchComTokenRenovado(url, options = {}) {
  let token = localStorage.getItem("access");

  if (!token || isTokenExpired(token)) {
    try {
      token = await renovarToken();
    } catch (err) {
      alert("Sua sessão expirou. Faça login novamente.");
      localStorage.clear();
      window.location.href = "login.html";
      throw new Error("Sessão expirada");
    }
  }

  options.headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };

  return fetch(url, options);
}

function configurarFormularioTrocaSenhaMaster() {
  const form = document.querySelector("form");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const senhaAtual = document.getElementById("senhaAtual").value;
    const novaSenha = document.getElementById("novaSenha").value;
    const confirmar = document.getElementById("confirmarSenha").value;

    if (!senhaAtual || !novaSenha || !confirmar) {
      alert("Preencha todos os campos.");
      return;
    }

    if (novaSenha !== confirmar) {
      alert("A nova senha e a confirmação não coincidem.");
      return;
    }

    const usuarioId = localStorage.getItem("usuario_id");
    if (!usuarioId) {
      alert("Sessão inválida. Faça login novamente.");
      localStorage.clear();
      window.location.href = "login.html";
      return;
    }

    try {
      const response = await fetchComTokenRenovado(`${window.API_BASE_URL}/api/usuarios/${usuarioId}/trocar_senha/`, {
        method: "POST",
        body: JSON.stringify({
          senha_atual: senhaAtual,
          nova_senha: novaSenha
        })
      });

      if (!response.ok) {
        const erro = await response.json();
        throw new Error(erro.erro || "Erro ao trocar a senha.");
      }

      alert("Senha alterada com sucesso!");
      form.reset();
    } catch (err) {
      console.error("Erro:", err);
      alert(err.message);
    }
  });
}

// === [Toggle: permitir edição de meta pelo Gestor] ===========================
const FLAG_META_GESTOR_KEY = "permitirEditarMetaGestor";

/** Lê flag do backend; fallback para localStorage */
async function lerFlagPermitirMetaGestor() {
  try {
    const resp = await fetchComTokenRenovado(`${window.API_BASE_URL}/api/configuracoes/`, {
      method: "GET"
    });
    if (resp.ok) {
      const data = await resp.json();
      // aceita snake_case OU camelCase, caso o renderer mude
      const raw = (
        (data && (data.permitir_editar_meta_gestor ?? data.permitirEditarMetaGestor))
      );
      if (typeof raw !== "undefined") {
        const v = Boolean(raw);
        try { localStorage.setItem(FLAG_META_GESTOR_KEY, JSON.stringify(v)); } catch(_) {}
        return v;
      }
    }
  } catch (e) {
    console.warn("Falha ao ler /api/configuracoes:", e);
  }
  // fallback offline
  try {
    const local = localStorage.getItem(FLAG_META_GESTOR_KEY);
    return local ? JSON.parse(local) : false;
  } catch(_) {
    return false;
  }
}

/** Salva flag no backend; fallback para localStorage */
async function salvarFlagPermitirMetaGestor(valor) {
  const payload = { permitir_editar_meta_gestor: Boolean(valor) };

  // 1) Tenta UPSERT via POST no singleton (/configuracoes/)
  try {
    const resp = await fetchComTokenRenovado(`${window.API_BASE_URL}/api/configuracoes/`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (resp.ok) {
      try { localStorage.setItem(FLAG_META_GESTOR_KEY, JSON.stringify(payload.permitir_editar_meta_gestor)); } catch(_) {}
      return true;
    }
  } catch (e) {
    console.warn("POST /api/configuracoes/ falhou, tentando PATCH no detalhe…", e);
  }

  // 2) Fallback: busca o ID do singleton e faz PATCH no detalhe (/configuracoes/{id}/)
  try {
    const getResp = await fetchComTokenRenovado(`${window.API_BASE_URL}/api/configuracoes/`, { method: "GET" });
    if (getResp.ok) {
      const data = await getResp.json();
      const id = data?.id;
      if (id) {
        const patchResp = await fetchComTokenRenovado(`${window.API_BASE_URL}/api/configuracoes/${id}/`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        if (patchResp.ok) {
          try { localStorage.setItem(FLAG_META_GESTOR_KEY, JSON.stringify(payload.permitir_editar_meta_gestor)); } catch(_) {}
          return true;
        }
      }
    }
  } catch (e) {
    console.warn("PATCH /api/configuracoes/{id}/ falhou:", e);
  }

  // 3) Último recurso: persiste localmente para manter UI consistente até próxima sincronização
  try { localStorage.setItem(FLAG_META_GESTOR_KEY, JSON.stringify(payload.permitir_editar_meta_gestor)); } catch(_) {}
  return false;
}

/** Renderiza card e botão na página de Configurações */
async function renderToggleEditarMetaGestor() {
  const containerPai =
    document.querySelector("main") ||
    document.querySelector(".container") ||
    document.body;

  const wrapper = document.createElement("div");
  wrapper.className =
    "mt-6 bg-white dark:bg-gray-900 shadow rounded-xl p-5 border border-gray-100 dark:border-gray-800";
  wrapper.innerHTML = `
    <h2 class="text-lg font-semibold">Permissões dos Gestores</h2>

    <!-- Toggle logo abaixo do título -->
    <div class="mt-3">
      <label class="inline-flex items-center gap-3 cursor-pointer select-none">
        <span id="lbl-status-meta-gestor" class="text-sm text-gray-700 dark:text-gray-300">Carregando...</span>
        <input id="sw-meta-gestor" type="checkbox" class="sr-only"
               aria-label="Permitir edição de meta por gestores">
        <span id="sw-track" class="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-300 transition">
          <span id="sw-thumb" class="inline-block h-5 w-5 rounded-full bg-white shadow transform transition translate-x-0"></span>
        </span>
      </label>
    </div>

    <p class="mt-3 text-sm text-gray-600 dark:text-gray-300">
      Controla se gestores podem <strong>editar a meta do indicador</strong> pelo modal do dashboard deles.
    </p>
  `;
  containerPai.appendChild(wrapper);

  const lbl = wrapper.querySelector("#lbl-status-meta-gestor");
  const input = wrapper.querySelector("#sw-meta-gestor");
  const track = wrapper.querySelector("#sw-track");
  const thumb = wrapper.querySelector("#sw-thumb");

  let flag = await lerFlagPermitirMetaGestor();

  function aplicarEstilos(ativo) {
    // Track
    track.classList.toggle("bg-gray-300", !ativo);
    track.classList.toggle("bg-emerald-500", ativo);
    // Thumb
    thumb.classList.toggle("translate-x-0", !ativo);
    thumb.classList.toggle("translate-x-5", ativo);
    // Label
    lbl.textContent = ativo ? "ATIVADO" : "DESATIVADO";
    lbl.className = ativo
      ? "text-sm text-emerald-700 dark:text-emerald-400"
      : "text-sm text-gray-700 dark:text-gray-300";
  }

  function atualizarUI() {
    input.checked = flag;
    aplicarEstilos(flag);
  }

  atualizarUI();

  input.addEventListener("change", async () => {
    flag = input.checked;
    aplicarEstilos(flag);

    // desabilita enquanto salva para evitar alternâncias rápidas
    input.disabled = true;
    const ok = await salvarFlagPermitirMetaGestor(flag);
    input.disabled = false;

    if (!ok) {
      // se falhou, refaz leitura do backend/local p/ garantir consistência visual
      flag = await lerFlagPermitirMetaGestor();
      input.checked = flag;
      aplicarEstilos(flag);
      alert("Não foi possível salvar no servidor agora. O estado pode sincronizar depois.");
    }

    console.info(flag
      ? "Edição de meta por gestores ATIVADA."
      : "Edição de meta por gestores DESATIVADA.");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const perfil = localStorage.getItem("perfil_usuario");
  if (perfil !== "master") {
    alert("Acesso negado. Esta página é exclusiva para o perfil Master.");
    window.location.href = "login.html";
    return;
  }

  carregarDadosUsuario();
  configurarFormularioTrocaSenhaMaster();

  // **NOVO**: renderiza o card com o botão de ativar/desativar edição de meta para Gestores
  renderToggleEditarMetaGestor().catch(err => console.error(err));
});