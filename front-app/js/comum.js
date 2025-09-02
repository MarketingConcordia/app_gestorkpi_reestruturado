function isTokenExpired(token) {
  if (!token) return true;

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiry = payload.exp;
    const now = Math.floor(Date.now() / 1000); // tempo atual em segundos
    return now >= expiry;
  } catch (e) {
    console.error("Erro ao verificar token:", e);
    return true;
  }
}

function verificarSessao() {
  const token = localStorage.getItem('access');
  if (!token || isTokenExpired(token)) {
    alert("Sua sessão expirou. Faça login novamente.");
    localStorage.clear();
    window.location.href = "login.html";
  }
}

// Execute imediatamente ao carregar
verificarSessao();


document.addEventListener("DOMContentLoaded", () => {
    carregarUsuarioLogado();
    configurarToggleSidebar();
    configurarDropdownPerfil()
});

// 🔹 Carrega dados do usuário logado e exibe no topo
function carregarUsuarioLogado() {
    const token = localStorage.getItem("access");
    if (!token) return;
    fetch(`${window.API_BASE_URL}/api/meu-usuario/`, {
        headers: { Authorization: `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(user => {
        const nome = user.first_name || user.username || user.email;
        const perfil = user.perfil;
        const setores = user.setores || [];

        // Nome do usuário
        document.querySelectorAll("#campo-nome-usuario").forEach(el => {
            el.textContent = nome;
        });

        // Detalhe do perfil (Master ou Setores)
        const detalhe = perfil === "master"
            ? "Perfil Master"
            : `Setor: ${setores.map(s => s.nome).join(", ")}`;

        document.querySelectorAll("#campo-detalhe-perfil").forEach(el => {
            el.textContent = detalhe;
        });

        // Iniciais do usuário (ex: FS)
        const iniciais = nome.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
        const avatar = document.getElementById("iniciais-usuario");
        if (avatar) avatar.textContent = iniciais;
    })
    .catch(err => {
        console.error("Erro ao carregar dados do usuário:", err);
    });
}

// 🔹 Lógica do botão de expandir/recolher sidebar
function configurarToggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    const sidebarItems = document.querySelectorAll(".sidebar-item");
    const mainContent = document.getElementById("main-content");

    if (sidebar) {
        // 1. Configurar o estado inicial da sidebar para estar recolhida por padrão
        // Usaremos a classe 'sidebar-collapsed' ou 'sidebar-hover-collapsed' para o estado inicial
        // Assumindo que 'sidebar-collapsed' já encolhe a sidebar e esconde o texto dos itens.
        sidebar.classList.add("sidebar-collapsed"); // Adiciona a classe para iniciar recolhida

        // 2. Ajustar a margem do conteúdo principal para a sidebar recolhida (se 'ml-64' for para expandida)
        if (mainContent) {
            mainContent.classList.remove("ml-64"); // Remove a margem da sidebar expandida
            mainContent.classList.add("ml-20"); // Adiciona a margem para a sidebar recolhida (ajuste o valor conforme seu CSS)
        }

        // 3. Esconder o texto dos itens da sidebar no estado recolhido
        sidebarItems.forEach(item => {
            item.style.display = "none";
        });


        // 4. Adicionar evento mouseenter na sidebar
        sidebar.addEventListener("mouseenter", () => {
            // Remove a classe de recolhido para expandir
            sidebar.classList.remove("sidebar-collapsed");

            if (mainContent) {
                // Ajusta a margem do conteúdo principal para a sidebar expandida
                mainContent.classList.remove("ml-20"); // Margem da sidebar recolhida
                mainContent.classList.add("ml-64");   // Margem da sidebar expandida
            }

            // Mostra o texto dos itens
            sidebarItems.forEach(item => {
                item.style.display = "inline";
            });
        });

        // 5. Adicionar evento mouseleave na sidebar
        sidebar.addEventListener("mouseleave", () => {
            // Adiciona a classe de recolhido
            sidebar.classList.add("sidebar-collapsed");

            if (mainContent) {
                // Ajusta a margem do conteúdo principal para a sidebar recolhida
                mainContent.classList.remove("ml-64"); // Margem da sidebar expandida
                mainContent.classList.add("ml-20");   // Margem da sidebar recolhida
            }

            // Esconde o texto dos itens
            sidebarItems.forEach(item => {
                item.style.display = "none";
            });
        });

        // O toggleSidebar (botão de clique) não é mais necessário para este comportamento de hover,
        // então você pode remover o event listener de click, se houver, no toggleSidebar.
    }
}

// 🔹 Logout global
function logout() {
    localStorage.removeItem("access");
    localStorage.removeItem("refresh");
    window.location.href = "login.html";
}

// 👤 Dropdown do perfil
function configurarDropdownPerfil() {
  const profileButton = document.getElementById("profileButton");
  const profileMenu = document.getElementById("profileMenu");

  profileButton.addEventListener("click", () => {
    profileMenu.classList.toggle("hidden");
  });

  document.addEventListener("click", (e) => {
    if (!profileButton.contains(e.target) && !profileMenu.contains(e.target)) {
      profileMenu.classList.add("hidden");
    }
  });
}