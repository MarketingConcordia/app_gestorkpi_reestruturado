// ====== Auth & Base ======
const token = localStorage.getItem('access');
if (!token) {
  window.location.href = 'login.html';
}
// Base única /api (não duplica se API_BASE_URL já tiver /api)
const __BASE = String(window.API_BASE_URL || "").replace(/\/+$/, "");
const apiBase = __BASE.endsWith("/api") ? __BASE : `${__BASE}/api`;

// ====== Estado Global ======
let graficoDesempenho = null;
let indicadoresComValoresGlobais = []; // indicadores processados
let periodosDisponiveis = {}; // { 'YYYY': Set('MM', 'MM'), ... }

let __PAGE_SIZE = 16;      // cards por página (ajuste: 8, 12, 24…)
let __PAGE_INDEX = 1;      // página atual (1-based)
let __LAST_RENDER_DATA = []; // último conjunto filtrado, para re-render

// ====== Utils ======
// Normaliza respostas DRF (paginadas ou lista simples)
function asList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

function normalizarTexto(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // remove acentos
    .replace(/\s+/g, "")            // remove espaços
    .replace(/-/g, "");             // remove hífens
}

// Verifica se a meta foi atingida
function verificarAtingimento(tipo, valor, meta) {
  if (!tipo || valor == null || meta == null) return false;
  const v = Number(valor);
  const m = Number(meta);
  if (Number.isNaN(v) || Number.isNaN(m)) return false;

  if (tipo === 'crescente') return v >= m;
  if (tipo === 'decrescente') return v <= m;
  if (tipo === 'monitoramento') return Math.abs(v - m) <= 5;
  return false;
}

// Formata valores com base no tipo_valor
function formatarValorComTipo(valor, tipo) {
  if (valor == null || valor === '') return "-";
  const numero = Number(valor);
  if (Number.isNaN(numero)) return "-";

  if (tipo === "monetario") {
    return `R$ ${numero.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  } else if (tipo === "percentual") {
    return `${numero.toFixed(2)}%`;
  } else {
    return numero.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  }
}

function gerarIntervaloDeMeses(dataInicio, dataFim) {
  const [anoInicio, mesInicio] = dataInicio.split("-").map(Number);
  const [anoFim, mesFim] = dataFim.split("-").map(Number);

  const datas = [];
  let ano = anoInicio;
  let mes = mesInicio;

  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    datas.push(`${ano}-${String(mes).padStart(2, "0")}-01`); // YYYY-MM-01
    mes++;
    if (mes > 12) { mes = 1; ano++; }
  }
  return datas;
}

// ====== Helpers de Competência (MM/AAAA) ======

function temAlgumPreenchimento(ind) {
  // valor_atual conta (inclusive 0 é válido)
  if (ind && ind.valor_atual !== null && ind.valor_atual !== undefined) return true;

  // histórico conta (qualquer mês com valor_realizado)
  if (ind && Array.isArray(ind.historico)) {
    for (const h of ind.historico) {
      if (h && h.valor_realizado !== null && h.valor_realizado !== undefined) return true;
    }
  }
  return false;
}

function labelMesAno(item) {
  if (item?.mes && item?.ano) return `${String(item.mes).padStart(2,'0')}/${item.ano}`;
  if (item?.data) {
    const d = new Date(item.data);
    return `${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }
  return '-';
}

function chaveAnoMes(item) {
  if (item?.mes && item?.ano) return `${item.ano}-${String(item.mes).padStart(2,'0')}`; // YYYY-MM
  if (item?.data) {
    const d = new Date(item.data);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  return '';
}

function dataReferencia(item) {
  if (item?.ano && item?.mes) return new Date(Date.UTC(item.ano, item.mes - 1, 1));
  if (item?.data) {
    const d = new Date(item.data);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  }
  return null;
}

function competenciaAtual() {
  const d = new Date();
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
}

// ====== Bootstrapping: Perfil + Consolidados ======
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Perfil do usuário via API (fica só em memória)
    let perfil = window.__perfilUsuario || null;
    if (!perfil) {
      const resUser = await fetch(`${apiBase}/meu-usuario/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resUser.ok) throw new Error('Falha ao obter usuário');
      const user = await resUser.json();
      perfil = user.perfil;
      window.__perfilUsuario = perfil; // memória
    }

    if (perfil !== "master") {
      alert("Acesso negado. Esta página é exclusiva para perfil master.");
      window.location.href = "indexgestores.html";
      return;
    }

    preencherSelectSetores();

    const res = await fetch(`${apiBase}/indicadores/dados-consolidados/`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Erro na API: ${res.statusText}`);

    const indicadoresConsolidadosData = await res.json();
    const indicadoresCalculados = asList(indicadoresConsolidadosData);

    // Índice de cor estável (1..50) a partir do nome do setor
    const corIndexFromSetor = (nome) => {
      if (!nome) return 1;
      let hash = 0;
      for (let i = 0; i < nome.length; i++) {
        hash = (hash * 31 + nome.charCodeAt(i)) >>> 0;
      }
      return (hash % 50) + 1;
    };

    const temAlgumPreenchimento = (ind) =>
      Array.isArray(ind.historico) &&
      ind.historico.some(h => h.valor != null && !Number.isNaN(Number(h.valor)));

    // Normalização backend -> frontend + filtro: apenas indicadores com algum preenchimento
    indicadoresComValoresGlobais = indicadoresCalculados
      .map(ind => {
        const historico = asList(ind.historico).map(h => {
          const data = h.data_preenchimento || h.data || null;
          const d = data ? new Date(data) : null;
          // usa mes/ano do backend se vierem; senão calcula a partir da data (1º dia do mês)
          const mes = h.mes ?? (d ? (d.getUTCMonth() + 1) : null);
          const ano = h.ano ?? (d ? d.getUTCFullYear() : null);

          return {
            id: h.id,
            data,                 // mantemos se precisar
            mes,                  // competência
            ano,                  // competência
            valor: h.valor_realizado != null ? Number(h.valor_realizado) : null,
            meta: h.meta != null ? Number(h.meta) : null,
            comentario: h.comentario || '',
            provas: h.arquivo ? [h.arquivo] : []
          };
        });

        return {
          ...ind,
          valor_atual: ind.valor_atual != null ? Number(ind.valor_atual) : null,
          valor_meta: ind.valor_meta != null ? Number(ind.valor_meta) : null,
          variacao: ind.variacao != null ? Number(ind.variacao) : 0,
          historico,
          _setorCorIndex: corIndexFromSetor(ind.setor_nome)
        };
      })
      .filter(ind => ind.ativo)
      .filter(temAlgumPreenchimento);

    atualizarSelectSetoresComPreenchimento();
    preencherFiltrosAnoMes();
    aplicarFiltros();

  } catch (error) {
    console.error('Erro ao carregar dados consolidados:', error);
    alert('Erro ao carregar dados. Verifique a API ou sua conexão.');
  }
});

