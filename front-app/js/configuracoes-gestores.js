function carregarDadosUsuario() {
  const nomeUsuario = localStorage.getItem("nome_usuario") || "Usuário";
  const perfil = localStorage.getItem("perfil_usuario") || "gestor";

  document.getElementById("campo-nome-usuario").textContent = nomeUsuario;
  document.getElementById("campo-detalhe-perfil").textContent = `Perfil: ${perfil}`;
  document.getElementById("iniciais-usuario").textContent = nomeUsuario.charAt(0).toUpperCase();
}

// 🔐 Verifica se token expirou
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

// 🔄 Renova o token de acesso
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

// 🧠 fetch automático com renovação de token
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

// ⚙️ Lida com o formulário de conta
function configurarFormularioConta() {
  const formConta = document.querySelectorAll("form")[0];

  formConta.addEventListener("submit", async (e) => {
    e.preventDefault();

    const senhaAtual = document.getElementById("senhaAtual").value;
    const novaSenha = document.getElementById("novaSenha").value;
    const confirmar = document.getElementById("confirmarSenha").value;

    if (!senhaAtual || !novaSenha) {
      alert("Preencha todos os campos obrigatórios.");
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
      formConta.reset();

    } catch (err) {
      console.error("Erro ao trocar senha:", err);
      alert(err.message);
    }
  });
}

// 🚀 Inicialização
document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem('access');
  if (!token || isTokenExpired(token)) {
    alert("Sua sessão expirou. Faça login novamente.");
    localStorage.clear();
    window.location.href = "login.html";
    return;
  }

  const perfil = localStorage.getItem("perfil_usuario");
  if (perfil !== "gestor") {
    alert("Acesso negado. Esta página é exclusiva para gestores.");
    window.location.href = "login.html";
    return;
  }

  carregarDadosUsuario();
  configurarFormularioConta();
});
