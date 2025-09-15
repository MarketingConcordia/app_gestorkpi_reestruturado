// =============================
// 🔹 Estado Global
// =============================
let preenchimentosRealizados = new Set();
let indicadorSelecionado = null;

// IDs de setores do usuário logado (gestor)
let __setoresUsuarioIds = new Set();      // Number
let __setoresUsuarioIdsStr = new Set();   // String (espelha os mesmos IDs)

// =============================
// 🔹 Helpers
// =============================

// Extrai o ID do setor de um item do endpoint de pendentes, tolerando formatos diferentes
function extrairSetorIdDoItem(item) {
  // Tenta campos comuns e variações aninhadas que costumam aparecer
  const candidatos = [
    item?.setor,
    item?.setor?.id,
    item?.setor,                 // às vezes vem o id direto neste campo
    item?.indicador_setor,
    item?.indicador?.setor,
    item?.indicador?.setor?.id,
  ];

  for (const c of candidatos) {
    if (c !== undefined && c !== null && c !== "") return c;
  }
  return null;
}

// =============================
// 🔹 Carregar setores do usuário (IDs)
// =============================
async function carregarUsuarioSetores() {
  const token = localStorage.getItem('access');
  try {
    const res = await fetch(`${window.API_BASE_URL}/api/meu-usuario/`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Erro ao buscar /api/meu-usuario/");

    const user = await res.json();

    // Coleta IDs dos setores do usuário (inclui setor_principal como fallback)
    const idsDiretos = (Array.isArray(user?.setores) ? user.setores : [])
      .map(s => s?.id)
      .filter(id => id != null);

    const idPrincipal = user?.setor_principal?.id;

    const ids = [...new Set([
      ...idsDiretos,
      ...(idPrincipal != null ? [idPrincipal] : []),
    ])];

    __setoresUsuarioIds = new Set(ids.map(n => Number(n)));
    __setoresUsuarioIdsStr = new Set(ids.map(String));

    console.debug("[meu-usuario] setores IDs (Number):", Array.from(__setoresUsuarioIds));
    console.debug("[meu-usuario] setores IDs (String):", Array.from(__setoresUsuarioIdsStr));
  } catch (e) {
    console.error("Falha ao carregar setores do usuário:", e);
    __setoresUsuarioIds = new Set();
    __setoresUsuarioIdsStr = new Set();
  }
}

// =============================
// 🔹 Carregar preenchimentos já feitos
// =============================
async function carregarPreenchimentos() {
  const token = localStorage.getItem('access');

  try {
    const res = await fetch(`${window.API_BASE_URL}/api/preenchimentos/meus/`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error("Erro ao buscar preenchimentos");

    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Resposta inválida (esperado array)");

    data.forEach(item => {
      const indicadorId = typeof item.indicador === 'object' ? item.indicador.id : item.indicador;
      const chave = `${indicadorId}_${item.mes}_${item.ano}`;
      preenchimentosRealizados.add(chave);
    });

    console.log("✔️ Preenchimentos carregados:", preenchimentosRealizados);

  } catch (err) {
    console.error("Erro ao carregar preenchimentos:", err);
  }
}

// =============================
// 🔹 Carregar indicadores pendentes (apenas dos setores do gestor)
// =============================
async function carregarIndicadores() {
  const token = localStorage.getItem('access');

  try {
    const res = await fetch(`${window.API_BASE_URL}/api/indicadores/pendentes/`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error("Erro ao buscar indicadores pendentes");
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Resposta inválida (esperado array)");

    // Amostra de payload para debug
    console.debug("[pendentes] amostra bruta:", data.slice(0, 3));

    if (__setoresUsuarioIds.size === 0 && __setoresUsuarioIdsStr.size === 0) {
      console.warn("Usuário sem IDs de setor associados. Nada será exibido.");
      renderizarIndicadores([]);
      return;
    }

    // 🔒 Mantém somente itens cujo setor_id pertence aos setores do usuário (comparando número OU string)
    const pendentesDoMeuSetor = data.filter(item => {
      const sid = extrairSetorIdDoItem(item);
      return (
        sid != null &&
        ( __setoresUsuarioIds.has(Number(sid)) || __setoresUsuarioIdsStr.has(String(sid)) )
      );
    });

    // Se vier vazio, loga um diagnóstico
    if (pendentesDoMeuSetor.length === 0) {
      console.warn("[pendentes] vazio após filtro. Mapeando setor_id detectado nos primeiros itens:");
      data.slice(0, 10).forEach((it, idx) => {
        const sid = extrairSetorIdDoItem(it);
        console.warn(`  #${idx}`, {
          setor_detectado: sid,
          pertenceAoUsuario:
            sid != null &&
            ( __setoresUsuarioIds.has(Number(sid)) || __setoresUsuarioIdsStr.has(String(sid)) )
        });
      });
    }

    // 🔹 Agrupar por indicador
    const agrupados = {};
    pendentesDoMeuSetor.forEach(item => {
      const chave = `${item.id}`;
      if (!agrupados[chave]) {
        agrupados[chave] = {
          id: item.id,
          nome: item.nome,
          descricao: item.descricao,
          pendencias: []
        };
      }
      agrupados[chave].pendencias.push({
        mes: item.mes,
        ano: item.ano
      });
    });

    renderizarIndicadores(Object.values(agrupados));

  } catch (err) {
    console.error("Erro ao carregar indicadores:", err);
  }
}

// =============================
// 🔹 Renderizar cards agrupados
// =============================
function renderizarIndicadores(lista) {
  const container = document.getElementById('indicadores-container');
  container.innerHTML = '';

  if (!Array.isArray(lista) || lista.length === 0) {
    container.innerHTML = `
      <div class="p-4 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded">
        Nenhum indicador pendente para seus setores.
      </div>`;
    return;
  }

  lista.forEach(indicador => {
    const card = document.createElement('div');
    card.className = "bg-white shadow-md border-l-4 border-blue-600 p-4 rounded-lg flex flex-col gap-4 mb-6";

    // lista de meses
    let listaMeses = '';
    indicador.pendencias.forEach(p => {
      const competencia = `${String(p.mes).padStart(2, '0')}/${p.ano}`;
      listaMeses += `
        <button 
          class="bg-yellow-100 hover:bg-yellow-200 text-yellow-900 px-3 py-1 rounded text-sm"
          onclick="abrirModal(${indicador.id}, '${indicador.nome.replace(/'/g, "\\'")}', ${p.mes}, ${p.ano})"
        >
          ${competencia}
        </button>
      `;
    });

    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <h3 class="text-lg font-bold text-gray-800">${indicador.nome}</h3>
          <p class="text-sm text-gray-500">${indicador.descricao || ''}</p>
        </div>
        <div class="text-blue-500">
          <i class="fas fa-chart-line text-2xl"></i>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        ${listaMeses}
      </div>
    `;

    container.appendChild(card);
  });
}

// =============================
// 🔹 Modal de preenchimento
// =============================
function abrirModal(indicadorId, indicadorNome, mes, ano) {
  indicadorSelecionado = { id: indicadorId, nome: indicadorNome, mes, ano };

  document.getElementById('titulo-indicador').innerText = `Preencher - ${indicadorNome}`;
  document.getElementById('modal-preencher').classList.remove('hidden');

  // limpar campos
  document.getElementById('valor').value = '';
  document.getElementById('comentario').value = '';
  document.getElementById('origem').value = '';
  document.getElementById('provas').value = '';

  // setar mês/ano e bloquear edição
  document.getElementById('mes').value = `${String(mes).padStart(2, '0')}/${ano}`;
  document.getElementById('mes').disabled = true;
}

function fecharModal() {
  document.getElementById('modal-preencher').classList.add('hidden');
}

// =============================
// 🔹 Submissão do preenchimento
// =============================
document.getElementById('formPreenchimento').addEventListener('submit', async function (e) {
  e.preventDefault();

  const token = localStorage.getItem('access');
  const valor = document.getElementById('valor').value;
  const comentario = document.getElementById('comentario').value;
  const origem = document.getElementById('origem').value;
  const arquivo = document.getElementById('provas').files[0];

  if (!indicadorSelecionado || !valor) {
    alert("Preencha os campos obrigatórios.");
    return;
  }

  if (arquivo && arquivo.size > 2 * 1024 * 1024) {
    alert("O arquivo é muito grande. Máximo permitido: 2MB.");
    return;
  }

  const formData = new FormData();
  formData.append('indicador', indicadorSelecionado.id);
  formData.append('valor_realizado', valor);
  formData.append('mes', indicadorSelecionado.mes);
  formData.append('ano', indicadorSelecionado.ano);

  if (comentario) formData.append('comentario', comentario);
  if (origem) formData.append('origem', origem);
  if (arquivo) formData.append('arquivo', arquivo);

  try {
    const res = await fetch(`${window.API_BASE_URL}/api/preenchimentos/`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    if (!res.ok) {
      let msg = "Erro ao salvar o preenchimento.";
      try {
        const err = await res.json();
        msg = Object.values(err).flat().join('\n');
      } catch {
        msg = "Erro interno no servidor (500).";
      }
      throw new Error(msg);
    }

    alert('Preenchimento salvo com sucesso!');
    fecharModal();

    // Recarrega os dados para refletir a pendência resolvida
    await carregarPreenchimentos();
    // Opcional: recarregar setores do usuário (não deve mudar, mas mantém consistência de estado)
    // await carregarUsuarioSetores();
    await carregarIndicadores();

  } catch (err) {
    console.error("Erro detalhado:", err);
    alert("Erro ao salvar o preenchimento:\n" + err.message);
  }
});

// =============================
// 🔹 Inicialização
// =============================
window.onload = async () => {
  // Ordem importa: setores do usuário antes de filtrar pendentes
  await carregarPreenchimentos();
  await carregarUsuarioSetores();   // popula __setoresUsuarioIds/__setoresUsuarioIdsStr
  await carregarIndicadores();      // lista só pendentes dos setores do gestor logado
};