// ====== Renderização de Cards ======
function renderizarIndicadores(dados) {
  const container = document.getElementById('indicadores-container');
  container.innerHTML = '';

  // 🎨 50 cores fixas mapeadas
 const coresSetores = {
    1: "#4f46e5",  2: "#ec4899",  3: "#f59e0b",  4: "#06b6d4",  5: "#10b981",
    6: "#8b5cf6",  7: "#f43f5e",  8: "#0ea5e9",  9: "#84cc16", 10: "#6366f1",
   11: "#d946ef", 12: "#64748b", 13: "#0891b2", 14: "#22c55e", 15: "#3b82f6",
   16: "#ef4444", 17: "#a855f7", 18: "#14b8a6", 19: "#f97316", 20: "#0d9488",
   21: "#2563eb", 22: "#dc2626", 23: "#15803d", 24: "#7c3aed", 25: "#ca8a04",
   26: "#334155", 27: "#1d4ed8", 28: "#facc15", 29: "#65a30d", 30: "#c026d3",
   31: "#f87171", 32: "#3f6212", 33: "#0284c7", 34: "#9333ea", 35: "#fbbf24",
   36: "#166534", 37: "#9d174d", 38: "#0e7490", 39: "#92400e", 40: "#1e293b",
   41: "#fde047", 42: "#5b21b6", 43: "#ea580c", 44: "#15803d", 45: "#0369a1",
   46: "#f43f5e", 47: "#047857", 48: "#7f1d1d", 49: "#4338ca", 50: "#d97706"
  };

  dados.forEach(indicador => {
    const card = document.createElement('div');
    card.className = `indicador-card bg-white rounded-lg shadow-md overflow-hidden relative`;
    card.dataset.id = indicador.id;

    // Status
    const atingido = indicador.atingido;
    let statusClass = 'bg-red-500';
    let statusText = 'Meta não atingida';
    let statusIcon = '❌';

    if (indicador.tipo_meta === 'monitoramento') {
      statusClass = 'bg-blue-500';
      statusIcon = '📊';
      statusText = 'Monitoramento';
    } else if (atingido) {
      statusClass = 'bg-green-500';
      statusIcon = '✅';
      statusText = 'Meta atingida';
    }
    const statusBar = `<div class="trend-bar ${statusClass}"></div>`;

    // Cor estável por nome do setor
    const corSetor = coresSetores[indicador.setor] || "#64748b";

    // Variação
    let variacaoIcon = '';
    let variacaoClass = '';
    let variacaoText = '';
    if (indicador.tipo_meta === 'crescente') {
      variacaoIcon = indicador.variacao >= 0 ? '↑' : '↓';
      variacaoClass = indicador.variacao >= 0 ? 'text-green-500' : 'text-red-500';
      variacaoText = `<span class="tooltip ${variacaoClass} font-semibold">${indicador.variacao >= 0 ? '+' : ''}${indicador.variacao}% ${variacaoIcon}<span class="tooltiptext">Comparado ao mês anterior</span></span>`;
    } else if (indicador.tipo_meta === 'decrescente') {
      variacaoIcon = indicador.variacao > 0 ? '↑' : '↓';
      variacaoClass = indicador.variacao < 0 ? 'text-green-500' : 'text-red-500';
      variacaoText = `<span class="tooltip ${variacaoClass} font-semibold">${indicador.variacao > 0 ? '+' : ''}${indicador.variacao}% ${variacaoIcon}<span class="tooltiptext">Comparado ao mês anterior</span></span>`;
    }

    card.innerHTML = `
      ${statusBar}
      <div class="p-4">
        <div class="flex justify-between items-start mb-2">
          <h3 class="text-lg font-bold text-blue-800">${indicador.nome}</h3>
          ${variacaoText}
        </div>
        <div class="inline-block text-white text-xs px-2 py-1 rounded mb-3" style="background-color: ${corSetor}">${indicador.setor_nome}</div>
        <div class="flex items-center mb-2">
          <span class="mr-2">${statusIcon}</span>
          <span class="text-sm">${statusText}</span>
        </div>
        <div class="text-sm text-gray-600 mb-3">
          Atual: ${formatarValorComTipo(indicador.valor_atual, indicador.tipo_valor)} /
          Meta: ${formatarValorComTipo(indicador.valor_meta, indicador.tipo_valor)}
        </div>
        <div class="flex justify-end">
          <button class="btn-detalhes bg-amber-400 hover:bg-amber-500 text-amber-900 text-xs px-3 py-1 rounded transition-colors">
            Ver +
          </button>
        </div>
      </div>
    `;

    container.appendChild(card);

    card.querySelector('.btn-detalhes').addEventListener('click', (e) => {
      e.stopPropagation();
      mostrarDetalhes(indicador);
    });
    card.addEventListener('click', () => { mostrarDetalhes(indicador); });
  });
}

