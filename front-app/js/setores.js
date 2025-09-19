document.addEventListener("DOMContentLoaded", () => {
  const perfil = localStorage.getItem("perfil_usuario");
  if (perfil !== "master") {
    alert("Acesso negado. Esta página é exclusiva para perfil master.");
    window.location.href = "indexgestores.html";
    return;
  }

  listarSetores();
  configurarFormularioSetor();

  // Drawer: abrir/fechar
  const btnAbrir = document.getElementById("btn-toggle-inativos-setores");
  const btnFechar = document.getElementById("btn-close-inativos-setores");
  const backdrop = document.getElementById("drawer-backdrop-setores");

  btnAbrir?.addEventListener("click", abrirDrawerSetoresInativos);
  btnFechar?.addEventListener("click", fecharDrawerSetoresInativos);
  backdrop?.addEventListener("click", fecharDrawerSetoresInativos);

  // Fecha com ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fecharDrawerSetoresInativos();
  });
});


// 🔹 FORMULÁRIO DE SETOR
function configurarFormularioSetor() {
  document.getElementById("form-setor").addEventListener("submit", function (e) {
    e.preventDefault();
    const nome = document.getElementById("nomeSetor").value.trim();
    const token = localStorage.getItem("access");

    if (!nome) {
      alert("Digite o nome do setor.");
      return;
    }

    fetch(`${window.API_BASE_URL}/api/setores/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ nome }),
    })
    .then(res => res.ok ? res.json() : res.json().then(err => { throw new Error(JSON.stringify(err)); }))
    .then(() => {
      document.getElementById("nomeSetor").value = "";
      listarSetores();
    })
    .catch(err => {
      console.error("Erro ao cadastrar setor:", err);
      alert("Erro ao cadastrar setor.");
    });
  });
}


// 🔹 LISTAR / EDITAR / EXCLUIR SETORES
function listarSetores() {
  const token = localStorage.getItem("access");

  fetch(`${window.API_BASE_URL}/api/setores/`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  .then(res => res.ok ? res.json() : Promise.reject("Erro ao buscar setores"))
  .then(dados => {
    const lista = document.getElementById("lista-setores");
    if (!lista) return;

    // Suporta API paginada (dados.results) e não paginada (array direto)
    const setores = Array.isArray(dados?.results) ? dados.results
                  : (Array.isArray(dados) ? dados : []);

    // ✅ Apenas ativos na lista principal
    const setoresAtivos = setores.filter(s => s.ativo);

    lista.innerHTML = "";

    if (setoresAtivos.length === 0) {
      lista.innerHTML = "<p class='text-gray-500'>Nenhum setor ativo.</p>";
      return;
    }

    setoresAtivos.forEach(setor => {
      const item = document.createElement("div");
      item.className = "flex justify-between items-center border rounded px-3 py-2 bg-gray-50";

      const statusLabel = `<span class="text-green-600 font-medium">Ativo</span>`;
      const botaoStatus = `<button onclick="alterarStatusSetor(${setor.id}, false)" class="text-red-600 hover:underline">Inativar</button>`;

      item.innerHTML = `
        <span>ID ${setor.id}: ${setor.nome} (${statusLabel})</span>
        <div class="space-x-2">
          <button onclick="editarSetor(${setor.id}, '${(setor.nome || "").replace(/'/g, "\\'")}')" class="text-blue-600 hover:underline">Editar</button>
          ${botaoStatus}
        </div>
      `;
      lista.prepend(item);
    });
  })
  .catch(err => console.error(err));
}

function alterarStatusSetor(id, novoStatus, onSuccess) {
  const token = localStorage.getItem("access");

  fetch(`${window.API_BASE_URL}/api/setores/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ ativo: novoStatus })
  })
  .then(res => {
    if (!res.ok) throw new Error("Erro ao alterar status do setor.");
    // Atualiza lista principal
    listarSetores();

    // Se o drawer estiver aberto, atualiza a lista de inativos
    const drawer = document.getElementById("drawer-inativos-setores");
    if (drawer && !drawer.classList.contains("hidden")) {
      listarSetoresInativos();
    }

    // Callback opcional (usado pelo drawer)
    if (typeof onSuccess === "function") onSuccess();
  })
  .catch(err => {
    console.error("Erro ao alterar status do setor:", err);
    alert("Erro ao alterar status.");
  });
}

function editarSetor(id, nomeAtual) {
  const novoNome = prompt("Editar nome do setor:", nomeAtual);
  if (!novoNome?.trim()) return;

  const token = localStorage.getItem("access");
  fetch(`${window.API_BASE_URL}/api/setores/${id}/`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ nome: novoNome.trim() })
  })
  .then(res => {
    if (!res.ok) throw new Error("Erro ao editar setor.");
    listarSetores();
  })
  .catch(err => {
    console.error("Erro ao editar setor:", err);
    alert("Erro ao editar setor.");
  });
}

// === Drawer: Setores Inativos ===
function abrirDrawerSetoresInativos() {
  const root = document.getElementById("drawer-inativos-setores");
  const panel = document.getElementById("drawer-panel-setores");
  if (!root || !panel) return;
  root.classList.remove("hidden");
  requestAnimationFrame(() => panel.classList.remove("translate-x-full"));
  listarSetoresInativos();
}

function fecharDrawerSetoresInativos() {
  const root = document.getElementById("drawer-inativos-setores");
  const panel = document.getElementById("drawer-panel-setores");
  if (!root || !panel) return;
  panel.classList.add("translate-x-full");
  setTimeout(() => root.classList.add("hidden"), 300);
}

function listarSetoresInativos() {
  const token = localStorage.getItem("access");
  const cont = document.getElementById("lista-setores-inativos");
  if (!cont) return;

  cont.innerHTML = `<p class="text-gray-400">Carregando...</p>`;

  fetch(`${window.API_BASE_URL}/api/setores/`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  .then(res => res.ok ? res.json() : Promise.reject("Erro ao buscar setores"))
  .then(dados => {
    const setores = Array.isArray(dados?.results) ? dados.results
                  : (Array.isArray(dados) ? dados : []);
    const inativos = setores.filter(s => !s.ativo);

    cont.innerHTML = "";

    if (inativos.length === 0) {
      cont.innerHTML = `<p class="text-gray-500">Nenhum setor inativo.</p>`;
      return;
    }

    inativos.forEach(s => {
      const div = document.createElement("div");
      div.className = "flex justify-between items-center border rounded px-3 py-2";
      div.innerHTML = `
        <span><strong>${s.nome}</strong> (ID ${s.id})</span>
        <button class="text-green-600 hover:underline" onclick="ativarSetorViaDrawer(${s.id})">Ativar</button>
      `;
      cont.appendChild(div);
    });
  })
  .catch(err => {
    console.error(err);
    cont.innerHTML = `<p class="text-red-500">Erro ao carregar inativos.</p>`;
  });
}

function ativarSetorViaDrawer(id) {
  alterarStatusSetor(id, true, listarSetoresInativos);
}