let todosIndicadores = [];
let indicadorEditandoId = null;

/* =========================
   Helpers de números
========================= */
// Helper: pega o último mês existente nas metas_mensais
function obterMesFinalDoIndicador(ind) {
  const metas = Array.isArray(ind.metas_mensais) ? ind.metas_mensais : [];
  if (metas.length === 0) return null; // sem metas criadas
  // metas já vêm ordenadas por "mes" do backend
  return metas[metas.length - 1].mes;   // e.g. "2025-03-01"
}

// Regra: o ÚLTIMO separador (',' ou '.') é o decimal; os demais são milhar.
function normalizarNumeroUniversal(input) {
  if (input == null) return null;
  let s = String(input).trim().replace(/\s/g, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decPos = Math.max(lastComma, lastDot);

  // Mantém apenas dígitos
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;

  let canon;
  if (decPos >= 0) {
    const after = s.slice(decPos + 1).replace(/[^\d]/g, "");
    if (after.length === 0) {
      // Ex.: "1.000," → inteiro
      canon = digits;
    } else {
      const intLen = digits.length - after.length;
      if (intLen <= 0) {
        // Ex.: ",50" → "0.50"
        canon = "0." + digits.padStart(after.length, "0");
      } else {
        canon = digits.slice(0, intLen) + "." + digits.slice(intLen);
      }
    }
  } else {
    // Sem separador → inteiro
    canon = digits;
  }

  // Garante número válido
  const n = Number(canon);
  return Number.isFinite(n) ? canon : null;
}

// Valida um decimal canônico "1234.56" contra maxDigits e decimalPlaces.
// Ex.: maxDigits=10, decimalPlaces=2  -> inteiro pode ter até 8 dígitos.
function validarDecimalCanon(canonStr, { maxDigits = 10, decimalPlaces = 2, allowNegative = false } = {}) {
  if (canonStr == null) return false;
  let s = String(canonStr);

  const neg = s.startsWith('-');
  if (neg && !allowNegative) return false;
  if (neg) s = s.slice(1);

  // canônico com ponto
  if (!/^\d+(\.\d+)?$/.test(s)) return false;

  const [intPart, fracPart = ""] = s.split('.');
  if (fracPart.length > decimalPlaces) return false;

  // total de dígitos (inteiro + frac)
  const intLen = intPart.replace(/^0+/, '').length || 1; // "0.12" => 1 no inteiro
  const totalDigits = intLen + fracPart.length;
  if (totalDigits > maxDigits) return false;

  return true;
}

// Retorna string com exatamente 2 casas: "1234.56"
function limitarAteDuasCasas(canonStr) {
  if (canonStr == null) return null;
  const n = Number(canonStr);
  if (!Number.isFinite(n)) return null;
  return (Math.round(n * 100) / 100).toFixed(2);
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

    // Índice global p/ consulta no modal (inclui inativos)
    window._setoresIndex = new Map(
      setores.map(s => [String(s.id), s])
    );

    // Somente ativos para preencher selects (cadastro/filtro)
    const ativos = setores.filter(s => s.ativo);

    const selectSetor      = document.getElementById('setorMetrica');
    const filtroSetor      = document.getElementById('filtro-setor');
    const editSelectSetor  = document.getElementById('edit-setor');

    if (selectSetor)     selectSetor.innerHTML     = '<option value="">Selecione</option>';
    if (filtroSetor)     filtroSetor.innerHTML     = '<option value="todos">Todos</option>';
    if (editSelectSetor) editSelectSetor.innerHTML = '<option value="">Selecione</option>';

    ativos.forEach(s => {
      if (selectSetor)     selectSetor.appendChild(new Option(s.nome, s.id));
      if (filtroSetor)     filtroSetor.appendChild(new Option(s.nome, s.id));
      if (editSelectSetor) editSelectSetor.appendChild(new Option(s.nome, s.id));
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
  const filtroNomeEl  = document.getElementById('filtro-nome');

  const filtroSetor = filtroSetorEl ? filtroSetorEl.value : 'todos';
  const filtroNome  = (filtroNomeEl ? filtroNomeEl.value : '').toLowerCase();

  const filtrados = todosIndicadores
    .filter(i =>
      i.ativo === true && // << só ativos
      (filtroSetor === 'todos' || String(i.setor) === String(filtroSetor)) &&
      i.nome.toLowerCase().includes(filtroNome)
    )
    .sort((a, b) => ((a.status || '').toLowerCase() === 'pendente' ? -1 : 1));

  return { filtrados, filtroSetor };
}

function renderBotaoExcel() {
  const toolbar = document.getElementById('export-toolbar');
  if (!toolbar) return;

  const { filtrados } = getIndicadoresFiltrados();

  toolbar.innerHTML = `
    <button id="btn-exportar-excel"
            class="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm">
      <i class="fa-solid fa-file-excel mr-2"></i> Exportar Excel
    </button>
  `;

  document.getElementById('btn-exportar-excel')
    .addEventListener('click', () => exportarExcelIndicadores(filtrados));
}

function exportarExcelIndicadores(linhas) {
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
    "Mês Final": ind.mes_final
    ? new Date(ind.mes_final + 'T00:00:00')
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

  const { filtrados } = getIndicadoresFiltrados();

  const contador = document.getElementById('contador-indicadores');
  if (contador) contador.textContent = `( ${filtrados.length} Indicadores )`;

  renderBotaoExcel();

  lista.innerHTML = '';

  if (filtrados.length === 0) {
    lista.innerHTML = `
      <tr><td colspan="10" class="text-center text-gray-500 py-4">Nenhum indicador encontrado.</td></tr>
    `;
    return;
  }

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
      <td class="px-4 py-2">${
        ind.mes_final
          ? new Date(ind.mes_final + 'T00:00:00')
              .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
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

  const mesFinalRaw = document.getElementById('mesFinal')?.value || ''; // 'YYYY-MM'
  const mes_final = mesFinalRaw ? `${mesFinalRaw}-01` : null;

  const visibilidade = (document.getElementById('visibilidade')?.value || 'true') === 'true';
  const extracao_indicador = document.getElementById('extracaoIndicador')?.value || '';

  if (!nome || !setor || !valorMetaBruto || !tipo_meta) {
    alert("Preencha todos os campos obrigatórios.");
    return;
  }

  // Normaliza e limita a 2 casas
  const valorCanon = normalizarNumeroUniversal(valorMetaBruto);
  const valor_meta = valorCanon !== null ? limitarAteDuasCasas(valorCanon) : null;

  if (valor_meta === null && valorMetaBruto !== '') {
    alert("Valor da Meta inválido. Use formatos como 1234.56 ou 1.234,56.");
    return;
  }

  // valida maxDigits e decimais (ajuste maxDigits conforme seu model)
  if (valor_meta !== null && !validarDecimalCanon(valor_meta, { maxDigits: 10, decimalPlaces: 2 })) {
    alert("Valor da Meta muito grande: máximo 10 dígitos no total e 2 casas decimais.");
    return;
  }

  const payload = {
    nome,
    setor,
    valor_meta,           // "1234.56" ou null
    tipo_meta,
    tipo_valor,
    visibilidade,
    extracao_indicador
  };

  if (periodicidade !== null && !Number.isNaN(periodicidade)) payload.periodicidade = periodicidade;
  if (mes_inicial) payload.mes_inicial = mes_inicial;
  if (mes_final) payload.mes_final = mes_final;

  const botao = event.submitter;
  if (botao) botao.disabled = true;

  try {
    const url = `${window.API_BASE_URL}/api/indicadores/`;
    const method = 'POST';

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
        alert("Erro ao salvar indicador:\n" + (errorData?.valor_meta?.join?.('\n') || JSON.stringify(errorData, null, 2)));
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

  const idEl   = document.getElementById('edit-id');
  const nomeEl = document.getElementById('edit-nome');
  const setorEl= document.getElementById('edit-setor');
  const metaEl = document.getElementById('edit-meta');
  const tipoEl = document.getElementById('edit-tipo');
  const perEl  = document.getElementById('edit-periodicidade');
  const minEl  = document.getElementById('edit-mes-inicial');
  const mfnEl  = document.getElementById('edit-mes-final');
  const visEl  = document.getElementById('edit-visibilidade');
  const extEl  = document.getElementById('edit-extracao');
  const tipoValorEl = document.getElementById('edit-tipo-valor');

  idEl.value = indicador.id;
  nomeEl.value = indicador.nome;
  setorEl.value = indicador.setor;

  metaEl.value = String(indicador.valor_meta ?? '');
  metaEl.dataset.original = String(indicador.valor_meta ?? '');

  tipoEl.value = indicador.tipo_meta;
  perEl.value  = indicador.periodicidade ?? '';
  minEl.value  = indicador.mes_inicial ? indicador.mes_inicial.slice(0, 7) : '';
  {
    const mf = indicador.mes_final; // vem do backend
    mfnEl.value = mf ? mf.slice(0, 7) : '';
  }
  mfnEl.dataset.original = indicador.mes_final ? indicador.mes_final.slice(0, 7) : '';
  visEl.value  = String(indicador.visibilidade);
  extEl.value  = indicador.extracao_indicador || '';
  tipoValorEl.value = indicador.tipo_valor || 'numeral';

  // grava originais para o diff no submit
  nomeEl.dataset.original          = indicador.nome ?? '';
  setorEl.dataset.original         = String(indicador.setor ?? '');
  tipoEl.dataset.original          = indicador.tipo_meta ?? '';
  tipoValorEl.dataset.original     = indicador.tipo_valor ?? 'numeral';
  perEl.dataset.original           = perEl.value;
  minEl.dataset.original           = minEl.value;
  mfnEl.dataset.original           = mfnEl.value;
  visEl.dataset.original           = String(indicador.visibilidade);
  extEl.dataset.original           = extEl.value;

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

  const nomeEl = document.getElementById('edit-nome');
  const setorEl = document.getElementById('edit-setor');
  const metaEl  = document.getElementById('edit-meta');
  const tipoMetaEl  = document.getElementById('edit-tipo');
  const tipoValorEl = document.getElementById('edit-tipo-valor');
  const periodicidadeEl = document.getElementById('edit-periodicidade');
  const mesInicialEl = document.getElementById('edit-mes-inicial');
  const mesFinalEl   = document.getElementById('edit-mes-final');
  const visibilidadeEl = document.getElementById('edit-visibilidade');
  const extracaoEl = document.getElementById('edit-extracao');

  const nome = (nomeEl?.value || '').trim();
  const setor = setorEl?.value || '';
  const valorMetaBrutoEdit = (metaEl?.value || '').trim();
  const valorMetaBrutoOriginal = (metaEl?.dataset?.original ?? '').trim();

  const tipo_meta  = tipoMetaEl?.value || '';
  const tipo_valor = tipoValorEl?.value || 'numeral';

  const periodicidadeRaw = periodicidadeEl?.value || '';
  const periodicidade = periodicidadeRaw !== '' ? parseInt(periodicidadeRaw, 10) : null;

  const mesInicialRaw = mesInicialEl?.value || ''; // 'YYYY-MM'
  const mes_inicial = mesInicialRaw ? `${mesInicialRaw}-01` : null;

  const mesFinalRaw = mesFinalEl?.value || ''; // 'YYYY-MM'
  const mes_final = mesFinalRaw ? `${mesFinalRaw}-01` : null;

  const visibilidade = (visibilidadeEl?.value || 'true') === 'true';
  const extracao_indicador = extracaoEl?.value || '';

  // valida período
  if (mes_inicial && mes_final && mes_final < mes_inicial) {
    alert("O Mês Final deve ser maior ou igual ao Mês Inicial.");
    return;
  }

  // monta payload SOMENTE com campos alterados (diff) — exceto valor_meta (sempre enviamos)
  const payload = {};

  if (nomeEl && nome !== (nomeEl.dataset?.original ?? '').trim()) {
    payload.nome = nome;
  }

  if (setorEl && setor !== (setorEl.dataset?.original ?? '')) {
    payload.setor = setor;
  }

  if (tipoMetaEl && tipo_meta !== (tipoMetaEl.dataset?.original ?? '')) {
    payload.tipo_meta = tipo_meta;
  }

  if (tipoValorEl && tipo_valor !== (tipoValorEl.dataset?.original ?? 'numeral')) {
    payload.tipo_valor = tipo_valor;
  }

  if (periodicidadeEl && periodicidadeRaw !== (periodicidadeEl.dataset?.original ?? '')) {
    if (periodicidade !== null && !Number.isNaN(periodicidade)) {
      payload.periodicidade = periodicidade;
    } else {
      payload.periodicidade = null;
    }
  }

  if (mesInicialEl && mesInicialRaw !== (mesInicialEl.dataset?.original ?? '')) {
    if (mes_inicial) payload.mes_inicial = mes_inicial; else payload.mes_inicial = null;
  }

  if (mesFinalEl && mesFinalRaw !== (mesFinalEl.dataset?.original ?? '')) {
    if (mes_final) payload.mes_final = mes_final; else payload.mes_final = null;
  }

  if (visibilidadeEl && String(visibilidade) !== (visibilidadeEl.dataset?.original ?? '')) {
    payload.visibilidade = visibilidade;
  }

  if (extracaoEl && extracao_indicador !== (extracaoEl.dataset?.original ?? '')) {
    payload.extracao_indicador = extracao_indicador;
  }

  // valor_meta — SEMPRE envie canônico com 2 casas + valida maxDigits
  const canonOld = normalizarNumeroUniversal(valorMetaBrutoOriginal);
  const old2 = (canonOld !== null) ? limitarAteDuasCasas(canonOld) : null;

  let valorMeta2c;
  if (tipo_meta === 'monitoramento') {
    valorMeta2c = "0.00";
  } else {
    if (valorMetaBrutoEdit !== '') {
      const canonNew = normalizarNumeroUniversal(valorMetaBrutoEdit);
      if (canonNew === null) {
        alert("Valor da Meta inválido. Use formatos como 1234.56 ou 1.234,56.");
        return;
      }
      valorMeta2c = limitarAteDuasCasas(canonNew);
    } else {
      if (old2 === null) {
        alert("Valor da Meta original ausente. Informe um valor.");
        return;
      }
      valorMeta2c = old2;
    }
  }

  if (!validarDecimalCanon(valorMeta2c, { maxDigits: 10, decimalPlaces: 2 })) {
    alert("Valor da Meta muito grande: máximo 10 dígitos no total e 2 casas decimais.");
    return;
  }

  payload.valor_meta = valorMeta2c;

  // Se nada mudou (e ainda assim valor_meta será enviado), seguimos; remover o guard padrão
  // if (Object.keys(payload).length === 0) { ... }  // -> não aplicável mais

  try {
    const response = await fetch(`${window.API_BASE_URL}/api/indicadores/${id}/`, {
      method: 'PATCH',
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
        const emeta = erro?.valor_meta?.join?.('\n');
        alert("Erro ao atualizar indicador:\n" + (emeta || JSON.stringify(erro, null, 2)));
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

  // Drawer: abrir/fechar
  const btnOpen   = document.getElementById('btn-toggle-inativos-indicadores');
  const btnClose  = document.getElementById('btn-close-inativos-indicadores');
  const backdrop  = document.getElementById('drawer-backdrop-indicadores');

  btnOpen?.addEventListener('click', abrirDrawerIndicadoresInativos);
  btnClose?.addEventListener('click', fecharDrawerIndicadoresInativos);
  backdrop?.addEventListener('click', fecharDrawerIndicadoresInativos);

  // Fecha com ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharDrawerIndicadoresInativos();
  });
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

// === Drawer: Indicadores Inativos ===
function abrirDrawerIndicadoresInativos() {
  const root  = document.getElementById('drawer-inativos-indicadores');
  const panel = document.getElementById('drawer-panel-indicadores');
  if (!root || !panel) return;
  root.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.remove('translate-x-full'));
  listarIndicadoresInativos();
}

function fecharDrawerIndicadoresInativos() {
  const root  = document.getElementById('drawer-inativos-indicadores');
  const panel = document.getElementById('drawer-panel-indicadores');
  if (!root || !panel) return;
  panel.classList.add('translate-x-full');
  setTimeout(() => root.classList.add('hidden'), 300);
}

async function listarIndicadoresInativos() {
  const cont = document.getElementById('lista-indicadores-inativos');
  if (!cont) return;

  cont.innerHTML = `<p class="text-gray-400">Carregando...</p>`;

  try {
    // Garante ter dados em memória
    if (!Array.isArray(todosIndicadores) || todosIndicadores.length === 0) {
      await carregarIndicadores();
    }

    const inativos = todosIndicadores.filter(i => i.ativo === false);

    cont.innerHTML = '';
    if (inativos.length === 0) {
      cont.innerHTML = `<p class="text-gray-500">Nenhum indicador inativo.</p>`;
      return;
    }

    inativos.forEach(ind => {
      const div = document.createElement('div');
      div.className = 'flex justify-between items-center border rounded px-3 py-2';
      div.innerHTML = `
        <div>
          <div class="font-medium">${ind.nome}</div>
          <div class="text-xs text-gray-500">${ind.setor_nome ?? '-'}</div>
        </div>
        <button class="text-green-600 hover:underline" onclick="ativarIndicadorViaDrawer(${ind.id})">Ativar</button>
      `;
      cont.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    cont.innerHTML = `<p class="text-red-500">Erro ao carregar inativos.</p>`;
  }
}

async function ativarIndicadorViaDrawer(id) {
  await toggleStatusIndicador(id, false); // false = está inativo -> ativar
  // Atualiza as duas visões
  listarIndicadoresInativos();
}

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
