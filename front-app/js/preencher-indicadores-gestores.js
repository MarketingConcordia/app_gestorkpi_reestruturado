// =============================
// 🔹 Estado Global
// =============================
let preenchimentosRealizados = new Set();
let indicadorSelecionado = null;

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
// 🔹 Carregar indicadores pendentes agrupados
// =============================
async function carregarIndicadores() {
  const token = localStorage.getItem('access');

  try {
    const res = await fetch(`${window.API_BASE_URL}/api/indicadores/pendentes/`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error("Erro ao buscar indicadores");
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Resposta inválida (esperado array)");

    // 🔹 Agrupar por indicador
    const agrupados = {};
    data.forEach(item => {
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
          onclick="abrirModal(${indicador.id}, '${indicador.nome}', ${p.mes}, ${p.ano})"
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
    await carregarPreenchimentos();
    carregarIndicadores();

  } catch (err) {
    console.error("Erro detalhado:", err);
    alert("Erro ao salvar o preenchimento:\n" + err.message);
  }
});

// =============================
// 🔹 Inicialização
// =============================
window.onload = async () => {
  await carregarPreenchimentos();
  carregarIndicadores();
};