function renderComPaginacao(dadosFiltrados) {
  __LAST_RENDER_DATA = dadosFiltrados || [];

  const total = __LAST_RENDER_DATA.length;
  const totalPages = Math.max(1, Math.ceil(total / __PAGE_SIZE));
  __PAGE_INDEX = Math.min(Math.max(1, __PAGE_INDEX), totalPages); // clamp

  const start = (__PAGE_INDEX - 1) * __PAGE_SIZE;
  const end   = start + __PAGE_SIZE;

  const pageSlice = __LAST_RENDER_DATA.slice(start, end);

  // usa a função já existente que monta os cards
  renderizarIndicadores(pageSlice);

  // desenha os botões da paginação
  renderPaginacao(total, totalPages);
}

function renderPaginacao(total, totalPages) {
  const el = document.getElementById('paginacao');
  if (!el) return;

  // Esconde se só há 1 página
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const btn = (label, page, disabled=false, active=false) => `
    <button data-page="${page}"
      class="px-3 py-1 rounded border text-sm
             ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-50'}
             ${disabled ? 'opacity-50 cursor-not-allowed' : ''}">
      ${label}
    </button>
  `;

  const prevDisabled = __PAGE_INDEX <= 1;
  const nextDisabled = __PAGE_INDEX >= totalPages;

  // janela de páginas ao redor da atual
  const windowRadius = 2;
  const from = Math.max(1, __PAGE_INDEX - windowRadius);
  const to   = Math.min(totalPages, __PAGE_INDEX + windowRadius);

  let html = '';
  html += btn('«', __PAGE_INDEX - 1, prevDisabled, false);

  if (from > 1) {
    html += btn('1', 1, false, __PAGE_INDEX === 1) + '<span class="px-1">…</span>';
  }

  for (let p = from; p <= to; p++) {
    html += btn(String(p), p, false, p === __PAGE_INDEX);
  }

  if (to < totalPages) {
    html += '<span class="px-1">…</span>' + btn(String(totalPages), totalPages, false, __PAGE_INDEX === totalPages);
  }

  html += btn('»', __PAGE_INDEX + 1, nextDisabled, false);

  el.innerHTML = html;

  // eventos
  [...el.querySelectorAll('button[data-page]')].forEach(b => {
    const page = Number(b.dataset.page);
    b.addEventListener('click', () => {
      if (Number.isNaN(page)) return;
      __PAGE_INDEX = Math.min(Math.max(1, page), totalPages);
      renderComPaginacao(__LAST_RENDER_DATA);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ====== Modal Detalhes ======
function mostrarDetalhes(indicador) {
  const modal = document.getElementById('detalhe-modal');
  const modalContent = document.getElementById('modal-content');

  modalContent.innerHTML = `
    <div class="w-full bg-white rounded p-4 mb-6 border shadow">
      <button id="fechar-modal" class="absolute top-4 right-4 text-white hover:text-gray-700 text-xl font-bold focus:outline-none">✕</button>
      <h2 id="titulo-indicador" class="text-2xl font-bold text-blue-800 mb-2">Nome do Indicador</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-700">
        <p><strong>Tipo de Meta:</strong> <span id="tipo-meta-indicador"></span></p>
        <p><strong>Setor:</strong> <span id="setor-indicador"></span></p>
        <p><strong>Meta Esperada:</strong> <span id="meta-indicador"></span></p>
        <p><strong>Responsável:</strong> <span id="responsavel-indicador"></span></p>
        <p><strong>Último Preenchimento:</strong> <span id="ultimo-preenchimento-indicador"></span></p>
      </div>
      <div class="mt-4 flex gap-2">
        <button id="exportar-excel" class="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700">Exportar Excel</button>
        <button id="exportar-pdf" class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Exportar PDF</button>
      </div>
    </div>

    <div class="w-full bg-white rounded p-4 mb-6 border shadow">
      <div class="flex flex-col sm:flex-row sm:items-end gap-4">
        <div>
          <label for="filtro-inicio" class="block text-sm font-medium text-gray-700 mb-1">Início:</label>
          <input type="month" id="filtro-inicio" class="border px-3 py-2 rounded w-40">
        </div>
        <div>
          <label for="filtro-fim" class="block text-sm font-medium text-gray-700 mb-1">Fim:</label>
          <input type="month" id="filtro-fim" class="border px-3 py-2 rounded w-40">
        </div>
        <button id="btn-aplicar-filtro-periodo" class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-800">Aplicar Filtro</button>
      </div>
    </div>

    <div id="historico-container" class="w-full bg-white rounded p-4 mb-6 border shadow overflow-auto max-h-[300px]">
      <h3 class="text-lg font-semibold mb-3">Histórico de Preenchimentos</h3>
      <table class="w-full text-sm text-left border">
        <thead class="bg-gray-100 text-gray-700">
          <tr>
            <th class="px-4 py-2 border">Data</th>
            <th class="px-4 py-2 border">Valor</th>
            <th class="px-4 py-2 border">Meta</th>
            <th class="px-4 py-2 border">Status</th>
            <th class="px-4 py-2 border">Comentários</th>
            <th class="px-4 py-2 border">Provas</th>
          </tr>
        </thead>
        <tbody id="corpo-historico-modal"></tbody>
      </table>
    </div>

    <div class="w-full bg-white rounded p-4 border shadow">
      <h3 class="text-lg font-semibold mb-3">Gráfico de Desempenho</h3>
      <div class="w-full max-w-4xl mx-auto overflow-x-auto">
        <div class="w-full h-[300px] md:h-[350px] lg:h-[400px]">
          <canvas id="grafico-desempenho" class="w-full h-full"></canvas>
        </div>
      </div>
    </div>
  `;

  // Topo do modal
  document.getElementById('titulo-indicador').textContent = indicador.nome;
  document.getElementById('tipo-meta-indicador').textContent = indicador.tipo_meta;
  document.getElementById('setor-indicador').textContent = indicador.setor_nome;
  document.getElementById('meta-indicador').textContent = formatarValorComTipo(indicador.valor_meta, indicador.tipo_valor);
  document.getElementById('responsavel-indicador').textContent = indicador.responsavel || '—';
  document.getElementById('ultimo-preenchimento-indicador').textContent =
    indicador.ultimaAtualizacao ? new Date(indicador.ultimaAtualizacao).toLocaleDateString('pt-BR') : 'Sem dados';

  // Histórico (tabela) — usa competência (MM/AAAA)
  const corpoTabela = document.getElementById('corpo-historico-modal');
  corpoTabela.innerHTML = '';
  (indicador.historico || [])
    .sort((a, b) => dataReferencia(a) - dataReferencia(b))
    .forEach(item => {
      const chave = chaveAnoMes(item); // YYYY-MM
      const metaMensal = indicador.metas_mensais?.find(m => m.mes.startsWith(chave));
      const metaFinal = metaMensal ? Number(metaMensal.valor_meta) : Number(item.meta);

      const atingido = verificarAtingimento(indicador.tipo_meta, Number(item.valor), metaFinal);
      const statusTexto = atingido ? '✅ Atingida'
        : (indicador.tipo_meta === 'monitoramento' ? '📊 Monitoramento' : '❌ Não Atingida');

      const d = dataReferencia(item);
      const ano = d.getUTCFullYear();
      const mes = String(d.getUTCMonth() + 1).padStart(2, '0');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-2 border">${labelMesAno(item)}</td>
        <td class="px-4 py-2 border">
          <span id="valor-realizado-${indicador.id}-${ano}-${mes}">
            ${formatarValorComTipo(item.valor, indicador.tipo_valor)}
          </span>
          <button class="text-blue-600 text-xs px-2 py-1 rounded hover:text-blue-800"
            onclick="abrirModalEdicaoIndividual(${item.id}, ${Number(item.valor)})">
            <i class="fas fa-edit"></i>
          </button>
        </td>
        <td class="px-4 py-2 border">
          ${formatarValorComTipo(metaFinal, indicador.tipo_valor)}
          <button class="text-blue-600 text-xs px-2 py-1 rounded hover:text-blue-800"
            onclick="abrirModalEditarMeta(${indicador.id}, '${chave}', ${metaFinal})">
            <i class="fas fa-edit"></i>
          </button>
        </td>
        <td class="px-4 py-2 border">${statusTexto}</td>
        <td class="px-4 py-2 border text-center">
          <button class="text-blue-600 underline text-sm hover:text-blue-800" onclick="abrirComentarioPopup('${item.comentario?.replace(/'/g, "\\'") || ''}')">Ver</button>
        </td>
        <td class="px-4 py-2 border text-center">
          ${item.provas?.length > 0
            ? `<button class="text-blue-600 underline text-sm hover:text-blue-800" onclick="abrirProvasPopup('${item.provas[0]}')">Abrir</button>`
            : '-'}
        </td>
      `;
      corpoTabela.appendChild(tr);
    });

  // Fechar modal
  const btnFechar = document.getElementById('fechar-modal');
  if (btnFechar) btnFechar.addEventListener('click', () => modal.classList.add('hidden'));

  // Filtro de histórico inicial + gráfico
  aplicarFiltroHistorico(indicador, "", "");

  // Exportar Excel (usa competência)
  document.getElementById('exportar-excel').addEventListener('click', () => {
    const dados = (indicador.historico || []).map(item => ({
      Data: labelMesAno(item),
      "Valor Realizado": Number(item.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      "Meta": Number(item.meta).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      "Status": verificarAtingimento(indicador.tipo_meta, item.valor, item.meta) ? "✅ Atingida" : "❌ Não Atingida",
      "Comentário": item.comentario || "-",
      "Provas": item.provas?.length > 0 ? item.provas[0] : "-"
    }));

    const worksheet = XLSX.utils.json_to_sheet(dados);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Histórico");
    XLSX.writeFile(workbook, `${indicador.nome}_historico.xlsx`);
  });

  // Exportar PDF
  document.getElementById('exportar-pdf').addEventListener('click', () => {
    const elemento = document.getElementById('modal-content');
    const historicoContainer = document.getElementById('historico-container');

    const originalMaxHeight = historicoContainer.style.maxHeight;
    const originalOverflow = historicoContainer.style.overflow;
    historicoContainer.style.maxHeight = 'none';
    historicoContainer.style.overflow = 'visible';

    const options = {
      margin: 0,
      filename: `${indicador.nome}_detalhes.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 3 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().from(elemento).set(options).save().then(() => {
      historicoContainer.style.maxHeight = originalMaxHeight;
      historicoContainer.style.overflow = originalOverflow;
    });
  });

  // Aplicar filtro período
  document.getElementById('btn-aplicar-filtro-periodo').addEventListener('click', () => {
    const dataInicio = document.getElementById('filtro-inicio').value;
    const dataFim = document.getElementById('filtro-fim').value;
    aplicarFiltroHistorico(indicador, dataInicio, dataFim);
  });

  // Mostrar modal
  modal.classList.remove('hidden');
}

// ====== Meta mensal (modal de edição única) ======
function abrirModalEditarMeta(indicadorId, mesAno, metaAtual) {
  const modal = document.getElementById('editar-meta-unica-modal');
  document.getElementById('input-meta-unica').value = metaAtual;
  modal.dataset.indicadorId = indicadorId;
  modal.dataset.mesAno = mesAno;
  modal.classList.remove('hidden');
}

// ====== Wiring de eventos de página ======
document.addEventListener('DOMContentLoaded', () => {
  if (typeof carregarUsuarioLogado === 'function') {
    carregarUsuarioLogado(); // se existir no projeto
  }

  // Filtros
  const filtroSetor = document.getElementById('filter-setor');
  const filtroAno = document.getElementById('filter-ano');
  const filtroMes = document.getElementById('filter-mes');
  const filtroStatus = document.getElementById('filter-status');
  const limparFiltros = document.getElementById('limpar-filtros');

  if (filtroSetor) filtroSetor.addEventListener('change', aplicarFiltros);
  if (filtroAno) {
    filtroAno.addEventListener('change', () => {
      popularMesesDoAnoSelecionado(filtroAno.value);
      aplicarFiltros();
    });
  }
  if (filtroMes) filtroMes.addEventListener('change', aplicarFiltros);
  if (filtroStatus) filtroStatus.addEventListener('change', aplicarFiltros);

  if (limparFiltros) {
    limparFiltros.addEventListener('click', () => {
      filtroSetor.value = 'todos';
      filtroAno.value = 'todos';
      popularMesesDoAnoSelecionado('todos');
      filtroMes.value = 'mes-atual';
      filtroStatus.value = 'todos';
      __PAGE_INDEX = 1;
      aplicarFiltros();
    });
  }

  // Modal editar valor realizado (gestor-style)
  const cancelarEdicaoUnico = document.getElementById('cancelar-edicao-unico');
  if (cancelarEdicaoUnico) {
    cancelarEdicaoUnico.addEventListener('click', () => {
      document.getElementById('editar-valor-unico-modal').classList.add('hidden');
    });
  }
  const salvarValorUnicoBtn = document.getElementById('salvar-valor-unico');
  if (salvarValorUnicoBtn) salvarValorUnicoBtn.addEventListener('click', salvarValorUnico);

  // Fechar modal de detalhes ao clicar fora
  const detalheModal = document.getElementById('detalhe-modal');
  if (detalheModal) {
    detalheModal.addEventListener('click', (e) => {
      if (e.target === detalheModal) detalheModal.classList.add('hidden');
    });
  }

  // Modal meta única
  const editarMetaUnicaModal = document.getElementById('editar-meta-unica-modal');
  const cancelarMetaUnica = document.getElementById('cancelar-meta-unica');
  const salvarMetaUnica = document.getElementById('salvar-meta-unica');

  if (cancelarMetaUnica) {
    cancelarMetaUnica.addEventListener('click', () => {
      editarMetaUnicaModal.classList.add('hidden');
    });
  }

  if (salvarMetaUnica) {
    salvarMetaUnica.addEventListener('click', () => {
      const indicadorId = editarMetaUnicaModal.dataset.indicadorId;
      const mesAno = editarMetaUnicaModal.dataset.mesAno;
      const novaMeta = document.getElementById('input-meta-unica').value;

      if (isNaN(parseFloat(novaMeta))) {
        alert("Por favor, insira um valor numérico válido.");
        return;
      }

      fetch(`${apiBase}/metas-mensais/?indicador=${indicadorId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(metas => {
          const lista = asList(metas);
          const metaExistente = lista.find(m => (m.mes || '').startsWith(mesAno));
          const payload = { valor_meta: Number(novaMeta) };

          let url = `${apiBase}/metas-mensais/`;
          let method = 'POST';

          if (metaExistente) {
            url = `${apiBase}/metas-mensais/${metaExistente.id}/`;
            method = 'PATCH';
          } else {
            payload.indicador = parseInt(indicadorId);
            payload.mes = `${mesAno}-01`;
          }

          return fetch(url, {
            method,
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
        })
        .then(res => {
          if (res.ok) {
            alert("Meta atualizada com sucesso!");
            editarMetaUnicaModal.classList.add('hidden');
            location.reload();
          } else {
            alert("Erro ao salvar a meta. Verifique os dados e tente novamente.");
          }
        })
        .catch(err => {
          console.error("Erro na requisição:", err);
          alert("Erro na conexão ou no servidor. Tente novamente.");
        });
    });
  }
});

// ====== Filtros (Ano/Mês) ======
function preencherFiltrosAnoMes() {
  const selectAno = document.getElementById('filter-ano');
  const selectMes = document.getElementById('filter-mes');
  if (!selectAno || !selectMes) return;

  selectAno.innerHTML = `<option value="todos">Todos os Anos</option>`;
  periodosDisponiveis = {};

  indicadoresComValoresGlobais.forEach(indicador => {
    (indicador.historico || []).forEach(item => {
      const year = String(item.ano ?? new Date(item.data).getFullYear());
      const month = String(item.mes ?? (new Date(item.data).getMonth() + 1)).padStart(2, '0');
      if (!periodosDisponiveis[year]) periodosDisponiveis[year] = new Set();
      periodosDisponiveis[year].add(month);
    });
  });

  Object.keys(periodosDisponiveis)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .forEach(year => {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = year;
      selectAno.appendChild(option);
    });

  popularMesesDoAnoSelecionado(selectAno.value);
}

function popularMesesDoAnoSelecionado(selectedYear) {
  const selectMes = document.getElementById('filter-mes');
  if (!selectMes) return;

  selectMes.innerHTML = `<option value="todos">Todos os Meses</option>`;
  if (selectedYear === 'todos') {
    selectMes.innerHTML += `<option value="mes-atual">Mês Atual</option>`;
  }

  let mesesParaAdicionar = new Set();
  if (selectedYear === 'todos') {
    Object.values(periodosDisponiveis).forEach(mesesSet => {
      mesesSet.forEach(mes => mesesParaAdicionar.add(mes));
    });
  } else if (periodosDisponiveis[selectedYear]) {
    periodosDisponiveis[selectedYear].forEach(mes => mesesParaAdicionar.add(mes));
  }

  Array.from(mesesParaAdicionar)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .forEach(month => {
      const monthName = new Date(2000, parseInt(month) - 1, 1).toLocaleString('pt-BR', { month: 'long' });
      const option = document.createElement('option');
      option.value = month;
      option.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
      selectMes.appendChild(option);
    });
}

// ====== Aplicar filtro no histórico do modal ======
function aplicarFiltroHistorico(indicador, dataInicio = "", dataFim = "") {
  const corpoTabela = document.getElementById('corpo-historico-modal');
  const canvas = document.getElementById('grafico-desempenho');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  corpoTabela.innerHTML = '';

  const inicio = dataInicio ? new Date(Date.UTC(+dataInicio.split("-")[0], +dataInicio.split("-")[1] - 1, 1)) : null;
  const fim    = dataFim    ? new Date(Date.UTC(+dataFim.split("-")[0],    +dataFim.split("-")[1] - 1,    1)) : null;

  const historicoFiltrado = (indicador.historico || [])
    .filter(item => {
      const dRef = dataReferencia(item);
      if (!dRef) return false;
      if (inicio && dRef < inicio) return false;
      if (fim && dRef > fim) return false;
      return true;
    })
    .sort((a, b) => dataReferencia(a) - dataReferencia(b));

  historicoFiltrado.forEach(item => {
    const chave = chaveAnoMes(item);
    const metaMensal = indicador.metas_mensais?.find(m => m.mes.startsWith(chave));
    const metaFinal = metaMensal ? Number(metaMensal.valor_meta) : Number(item.meta);

    const atingido = verificarAtingimento(indicador.tipo_meta, Number(item.valor), metaFinal);
    const statusTexto = atingido ? '✅ Atingida' :
      (indicador.tipo_meta === 'monitoramento' ? '📊 Monitoramento' : '❌ Não Atingida');

    const d = dataReferencia(item);
    const ano = d.getUTCFullYear();
    const mes = String(d.getUTCMonth() + 1).padStart(2, '0');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 border">${labelMesAno(item)}</td>
      <td class="px-4 py-2 border">
        <span id="valor-realizado-${indicador.id}-${ano}-${mes}">
          ${formatarValorComTipo(item.valor, indicador.tipo_valor)}
        </span>
        <button class="text-blue-600 text-xs px-2 py-1 rounded hover:text-blue-800"
          onclick="abrirModalEdicaoIndividual(${item.id}, ${Number(item.valor)})">
          <i class="fas fa-edit"></i>
        </button>
      </td>
      <td class="px-4 py-2 border">
        ${formatarValorComTipo(metaFinal, indicador.tipo_valor)}
        <button class="text-blue-600 text-xs px-2 py-1 rounded hover:text-blue-800"
          onclick="abrirModalEditarMeta(${indicador.id}, '${chave}', ${metaFinal})">
          <i class="fas fa-edit"></i>
        </button>
      </td>
      <td class="px-4 py-2 border">${statusTexto}</td>
      <td class="px-4 py-2 border text-center">
        <button class="text-blue-600 underline text-sm hover:text-blue-800"
          onclick="abrirComentarioPopup('${item.comentario?.replace(/'/g, "\\'") || ''}')">
          Ver
        </button>
      </td>
      <td class="px-4 py-2 border text-center">
        ${item.provas?.length > 0
          ? `<button class="text-blue-600 underline text-sm hover:text-blue-800" onclick="abrirProvasPopup('${item.provas[0]}')">Abrir</button>`
          : '-'}
      </td>
    `;
    corpoTabela.appendChild(tr);
  });

  if (window.graficoDesempenho) window.graficoDesempenho.destroy();

  window.graficoDesempenho = new Chart(ctx, {
    type: 'line',
    data: {
      labels: historicoFiltrado.map(item => labelMesAno(item)),
      datasets: [
        {
          label: 'Valor',
          data: historicoFiltrado.map(item => Number(item.valor)),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.3,
          fill: true
        },
        {
          label: 'Meta',
          data: historicoFiltrado.map(item => {
            const chave = chaveAnoMes(item);
            const metaMensal = indicador.metas_mensais?.find(m => m.mes.startsWith(chave));
            return metaMensal ? Number(metaMensal.valor_meta) : Number(item.meta);
          }),
          borderColor: '#ef4444',
          borderDash: [5, 5],
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: false } }
    }
  });
}

// ====== Aplicar Filtros nos Cards ======
function aplicarFiltros() {
  const setorSelecionado = document.getElementById('filter-setor')?.value || 'todos';
  const statusSelecionado = document.getElementById('filter-status')?.value || 'todos';
  const anoSelecionado = document.getElementById('filter-ano')?.value || 'todos';
  const mesSelecionado = document.getElementById('filter-mes')?.value || 'mes-atual';

  let dadosFiltradosTemporarios = [...indicadoresComValoresGlobais];

  // 1) Setor
if (setorSelecionado !== 'todos') {
  const alvo = normalizarTexto(setorSelecionado);
  dadosFiltradosTemporarios = dadosFiltradosTemporarios.filter(ind => {
    const nomeNorm = normalizarTexto(ind.setor_nome);
    return nomeNorm.includes(alvo);
  });
}

  // 2) Ano/Mês
  let indicadoresParaRenderizar = [];
  dadosFiltradosTemporarios.forEach(indicadorOriginal => {
    let valorNoPeriodo = null;
    let metaNoPeriodo = indicadorOriginal.valor_meta != null ? Number(indicadorOriginal.valor_meta) : null;
    let ultimaAtualizacaoNoPeriodo = null;
    let comentariosNoPeriodo = indicadorOriginal.comentarios;
    let provasNoPeriodo = indicadorOriginal.provas;
    let responsavelNoPeriodo = indicadorOriginal.responsavel;
    let variacaoNoPeriodo = Number(indicadorOriginal.variacao || 0);

    const { ano: anoAtual, mes: mesAtual } = competenciaAtual();

    if (mesSelecionado === 'mes-atual') {
      // Apenas indicadores com preenchimento no mês atual
      const itemAtual = (indicadorOriginal.historico || []).find(h =>
        Number(h.ano) === anoAtual && Number(h.mes) === mesAtual &&
        h.valor != null && !Number.isNaN(Number(h.valor))
      );
      if (!itemAtual) return; // sem preenchimento → não renderiza

      valorNoPeriodo = Number(itemAtual.valor);
      metaNoPeriodo  = itemAtual.meta != null ? Number(itemAtual.meta) : null;
      ultimaAtualizacaoNoPeriodo = new Date(Date.UTC(anoAtual, mesAtual - 1, 1)).toISOString();
      comentariosNoPeriodo = itemAtual.comentario;
      provasNoPeriodo = itemAtual.provas;

      if (metaNoPeriodo && metaNoPeriodo !== 0) {
        variacaoNoPeriodo = ((valorNoPeriodo - metaNoPeriodo) / metaNoPeriodo) * 100;
      } else {
        variacaoNoPeriodo = 0;
      }
    } else if (anoSelecionado === 'todos' && mesSelecionado === 'todos') {
      // mostra o último valor disponível
      valorNoPeriodo = indicadorOriginal.valor_atual;
      metaNoPeriodo  = indicadorOriginal.valor_meta != null ? Number(indicadorOriginal.valor_meta) : null;
      ultimaAtualizacaoNoPeriodo = indicadorOriginal.ultimaAtualizacao;
      comentariosNoPeriodo = indicadorOriginal.comentarios;
      provasNoPeriodo = indicadorOriginal.provas;
      responsavelNoPeriodo = indicadorOriginal.responsavel;
      variacaoNoPeriodo = Number(indicadorOriginal.variacao || 0);

      // Se não tem nenhum valor atual (e já filtramos por ter histórico), seguimos renderizando
    } else {
      const preenchimentoDoPeriodo = (indicadorOriginal.historico || [])
        .filter(item => {
          const itemYear  = String(item.ano ?? new Date(item.data).getFullYear());
          const itemMonth = String(item.mes ?? (new Date(item.data).getMonth() + 1)).padStart(2, '0');
          const matchesYear  = anoSelecionado === 'todos' || itemYear === anoSelecionado;
          const matchesMonth = mesSelecionado === 'todos' || itemMonth === mesSelecionado;
          return matchesYear && matchesMonth;
        })
        .sort((a, b) => dataReferencia(b) - dataReferencia(a))
        .at(0);

      if (preenchimentoDoPeriodo) {
        valorNoPeriodo = Number(preenchimentoDoPeriodo.valor);
        metaNoPeriodo  = Number(preenchimentoDoPeriodo.meta);
        ultimaAtualizacaoNoPeriodo = new Date(Date.UTC(
          preenchimentoDoPeriodo.ano ?? new Date(preenchimentoDoPeriodo.data).getFullYear(),
          (preenchimentoDoPeriodo.mes ?? (new Date(preenchimentoDoPeriodo.data).getMonth() + 1)) - 1,
          1
        )).toISOString();
        comentariosNoPeriodo = preenchimentoDoPeriodo.comentario;
        provasNoPeriodo = preenchimentoDoPeriodo.provas;

        variacaoNoPeriodo = (metaNoPeriodo && metaNoPeriodo !== 0)
          ? ((valorNoPeriodo - metaNoPeriodo) / metaNoPeriodo) * 100
          : 0;
      } else {
        return; // sem dados nesse período → não renderiza
      }
    }

    const indicadorPeriodo = {
      ...indicadorOriginal,
      valor_atual: valorNoPeriodo,
      atingido: verificarAtingimento(
        indicadorOriginal.tipo_meta,
        valorNoPeriodo != null ? Number(valorNoPeriodo) : null,
        metaNoPeriodo != null ? Number(metaNoPeriodo) : null
      ),
      variacao: Number((variacaoNoPeriodo || 0).toFixed(2)),
      valor_meta: metaNoPeriodo != null ? Number(metaNoPeriodo) : null,
      ultimaAtualizacao: ultimaAtualizacaoNoPeriodo,
      comentarios: comentariosNoPeriodo,
      provas: provasNoPeriodo,
      responsavel: responsavelNoPeriodo
    };
    indicadoresParaRenderizar.push(indicadorPeriodo);
  });

  // 3) Status
  if (statusSelecionado !== 'todos') {
    indicadoresParaRenderizar = indicadoresParaRenderizar.filter(ind => {
      if (statusSelecionado === 'atingidos') return ind.atingido === true;
      if (statusSelecionado === 'nao-atingidos') return ind.atingido === false;
      return true;
    });
  }

  renderComPaginacao(indicadoresParaRenderizar);
}

// ====== Select Setores ======
function preencherSelectSetores() {
  const select = document.getElementById("filter-setor");
  if (!select) return;

  fetch(`${apiBase}/setores/`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(res => {
      if (!res.ok) throw new Error("Erro ao carregar setores.");
      return res.json();
    })
    .then(data => {
      const setores = data.results || data;
      select.innerHTML = '<option value="todos">Todos os Setores</option>';
      setores.forEach(setor => {
        const opt = document.createElement("option");
        opt.value = setor.nome.toLowerCase().replace(/\s+/g, '-'); // "Produtos Green" → "produtos-green"
        opt.textContent = setor.nome;
        select.appendChild(opt);
      });
    })
    .catch(err => {
      console.error("Erro ao preencher setores:", err);
    });
}

function atualizarSelectSetoresComPreenchimento() {
  const select = document.getElementById("filter-setor");
  if (!select) return;

  // indicadores que têm pelo menos 1 valor preenchido (histórico ou valor_atual)
  const temValor = (ind) => {
    if (ind && ind.valor_atual != null && !Number.isNaN(Number(ind.valor_atual))) return true;
    if (Array.isArray(ind?.historico)) {
      return ind.historico.some(h => h && h.valor != null && !Number.isNaN(Number(h.valor)));
    }
    return false;
  };

  const base = (indicadoresComValoresGlobais || []).filter(temValor);

  // mapa ID->Nome e lista única de IDs (caso você use ID no value); aqui o value segue o padrão por NOME "slug"
  const mapaNome = {}; // slug -> Nome
  const slugs = new Set();

  for (const i of base) {
    const nome = i.setor_nome || '';
    const slug = nome.toLowerCase().replace(/\s+/g, '-'); // "Produtos Green" -> "produtos-green"
    mapaNome[slug] = nome;
    slugs.add(slug);
  }

  // Renderiza apenas setores com preenchimento
  select.innerHTML = '<option value="todos">Todos os Setores</option>' +
    [...slugs]
      .sort((a, b) => (mapaNome[a] || '').localeCompare(mapaNome[b] || ''))
      .map(slug => `<option value="${slug}">${mapaNome[slug]}</option>`)
      .join('');
}

// ====== Editar Valor Realizado (modal) ======
function abrirModalEdicaoIndividual(idPreenchimento, valorAtual) {
  const modal = document.getElementById('editar-valor-unico-modal');
  const input = document.getElementById('campo-novo-valor');
  input.value = valorAtual;
  input.dataset.preenchimentoId = idPreenchimento;
  modal.classList.remove('hidden');
}

async function salvarValorUnico() {
  const input = document.getElementById('campo-novo-valor');
  const idPreenchimento = input.dataset.preenchimentoId;
  const novoValor = parseFloat(input.value);

  if (isNaN(novoValor)) {
    alert("Valor inválido.");
    return;
  }

  try {
    const response = await fetch(`${apiBase}/preenchimentos/${idPreenchimento}/`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ valor_realizado: novoValor })
    });

    if (!response.ok) throw new Error(`Erro na API: ${response.statusText}`);

    alert("Valor atualizado com sucesso.");
    document.getElementById('editar-valor-unico-modal').classList.add('hidden');
    location.reload();
  } catch (err) {
    console.error("Erro ao atualizar o valor:", err);
    alert("Erro ao atualizar o valor. Verifique o console.");
  }
}

// ====== Popups ======
function abrirComentarioPopup(texto) {
  document.getElementById('conteudo-comentario').textContent = texto || 'Nenhum comentário disponível.';
  document.getElementById('popup-comentario').classList.remove('hidden');
}
function fecharPopupComentario() {
  document.getElementById('popup-comentario').classList.add('hidden');
}
function abrirProvasPopup(url) {
  const link = document.getElementById('link-prova');
  link.href = url;
  document.getElementById('popup-provas').classList.remove('hidden');
}
function fecharPopupProvas() {
  document.getElementById('popup-provas').classList.add('hidden');
}
