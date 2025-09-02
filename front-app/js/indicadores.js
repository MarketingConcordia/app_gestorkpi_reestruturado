let todosIndicadores = [];
let indicadorEditandoId = null;

/* =========================
   Helpers de números
========================= */
// Regra: o ÚLTIMO separador (',' ou '.') é o decimal; os demais são milhar.
function normalizarNumeroUniversal(input) {
  if (input == null) return "";
  let s = String(input).trim().replace(/\s/g, "");
  if (!s) return "";

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decPos = Math.max(lastComma, lastDot);

  // Mantém apenas dígitos
  const digits = s.replace(/[^\d]/g, "");

  if (decPos >= 0) {
    const after = s.slice(decPos + 1).replace(/[^\d]/g, "");
    if (after.length === 0) {
      // Ex.: "1.000," → inteiro
      return digits;
    }
    const intLen = digits.length - after.length;
    if (intLen <= 0) {
      // Ex.: ",50" → "0.50"
      return "0." + digits.padStart(after.length, "0");
    }
    return digits.slice(0, intLen) + "." + digits.slice(intLen);
  }

  // Sem separador → inteiro
  return digits;
}

/* =========================
   Carregar setores e preencher selects
========================= */
async function carregarSetores() {
  try {
    const token = localStorage.getItem('access');
    const response = await fetch(`${window.API_BASE_URL}/api/setores/`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("Erro ao buscar setores");

    const data = await response.json().catch(() => ({}));
    const setores = (data && (data.results || data)) || [];
    console.log("Setores recebidos:", setores);

    const selectSetor = document.getElementById('setorMetrica');
    const filtroSetor = document.getElementById('filtro-setor');
    const editSelectSetor = document.getElementById('edit-setor');

    if (selectSetor) selectSetor.innerHTML = '<option value="">Selecione</option>';
    if (filtroSetor) filtroSetor.innerHTML = '<option value="todos">Todos</option>';
    if (editSelectSetor) editSelectSetor.innerHTML = '<option value="">Selecione</option>';

    setores.forEach(setor => {
      if (selectSetor) selectSetor.appendChild(new Option(setor.nome, setor.id));
      if (filtroSetor) filtroSetor.appendChild(new Option(setor.nome, setor.id));
      if (editSelectSetor) editSelectSetor.appendChild(new Option(setor.nome, setor.id));
    });
  } catch (error) {
    console.error("Erro ao carregar setores:", error);
  }
}

/* =========================
   Formatação de valores (somente exibição)
========================= */
function formatarComTipo(valor, tipo) {
  if (valor == null || valor === '') return '-';
  // Converte qualquer entrada (incluindo "1.000,50") para número JS seguro
  const canon = normalizarNumeroUniversal(valor);
  const numero = Number(canon);
  if (!isFinite(numero)) return String(valor);

  switch (tipo) {
    case 'monetario':
      return 'R$ ' + numero.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    case 'percentual':
      return numero.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '%';
    default:
      return numero.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  }
}

/* =========================
   Carregar indicadores
========================= */
async function carregarIndicadores() {
  try {
    const token = localStorage.getItem('access');
    let url = `${window.API_BASE_URL}/api/indicadores/?page_size=200`;
    let acumulado = [];

    while (url) {
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!resp.ok) throw new Error("Erro ao carregar indicadores");
      const data = await resp.json().catch(() => ({}));
      const page = (data && (data.results || data)) || [];
      acumulado = acumulado.concat(page);
      url = data.next || null;
    }

    todosIndicadores = acumulado;
    todosIndicadores.forEach(i => console.log("🔎 Indicador:", i));
    renderizarIndicadores();
  } catch (error) {
    console.error("Erro ao buscar indicadores:", error);
  }
}

function getIndicadoresFiltrados() {
  const filtroSetorEl = document.getElementById('filtro-setor');
  const filtroNomeEl = document.getElementById('filtro-nome');

  const filtroSetor = filtroSetorEl ? filtroSetorEl.value : 'todos';
  const filtroNome = (filtroNomeEl ? filtroNomeEl.value : '').toLowerCase();

  const filtrados = todosIndicadores
    .filter(i =>
      (filtroSetor === 'todos' || String(i.setor) === String(filtroSetor)) &&
      i.nome.toLowerCase().includes(filtroNome)
    )
    .sort((a, b) => ((a.status || '').toLowerCase() === 'pendente' ? -1 : 1));

  return { filtrados, filtroSetor };
}

