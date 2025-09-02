document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("form-gestor");

  const perfil = localStorage.getItem("perfil_usuario");
  if (perfil !== "master") {
    alert("Acesso negado. Esta página é exclusiva para perfil master.");
    window.location.href = "indexgestores.html"; // redireciona o gestor
  }

  listarGestores();
  preencherDropdownSetores();

  // 🧠 Controle do campo setor conforme perfil selecionado
  const perfilSelect = document.getElementById("perfil");
  const dropdownContainer = document.getElementById("dropdown-setores-cadastro");

  perfilSelect.addEventListener("change", function () {
    if (this.value === "master") {
      dropdownContainer.classList.add('hidden');
    } else {
      dropdownContainer.classList.remove('hidden');
    }
  });


  form.addEventListener("submit", function (e) {
    e.preventDefault();

    const nome = document.getElementById("nomeGestor").value;
    const email = document.getElementById("emailGestor").value;
    const senha = document.getElementById("senhaGestor").value;
    const confirmarSenha = document.getElementById("confirmarSenhaGestor").value;

    if (senha !== confirmarSenha) {
      alert("As senhas não coincidem.");
      return;
    }

    const perfilSelecionado = document.getElementById("perfil").value;
    // Pega todos os IDs dos setores selecionados através dos checkboxes
    const setoresSelecionados = Array.from(document.querySelectorAll('#dropdown-setores-cadastro input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));

    if (perfilSelecionado === "gestor" && setoresSelecionados.length === 0) {
      alert("Selecione pelo menos um setor para o gestor.");
      return;
    }

    const token = localStorage.getItem("access");
    if (!token) {
      alert("Sessão expirada. Faça login novamente.");
      window.location.href = "login.html";
      return;
    }

    const payload = {
      first_name: nome,
      email: email,
      username: email,
      password: senha,
      perfil: perfilSelecionado
    };

    if (perfilSelecionado === "gestor") {
      payload.setores_ids = setoresSelecionados;
    }

    fetch(`${window.API_BASE_URL}/api/usuarios/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })
      .then(res => {
        if (res.ok) return res.json();
        return res.json().then(err => { throw new Error(JSON.stringify(err)); });
      })
      .then(data => {
        alert("Gestor cadastrado com sucesso!");
        form.reset();
        listarGestores();
        // Recria os checkboxes para limpar o estado
        preencherDropdownSetores();
      })
      .catch(error => {
        console.error("Erro completo da API:", error.message);
        try {
          const msg = JSON.parse(error.message);
          if (msg.email) {
            alert("Erro: " + msg.email[0]);
          } else if (msg.detail) {
            alert("Erro: " + msg.detail);
          } else {
            alert("Erro desconhecido: " + JSON.stringify(msg));
          }
        } catch (e) {
          alert("Erro inesperado. Veja o console para mais detalhes.");
        }
      });
  });
});

function listarGestores() {
  const token = localStorage.getItem("access");
  const tabela = document.getElementById("tabela-usuarios");
  if (!tabela) return;

  fetch(`${window.API_BASE_URL}/api/usuarios/`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(res => res.json())
    .then(data => {
      const usuarios = data.results || data;
      tabela.innerHTML = "";

      if (usuarios.length === 0) {
        tabela.innerHTML = `
          <tr>
            <td colspan="6" class="text-center py-4 text-gray-500">Nenhum usuário encontrado.</td>
          </tr>`;
        return;
      }

      usuarios.forEach(usuario => {
        const tr = document.createElement("tr");

        const setores = (usuario.setores || [])
          .map(s => s.nome)
          .join(", ") || "-";

        const statusLabel = usuario.is_active
          ? `<span class="text-green-600 font-medium">Ativo</span>`
          : `<span class="text-red-600 font-medium">Inativo</span>`;

        const usuarioLogadoId = parseInt(localStorage.getItem("usuario_id"));
        const perfilLogado = localStorage.getItem("perfil_usuario");

        let btnStatus = "";
        // Só mostra o botão se NÃO for o próprio Master logado
        if (!(perfilLogado === "master" && usuario.id === usuarioLogadoId)) {
          btnStatus = usuario.is_active
            ? `<button onclick="alterarStatusUsuario(${usuario.id}, false)" class="text-red-600 hover:underline">Inativar</button>`
            : `<button onclick="alterarStatusUsuario(${usuario.id}, true)" class="text-green-600 hover:underline">Ativar</button>`;
        }

        tr.innerHTML = `
          <td class="px-4 py-2">${usuario.first_name}</td>
          <td class="px-4 py-2">${usuario.email}</td>
          <td class="px-4 py-2">${usuario.perfil === "master" ? "Master" : "Gestor"}</td>
          <td class="px-4 py-2">${setores}</td>
          <td class="px-4 py-2 text-center">${statusLabel}</td>
          <td class="px-4 py-2 text-center space-x-2">
            <button onclick="editarGestor(${usuario.id})" class="text-blue-600 hover:underline">Editar</button>
            ${btnStatus}
          </td>
        `;

        tabela.appendChild(tr);
      });
    })
    .catch(error => {
      console.error("Erro ao listar gestores:", error);
      tabela.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-4 text-red-500">Erro ao carregar usuários.</td>
        </tr>`;
    });
}

function alterarStatusUsuario(id, novoStatus) {
  const token = localStorage.getItem("access");
  const usuarioLogadoId = parseInt(localStorage.getItem("usuario_id")); // ID salvo no login
  const perfilLogado = localStorage.getItem("perfil_usuario");

  // 🔒 Impede que o próprio Master se inative
  if (perfilLogado === "master" && id === usuarioLogadoId && novoStatus === false) {
    alert("Você não pode inativar a sua própria conta.");
    return;
  }

  fetch(`${window.API_BASE_URL}/api/usuarios/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ is_active: novoStatus })
  })
    .then(res => {
      if (!res.ok) throw new Error("Falha ao alterar status");
      listarGestores();
    })
    .catch(err => {
      console.error("Erro:", err);
      alert("Erro ao alterar status do usuário.");
    });
}


function excluirGestor(id) {
  const confirmar = confirm("Tem certeza que deseja excluir este gestor?");
  if (!confirmar) return;

  const token = localStorage.getItem("access");

  fetch(`${window.API_BASE_URL}/api/usuarios/${id}/`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
    .then(res => {
      if (res.ok) {
        alert("Gestor excluído com sucesso.");
        listarGestores();
      } else {
        throw new Error("Falha ao excluir gestor.");
      }
    })
    .catch(error => {
      console.error("Erro ao excluir gestor:", error);
      alert("Erro ao excluir o gestor.");
    });
}

function editarGestor(id) {
  const token = localStorage.getItem("access");
  const dropdownContainer = document.getElementById("dropdown-setores-edicao");
  const setorWrapper = document.getElementById("edit-setor-wrapper");

  fetch(`${window.API_BASE_URL}/api/usuarios/${id}/`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(res => res.json())
    .then(gestor => {
      document.getElementById("edit-id").value = gestor.id;
      document.getElementById("edit-nome").value = gestor.first_name;
      document.getElementById("edit-email").value = gestor.email;
      document.getElementById("edit-perfil").value = gestor.perfil;
      document.getElementById("edit-senha").value = "";

      // Mostra/esconde o dropdown de setores
      if (gestor.perfil === "gestor") {
        setorWrapper.classList.remove("hidden");

        // Desmarca todos os checkboxes antes de marcar os corretos
        dropdownContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => checkbox.checked = false);

        // Marca como selecionado todos os setores do gestor
        if (gestor.setores && gestor.setores.length > 0) {
          const setorIds = gestor.setores.map(s => s.id);
          setorIds.forEach(setorId => {
            const checkbox = document.querySelector(`#dropdown-setores-edicao input[type="checkbox"][value="${setorId}"]`);
            if (checkbox) {
              checkbox.checked = true;
            }
          });
        }
      } else {
        setorWrapper.classList.add("hidden");
        dropdownContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => checkbox.checked = false);
      }
      
      // Atualiza o texto do botão do dropdown para o modal de edição
      updateDropdownText(dropdownContainer.querySelector('.dropdown-button'));

      document.getElementById("modal-editar-gestor").classList.remove("hidden");
    });
}

