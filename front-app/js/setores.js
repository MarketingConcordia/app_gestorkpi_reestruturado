document.addEventListener("DOMContentLoaded", () => {
  const perfil = localStorage.getItem("perfil_usuario");
  if (perfil !== "master") {
    alert("Acesso negado. Esta página é exclusiva para perfil master.");
    window.location.href = "indexgestores.html";
    return;
  }

  listarSetores();

  configurarFormularioSetor();
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
    const setores = dados.results;
    const lista = document.getElementById("lista-setores");
    if (!lista) return;

    lista.innerHTML = "";

    if (setores.length === 0) {
      lista.innerHTML = "<p class='text-gray-500'>Nenhum setor cadastrado.</p>";
      return;
    }

    setores.forEach(setor => {
      const item = document.createElement("div");
      item.className = "flex justify-between items-center border rounded px-3 py-2 bg-gray-50";
      const statusLabel = setor.ativo
        ? `<span class="text-green-600 font-medium">Ativo</span>`
        : `<span class="text-red-600 font-medium">Inativo</span>`;

      const botaoStatus = setor.ativo
        ? `<button onclick="alterarStatusSetor(${setor.id}, false)" class="text-red-600 hover:underline">Inativar</button>`
        : `<button onclick="alterarStatusSetor(${setor.id}, true)" class="text-green-600 hover:underline">Ativar</button>`;

      item.innerHTML = `
        <span>ID ${setor.id}: ${setor.nome} (${statusLabel})</span>
        <div class="space-x-2">
          <button onclick="editarSetor(${setor.id}, '${setor.nome}')" class="text-blue-600 hover:underline">Editar</button>
          ${botaoStatus}
        </div>
      `;
      lista.prepend(item);
    });
  })
  .catch(err => console.error(err));
}

function alterarStatusSetor(id, novoStatus) {
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
    listarSetores(); // Atualiza lista após alteração
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