function renderBotaoExcel() {
  const toolbar = document.getElementById('export-toolbar');
  if (!toolbar) return;

  const { filtrados, filtroSetor } = getIndicadoresFiltrados();

  // Mostra botão somente se tiver um setor específico selecionado e houver dados
  
  toolbar.innerHTML = `
    <button id="btn-exportar-excel"
            class="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm">
      <i class="fa-solid fa-file-excel mr-2"></i> Exportar Excel
    </button>
  `;
  // liga o clique
  document.getElementById('btn-exportar-excel')
    .addEventListener('click', () => exportarExcelIndicadores(filtrados));
  } 

function exportarExcelIndicadores(linhas) {
  // Monte as colunas que você quer ver na planilha
  const dados = linhas.map(ind => ({
    "Indicador": ind.nome,
    "Setor": ind.setor_nome ?? '-',
    "Meta": formatarComTipo(ind.valor_meta, ind.tipo_valor),
    "Tipo de Meta": ind.tipo_meta,
    "Visibilidade": ind.visibilidade ? 'Todos' : 'Restrito',
    "Periodicidade (meses)": ind.periodicidade ?? 1,
    "Mês Inicial": ind.mes_inicial
      ? new Date(ind.mes_inicial + 'T00:00:00')
          .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      : '--',
    "Status": (ind.status || '').toUpperCase(),
    "Ativo": ind.ativo ? 'Ativo' : 'Inativo'
  }));

  const ws = XLSX.utils.json_to_sheet(dados);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Indicadores");
  XLSX.writeFile(wb, `indicadores_filtrados.xlsx`);
}

/* =========================
   Renderizar lista de indicadores
========================= */
function renderizarIndicadores() {
  const lista = document.getElementById('indicadores-lista');
  if (!lista) return;

  // usa a função centralizada
  const { filtrados } = getIndicadoresFiltrados();

  // contador
  const contador = document.getElementById('contador-indicadores');
  if (contador) contador.textContent = `( ${filtrados.length} Indicadores )`;

  // toolbar (mostra/esconde botão)
  renderBotaoExcel();

  // Limpa a lista antes de renderizar
  lista.innerHTML = '';

  if (filtrados.length === 0) {
    lista.innerHTML = `
      <tr><td colspan="10" class="text-center text-gray-500 py-4">Nenhum indicador encontrado.</td></tr>
    `;
    return;
  }

  // === permanece igual ao seu código para montar as rows ===
  filtrados.forEach(ind => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50';
    tr.innerHTML = `
      <td class="px-4 py-2 font-semibold">${ind.nome}</td>
      <td class="px-4 py-2">${ind.setor_nome ?? '-'}</td>
      <td class="px-4 py-2">${formatarComTipo(ind.valor_meta, ind.tipo_valor)}</td>
      <td class="px-4 py-2 capitalize">${ind.tipo_meta}</td>
      <td class="px-4 py-2">${ind.visibilidade ? 'Todos' : 'Restrito'}</td>
      <td class="px-4 py-2">${(ind.periodicidade ?? 1)} mês(es)</td>
      <td class="px-4 py-2">${
        ind.mes_inicial
          ? new Date(ind.mes_inicial + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
          : '--'
      }</td>
      <td class="px-4 py-2">
        <span class="${(ind.status || '').toLowerCase() === 'pendente' ? 'text-red-600' : 'text-green-600'} font-bold">
          ${(ind.status || '').toUpperCase()}
        </span>
      </td>
      <td class="px-4 py-2 text-${ind.ativo ? 'green' : 'red'}-600 font-semibold">
        ${ind.ativo ? 'Ativo' : 'Inativo'}
      </td>
      <td class="px-4 py-2 text-center space-x-2">
        <button onclick='abrirModal(${JSON.stringify(ind)})' class="text-blue-600 hover:underline">Editar</button>
        <button onclick="toggleStatusIndicador(${ind.id}, ${ind.ativo})" class="${ind.ativo ? 'text-red-600' : 'text-green-600'} hover:underline">
          ${ind.ativo ? 'Inativar' : 'Ativar'}
        </button>
      </td>
    `;
    lista.appendChild(tr);
  });
}