function fecharModalEditar() {
  document.getElementById("modal-editar-gestor").classList.add("hidden");
}

document.getElementById("form-editar-gestor").addEventListener("submit", function (e) {
  e.preventDefault();

  const id = document.getElementById("edit-id").value;
  const nome = document.getElementById("edit-nome").value;
  const email = document.getElementById("edit-email").value;
  const perfil = document.getElementById("edit-perfil").value;
  const senha = document.getElementById("edit-senha").value;

  // Pega todos os IDs dos setores selecionados através dos checkboxes
  const setoresSelecionados = Array.from(document.querySelectorAll('#dropdown-setores-edicao input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));

  const payload = {
    first_name: nome,
    email: email,
    username: email,
    perfil: perfil
  };

  if (senha.trim()) {
    payload.password = senha.trim();
  }

  if (perfil === "gestor") {
    payload.setores_ids = setoresSelecionados;
  } else {
    // Se o perfil for 'master', garante que a lista de setores seja vazia
    payload.setores_ids = [];
  }

  const token = localStorage.getItem("access");

  fetch(`${window.API_BASE_URL}/api/usuarios/${id}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  })
    .then(res => {
      if (res.ok) {
        alert("Gestor atualizado com sucesso!");
        fecharModalEditar();
        listarGestores();
      } else {
        return res.json().then(err => {
          console.error("Erro detalhado:", err);
          alert("Erro ao atualizar gestor.");
        });
      }
    });
});

function preencherDropdownSetores() {
  const token = localStorage.getItem("access");

  const containerCadastro = document.getElementById("dropdown-setores-cadastro");
  const containerEdicao = document.getElementById("dropdown-setores-edicao");

  if (!containerCadastro || !containerEdicao) {
    console.error("Containers de setores não encontrados.");
    return;
  }

  fetch(`${window.API_BASE_URL}/api/setores/`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
    .then(res => {
      if (!res.ok) throw new Error("Erro ao carregar setores.");
      return res.json();
    })
    .then(data => {
      const setores = data.results;

      // Cria o dropdown para o formulário de cadastro
      criarDropdown(containerCadastro, setores);

      // Cria o dropdown para o modal de edição
      criarDropdown(containerEdicao, setores, true);

      // Oculta a lista de setores inicialmente
      containerCadastro.querySelector('.dropdown-content').classList.add('hidden');
      containerEdicao.querySelector('.dropdown-content').classList.add('hidden');
    })
    .catch(err => {
      console.error("Erro ao preencher setores:", err);
    });
}

function criarDropdown(container, setores, isEdit = false) {
  const dropdownButtonId = isEdit ? 'edit-setor-dropdown-button' : 'setor-dropdown-button';
  const dropdownContentId = isEdit ? 'edit-setor-dropdown-content' : 'setor-dropdown-content';
  const checkboxPrefix = isEdit ? 'edit-setor-' : 'setor-';

  // Limpa o container antes de preencher
  container.innerHTML = `
    <button type="button" id="${dropdownButtonId}" class="dropdown-button w-full flex items-center justify-between px-3 py-2 border rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
      <span>Selecione os setores...</span>
      <svg class="w-4 h-4 ml-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
      </svg>
    </button>
    <div id="${dropdownContentId}" class="dropdown-content absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto hidden">
      </div>
  `;

  const dropdownButton = document.getElementById(dropdownButtonId);
  const dropdownContent = document.getElementById(dropdownContentId);

  setores.forEach(setor => {
    const checkboxDiv = document.createElement("div");
    checkboxDiv.className = 'flex items-center px-4 py-2 hover:bg-gray-100 cursor-pointer';
    checkboxDiv.innerHTML = `
      <input type="checkbox" id="${checkboxPrefix}${setor.id}" name="${checkboxPrefix}checkbox" value="${setor.id}" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded">
      <label for="${checkboxPrefix}${setor.id}" class="ml-2 block text-sm text-gray-900 w-full cursor-pointer">${setor.nome}</label>
    `;
    dropdownContent.appendChild(checkboxDiv);
  });

  // Evento para abrir/fechar o dropdown
  dropdownButton.addEventListener('click', () => {
    dropdownContent.classList.toggle('hidden');
    // Rotação do ícone
    const icon = dropdownButton.querySelector('svg');
    icon.classList.toggle('rotate-180');
  });

  // Evento para atualizar o texto do botão quando os checkboxes são clicados
  dropdownContent.addEventListener('change', () => {
    updateDropdownText(dropdownButton);
  });
  
  // Evento para fechar o dropdown ao clicar fora
  document.addEventListener('click', (event) => {
    if (!container.contains(event.target)) {
      dropdownContent.classList.add('hidden');
      const icon = dropdownButton.querySelector('svg');
      icon.classList.remove('rotate-180');
    }
  });

  // Função para garantir que os labels também ativem o checkbox
  dropdownContent.querySelectorAll('label').forEach(label => {
    label.addEventListener('click', (event) => {
      event.preventDefault(); // Impede o comportamento padrão
      const checkbox = document.getElementById(label.getAttribute('for'));
      checkbox.checked = !checkbox.checked;
      updateDropdownText(dropdownButton);
    });
  });
}

function updateDropdownText(dropdownButton) {
  const container = dropdownButton.parentElement;
  const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
  const span = dropdownButton.querySelector('span');

  if (checkboxes.length === 0) {
    span.textContent = 'Selecione os setores...';
  } else if (checkboxes.length === 1) {
    span.textContent = `${container.querySelector(`#${checkboxes[0].id}`).nextElementSibling.textContent}`;
  } else {
    span.textContent = `${checkboxes.length} setores selecionados`;
  }
}

document.getElementById("edit-perfil").addEventListener("change", function () {
  const setorWrapper = document.getElementById("edit-setor-wrapper");
  const dropdownContainer = document.getElementById("dropdown-setores-edicao");
  const dropdownButton = dropdownContainer.querySelector('.dropdown-button');

  if (this.value === "master") {
    setorWrapper.classList.add("hidden");
    dropdownContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => checkbox.checked = false);
  } else {
    setorWrapper.classList.remove("hidden");
  }
  updateDropdownText(dropdownButton);
});

// Função para alternar a visibilidade da senha
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