document.addEventListener("DOMContentLoaded", function () {
  const form = document.querySelector("form");

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("senha").value;

    // 🔐 Solicitar token
    fetch(`${window.API_BASE_URL}/api/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    })
      .then(response => {
        if (!response.ok) throw new Error("Email ou senha incorretos");
        return response.json();
      })

      // 💾 Armazenar tokens e buscar usuário
      .then(data => {
        localStorage.setItem("access", data.access);
        localStorage.setItem("refresh", data.refresh);

        return fetch(`${window.API_BASE_URL}/api/me/`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${data.access}`
          }
        });
      })

      // 👤 Armazenar dados do usuário e redirecionar
      .then(res => {
        if (!res.ok) throw new Error("Erro ao buscar dados do usuário");
        return res.json();
      })

      .then(usuario => {
        const nome = usuario.first_name || usuario.username || usuario.email.split("@")[0];

        localStorage.setItem("nome_usuario", nome);
        localStorage.setItem("perfil_usuario", usuario.perfil);
        localStorage.setItem("usuario_id", usuario.id);  // ✅ ESSENCIAL
        localStorage.setItem("setores_usuario", JSON.stringify(usuario.setores || []));

        // 🔹 Se quiser manter um "setor padrão", ok:
        if (usuario.setores && usuario.setores.length > 0) {
          localStorage.setItem("setor_usuario", usuario.setores[0].nome);
          localStorage.setItem("setor_usuario_id", usuario.setores[0].id);
        }

        if (usuario.perfil === "master") {
          window.location.href = "index.html";
        } else if (usuario.perfil === "gestor") {
          window.location.href = "indexgestores.html";
        } else {
          alert("Perfil desconhecido.");
        }
      })

      // ⚠️ Tratar erros
      .catch(error => {
        console.error("Erro durante login:", error.message);
        alert(error.message);
      });
  });
});

function togglePasswordVisibility(fieldId) {
    const passwordField = document.getElementById(fieldId);
    const toggleIcon = document.getElementById(`toggle-${fieldId}`);

    if (passwordField.type === "password") {
        passwordField.type = "text";
        toggleIcon.classList.remove("fa-eye");
        toggleIcon.classList.add("fa-eye-slash");
    } else {
        passwordField.type = "password";
        toggleIcon.classList.remove("fa-eye-slash");
        toggleIcon.classList.add("fa-eye");
    }
}