/* =========================
   Ativar / Inativar indicador
========================= */
async function toggleStatusIndicador(id, statusAtual) {
  const confirmar = confirm(`Deseja realmente ${statusAtual ? 'inativar' : 'ativar'} este indicador?`);
  if (!confirmar) return;

  const token = localStorage.getItem('access');

  try {
    const response = await fetch(`${window.API_BASE_URL}/api/indicadores/${id}/`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ativo: !statusAtual })
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error("Erro ao atualizar status:", txt);
      throw new Error("Erro ao atualizar status");
    }

    await carregarIndicadores();

  } catch (error) {
    console.error("Erro ao mudar status:", error);
    alert("Erro ao mudar status do indicador.");
  }
}

/* =========================
   Criar indicador
========================= */
async function salvarIndicador(event) {
  event.preventDefault();
  const token = localStorage.getItem('access');

  const nome = (document.getElementById('nomeMetrica')?.value || '').trim();
  const setor = document.getElementById('setorMetrica')?.value || '';
  const valorMetaBruto = (document.getElementById('metaMetrica')?.value || '').trim();
  const tipo_meta = document.getElementById('tipo_meta')?.value || '';
  const tipo_valor = document.getElementById('tipo_valor')?.value || 'numeral';

  const periodicidadeRaw = document.getElementById('periodicidade')?.value || '';
  const periodicidade = periodicidadeRaw !== '' ? parseInt(periodicidadeRaw, 10) : null;

  const mesInicialRaw = document.getElementById('mesInicial')?.value || ''; // 'YYYY-MM'
  const mes_inicial = mesInicialRaw ? `${mesInicialRaw}-01` : null;

  const visibilidade = (document.getElementById('visibilidade')?.value || 'true') === 'true';
  const extracao_indicador = document.getElementById('extracaoIndicador')?.value || '';

  if (!nome || !setor || !valorMetaBruto || !tipo_meta) {
    alert("Preencha todos os campos obrigatórios.");
    return;
  }

  // Normaliza valor_meta ANTES de enviar
  const valor_meta = normalizarNumeroUniversal(valorMetaBruto);

  // monta payload sem campos nulos/undefined
  const payload = {
    nome,
    setor,
    valor_meta,           // << normalizado
    tipo_meta,
    tipo_valor,
    visibilidade,
    extracao_indicador
  };
  if (periodicidade !== null && !Number.isNaN(periodicidade)) payload.periodicidade = periodicidade;
  if (mes_inicial) payload.mes_inicial = mes_inicial;

  const botao = event.submitter;
  if (botao) botao.disabled = true;

  try {
    const url = indicadorEditandoId
      ? `${window.API_BASE_URL}/api/indicadores/${indicadorEditandoId}/`
      : `${window.API_BASE_URL}/api/indicadores/`;
    const method = indicadorEditandoId ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const raw = await response.text();
      try {
        const errorData = JSON.parse(raw);
        console.error("Erro detalhado (JSON):", errorData);
        alert("Erro ao salvar indicador:\n" + JSON.stringify(errorData, null, 2));
      } catch {
        console.error("Erro detalhado (HTML/texto):", raw);
        alert("Erro ao salvar indicador. Veja o console para detalhes.");
      }
      return;
    }

    indicadorEditandoId = null;
    document.getElementById('form-metrica')?.reset();
    await carregarIndicadores();

  } catch (error) {
    console.error("Erro ao salvar:", error);
    alert("Erro ao salvar indicador.");
  } finally {
    if (botao) botao.disabled = false;
  }
}

/* =========================
   Abrir/Fechar modal de edição
========================= */
function abrirModal(indicador) {
  indicadorEditandoId = indicador.id;

  document.getElementById('edit-id').value = indicador.id;
  document.getElementById('edit-nome').value = indicador.nome;
  document.getElementById('edit-setor').value = indicador.setor;

  // NO INPUT, use valor cru (sem formatação local)
  document.getElementById('edit-meta').value = String(indicador.valor_meta ?? '');

  document.getElementById('edit-tipo').value = indicador.tipo_meta;
  document.getElementById('edit-periodicidade').value = indicador.periodicidade ?? '';
  document.getElementById('edit-mes-inicial').value = indicador.mes_inicial ? indicador.mes_inicial.slice(0, 7) : '';
  document.getElementById('edit-visibilidade').value = String(indicador.visibilidade);
  document.getElementById('edit-extracao').value = indicador.extracao_indicador || '';
  document.getElementById('edit-tipo-valor').value = indicador.tipo_valor || 'numeral';
  document.getElementById('modal-edicao').classList.remove('hidden');
}

function fecharModal() {
  document.getElementById('modal-edicao').classList.add('hidden');
  indicadorEditandoId = null;
}

/* =========================
   Submeter edição do indicador
========================= */
document.getElementById('form-edicao-indicador')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = localStorage.getItem('access');
  const id = document.getElementById('edit-id').value;

  const nome = (document.getElementById('edit-nome')?.value || '').trim();
  const setor = document.getElementById('edit-setor')?.value || '';
  const valorMetaBrutoEdit = (document.getElementById('edit-meta')?.value || '').trim(); // pode ter , ou .
  const tipo_meta = document.getElementById('edit-tipo')?.value || '';
  const tipo_valor = document.getElementById('edit-tipo-valor')?.value || 'numeral';

  const periodicidadeRaw = document.getElementById('edit-periodicidade')?.value || '';
  const periodicidade = periodicidadeRaw !== '' ? parseInt(periodicidadeRaw, 10) : null;

  const mesInicialRaw = document.getElementById('edit-mes-inicial')?.value || ''; // 'YYYY-MM'
  const mes_inicial = mesInicialRaw ? `${mesInicialRaw}-01` : null;

  const visibilidade = (document.getElementById('edit-visibilidade')?.value || 'true') === 'true';
  const extracao_indicador = document.getElementById('edit-extracao')?.value || '';

  // Normaliza valor_meta ANTES de enviar
  const valor_meta = normalizarNumeroUniversal(valorMetaBrutoEdit);

  const payload = {
    nome,
    setor,
    valor_meta,     // << normalizado
    tipo_meta,
    tipo_valor,
    visibilidade,
    extracao_indicador
  };
  if (periodicidade !== null && !Number.isNaN(periodicidade)) payload.periodicidade = periodicidade;
  if (mes_inicial) payload.mes_inicial = mes_inicial;

  try {
    const response = await fetch(`${window.API_BASE_URL}/api/indicadores/${id}/`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const raw = await response.text();
      try {
        const erro = JSON.parse(raw);
        console.error("Erro detalhado (JSON):", erro);
        alert("Erro ao atualizar indicador:\n" + JSON.stringify(erro, null, 2));
      } catch {
        console.error("Erro detalhado (HTML/texto):", raw);
        alert("Erro ao atualizar indicador. Veja o console para detalhes.");
      }
      return;
    }

    await carregarIndicadores();
    fecharModal();

  } catch (error) {
    console.error("Erro ao editar indicador:", error);
    alert("Erro ao editar indicador.");
  }
});

/* =========================
   Inicialização
========================= */
document.addEventListener('DOMContentLoaded', () => {
  carregarSetores();
  carregarIndicadores();

  document.getElementById('filtro-setor')?.addEventListener('change', renderizarIndicadores);
  document.getElementById('form-metrica')?.addEventListener('submit', salvarIndicador);
  document.getElementById('filtro-nome')?.addEventListener('input', renderizarIndicadores);
});

/* =========================
   Aux: meta = 0 para monitoramento
========================= */
document.getElementById('tipo_meta')?.addEventListener('change', () => {
  const tipo = document.getElementById('tipo_meta').value;
  const campoMeta = document.getElementById('metaMetrica');

  if (!campoMeta) return;

  if (tipo === 'monitoramento') {
    campoMeta.value = 0;
    campoMeta.disabled = true;
  } else {
    campoMeta.disabled = false;
    if (campoMeta.value === '0') campoMeta.value = '';
  }
});

/* =========================
   Dia-limite (opcional)
========================= */
let configuracaoId = null;

function salvarDiaLimite() {
  const token = localStorage.getItem("access");
  const novoValor = parseInt(document.getElementById("input-dia-limite").value, 10);

  if (isNaN(novoValor) || novoValor < 1 || novoValor > 31) {
    alert("Informe um dia válido entre 1 e 31.");
    return;
  }

  if (!configuracaoId) {
    alert("Configuração não carregada.");
    return;
  }

  fetch(`${window.API_BASE_URL}/api/configuracoes/${configuracaoId}/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ dia_limite_preenchimento: novoValor })
  })
    .then(async res => {
      if (!res.ok) {
        const raw = await res.text();
        throw new Error(raw || "Erro ao salvar configuração");
      }
      document.getElementById("status-dia-limite").textContent = `Dia-limite atualizado para: ${novoValor}`;
    })
    .catch(err => {
      console.error("Erro:", err);
      alert("Erro ao salvar o dia-limite.");
    });
}
