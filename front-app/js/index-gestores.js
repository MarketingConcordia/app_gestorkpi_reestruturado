// Token JWT (mantemos leve no localStorage)
const token = localStorage.getItem('access');

// Base única /api (não duplica se API_BASE_URL já tiver /api)
const __BASE = String(window.API_BASE_URL || "").replace(/\/+$/, "");
const apiBase = __BASE.endsWith("/api") ? __BASE : `${__BASE}/api`;

// ====== Estado Global ======
let graficoDesempenho = null;
let indicadoresComValoresGlobais = []; // Indicadores processados
let periodosDisponiveis = {};          // { 'YYYY': Set('MM', ... ) }

let __PAGE_SIZE = 16;      // cards por página (ajuste: 8, 12, 24…)
let __PAGE_INDEX = 1;      // página atual (1-based)
let __LAST_RENDER_DATA = []; // último conjunto filtrado, para re-render

// Cache em memória (substitui localStorage para dados do usuário)
window.__perfilUsuario = null;
window.__setoresUsuarioNomes = [];  // ["Vendas", "RH", ...]
window.__setorUsuarioNome = null;   // Nome de um setor principal para permissões

// --------- Helpers ---------

function _norm(v) { return (v ?? '').toString().trim().toLowerCase(); }

// tenta ler o campo correto, considerando diferentes nomes que a API pode usar
function getIndicVisFlag(ind) {
  // tente todos os nomes comuns que o backend pode usar
  return (
    ind?.visibilidade ??                  // boolean | string ("todos", etc.)
    ind?.visualizacao ??                  // string/enum
    ind?.visivel_para_todos ??            // boolean
    ind?.visivel_para ??                  // string/enum
    ind?.publico ??                       // boolean
    ind?.permissoes?.visualizacao ??      // string/enum ("todos", "restrito", etc.)
    ind?.visualizacao_geral ??            // string/boolean alternativo
    ind?.view_for_all ??                  // fallback internacional
    null
  );
}

function isVisivelParaTodos(raw) {
  // se vier array/objeto, tente converter pra algo comparável
  if (Array.isArray(raw)) {
    const arr = raw.map(x => (x ?? '').toString().trim().toLowerCase());
    return arr.some(v =>
      ['todos','público','publico','all','geral','empresa','global','para_todos','para-todos'].includes(v)
    );
  }

  const v = _norm(raw);

  // booleanos e números comuns
  if (raw === true || raw === 1) return true;
  if (v === '1' || v === 'true') return true;

  // enums/strings mais comuns
  return (
    v === 'todos' || v === 'todo' || v === 'publico' || v === 'público' ||
    v === 'all' || v === 'geral' || v === 'empresa' || v === 'global' ||
    v === 'para_todos' || v === 'para-todos'
  );
}

function isDoGestorOuTodos(ind, nomesSetoresGestor) {
  if (isVisivelParaTodos(getIndicVisFlag(ind))) return true;

  const meusSetoresNorm = (nomesSetoresGestor || []).map(normalizarTexto);
  const setorDoIndicadorNorm = normalizarTexto(ind.setor_nome);

  return meusSetoresNorm.includes(setorDoIndicadorNorm);
}

function normalizarTexto(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // remove acentos (JS moderno)
    .replace(/\s+/g, "")            // remove espaços
    .replace(/-/g, "");             // remove hífens
}

function asList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

/* ==== 🔸 Helpers de periodicidade ==== */

// 1) normaliza periodicidade (1/2/3/6/12, ou strings tipo "bimestral" etc.)
function normalizarPeriodicidade(raw) {
  if (raw == null) return 1;
  if (typeof raw === 'number') return Math.max(1, parseInt(raw, 10) || 1);
  const s = String(raw).trim().toLowerCase();
  if (/^\d+$/.test(s)) return Math.max(1, parseInt(s, 10));
  if (s.includes('bimes')) return 2;
  if (s.includes('trimes')) return 3;
  if (s.includes('semes')) return 6;
  if (s.includes('anual')) return 12;
  return 1;
}

// 2) extrai mês-âncora (1..12) a partir de "YYYY-MM" | "YYYY-MM-DD" | número
function extrairMesInicial(ind) {
  const cands = [
    ind?.mes_inicial, ind?.mes_inicio, ind?.mes_referencia,
    ind?.mes_base, ind?.mes_inicial_referencia
  ];
  for (const c of cands) {
    if (c == null) continue;
    if (typeof c === 'number' && c >= 1 && c <= 12) return c;
    const s = String(c).trim();
    if (/^\d{4}-\d{2}$/.test(s))      return parseInt(s.split('-')[1], 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseInt(s.split('-')[1], 10);
  }
  return 1; // fallback: janeiro
}

// 3) extrai janela [mes_inicial..mes_final] como "YYYY-MM"
function extrairJanela(ind) {
  const toYM = (val) => {
    if (val == null) return null;
    const s = String(val).trim();
    if (/^\d{4}-\d{2}$/.test(s))      return s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
    return null;
  };
  return {
    inicioYM: toYM(ind?.mes_inicial),
    fimYM:    toYM(ind?.mes_final)
  };
}

// 4) checagens de janela/passo
function ymToInt(ym) { if (!ym) return null; const [y, m] = ym.split('-').map(Number); return y*100 + m; }
function inJanela(ano, mes, inicioYM, fimYM) {
  const cur = ano*100 + mes, i = ymToInt(inicioYM), f = ymToInt(fimYM);
  if (i != null && cur < i) return false;
  if (f != null && cur > f) return false;
  return true;
}
function mesPertenceAoCalendario(mes, mesInicial, passoMeses) {
  if (!Number.isFinite(mes) || !Number.isFinite(mesInicial) || !Number.isFinite(passoMeses)) return true;
  const diff = ((mes - mesInicial) % passoMeses + passoMeses) % passoMeses;
  return diff === 0;
}

// Atingimento
function verificarAtingimento(tipo, valor, meta) {
  if (!tipo || valor == null || meta == null) return false;
  if (tipo === 'crescente') return valor >= meta;
  if (tipo === 'decrescente') return valor <= meta;
  if (tipo === 'monitoramento') return Math.abs(valor - meta) <= 5;
  return false;
}

// Formatação
function formatarValorComTipo(valor, tipo) {
  if (valor == null) return "-";
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return "-";

  if (tipo === "monetario") {
    return `R$ ${numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (tipo === "percentual") {
    // 15 -> "15,00%" (assumindo que você armazena 15 = 15%)
    return `${numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  } else {
    return numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

if (!token) {
  window.location.href = 'login.html';
}

// --------- Boot ---------

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1) Busca dados do usuário logado (perfil e setores) — sem localStorage
    const resUser = await fetch(`${apiBase}/meu-usuario/`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resUser.ok) throw new Error('Falha ao obter usuário');

    const user = await resUser.json();
    window.__perfilUsuario = user.perfil;
    // vetor de nomes de setores para filtros/visibilidade
    window.__setoresUsuarioNomes = asList(user.setores).map(s => s.nome);
    // nome de um setor principal (se houver), usado para permissões de edição
    window.__setorUsuarioNome =
      (user.setor_principal && user.setor_principal.nome) ||
      window.__setoresUsuarioNomes[0] ||
      null;

    // Se a página é do GESTOR, exige perfil gestor
    if (window.__perfilUsuario !== "gestor") {
      alert("Acesso negado. Esta página é exclusiva para perfil gestor.");
      window.location.href = "login.html";
      return;
    }

    // 2) Preenche o select de setores (da API)
    preencherSelectSetores();

    // 3) Carrega dados necessários em paralelo
    const [indicadoresRes, preenchimentosRes, metasRes] = await Promise.all([
      fetch(`${apiBase}/indicadores/`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${apiBase}/preenchimentos/`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${apiBase}/metas-mensais/`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);

    if (!indicadoresRes.ok || !preenchimentosRes.ok || !metasRes.ok) {
      throw new Error('Falha ao carregar dados');
    }

    const indicadoresData = await indicadoresRes.json();
    const preenchimentosData = await preenchimentosRes.json();
    const metasMensaisData = await metasRes.json();

    const indicadoresBase = asList(indicadoresData);
    const preenchimentos = asList(preenchimentosData);
    const metasMensais = asList(metasMensaisData);

    // 4) Calcula os indicadores com histórico/último valor/meta mensal
    const indicadoresCalculados = indicadoresBase
      .map(indicador => {
        // 🔸 configurações de periodicidade
        const passo   = normalizarPeriodicidade(indicador.periodicidade);
        const mesAnc  = extrairMesInicial(indicador);         // 1..12
        const { inicioYM, fimYM } = extrairJanela(indicador); // "YYYY-MM" | null

        // 🔸 filtra por janela e passo
        const preenchimentosDoIndicador = preenchimentos
          .filter(p => p.indicador === indicador.id)
          .filter(p => inJanela(Number(p.ano), Number(p.mes), inicioYM, fimYM))
          .filter(p => mesPertenceAoCalendario(Number(p.mes), mesAnc, passo))
          .sort((a, b) => {
            if (a.ano !== b.ano) return a.ano - b.ano;
            return a.mes - b.mes;
          });

        const metasDoIndicador = metasMensais.filter(m => m.indicador === indicador.id);

        const porMes = new Map();
        preenchimentosDoIndicador.forEach(p => {
          const mesStr = `${p.ano}-${String(p.mes).padStart(2, '0')}`;
          const metaDoMes = metasDoIndicador.find(m => (m.mes || '').startsWith(mesStr));
          const metaValor = metaDoMes ? parseFloat(metaDoMes.valor_meta) : parseFloat(indicador.valor_meta);

          porMes.set(mesStr, {
            id: p.id,
            data: `${mesStr}-01`,
            valor: p.valor_realizado,
            meta: metaValor,
            comentario: p.comentario,
            provas: p.arquivo ? [p.arquivo] : []
          });
        });

        const historico = Array.from(porMes.values())
          .sort((a, b) => String(a.data).localeCompare(String(b.data)));

        // 🔸 "último" também já respeita periodicidade
        const ultimoPreenchimento = preenchimentosDoIndicador.at(-1);

        let valorAtual = null; // <-- era 0
        let valorMeta = parseFloat(indicador.valor_meta);
        let ultimaAtualizacao = null;
        let atingido = false;
        let variacao = 0;
        let comentarios = '';
        let provas = [];
        let responsavel = '—';

        if (ultimoPreenchimento) {
          const ano = ultimoPreenchimento.ano;
          const mes = String(ultimoPreenchimento.mes).padStart(2, '0');

          const metaMensal = metasDoIndicador.find(m => (m.mes || '').startsWith(`${ano}-${mes}`));
          valorMeta = metaMensal ? parseFloat(metaMensal.valor_meta) : parseFloat(indicador.valor_meta);

          valorAtual = parseFloat(ultimoPreenchimento.valor_realizado);
          ultimaAtualizacao = ultimoPreenchimento.data_preenchimento;
          atingido = verificarAtingimento(indicador.tipo_meta, valorAtual, valorMeta);

          if (valorMeta !== 0) {
            variacao = ((valorAtual - valorMeta) / valorMeta) * 100;
          }

          comentarios = ultimoPreenchimento.comentario || '';
          provas = ultimoPreenchimento.arquivo ? [ultimoPreenchimento.arquivo] : [];
          responsavel =
            ultimoPreenchimento?.preenchido_por?.first_name ||
            ultimoPreenchimento?.preenchido_por?.username ||
            'Desconhecido';
        }

        return {
          ...indicador,
          valor_atual: valorAtual,
          valor_meta: valorMeta,
          atingido: atingido,
          variacao: parseFloat(variacao.toFixed(2)),
          responsavel: responsavel,
          ultimaAtualizacao: ultimaAtualizacao,
          comentarios: comentarios,
          origem: ultimoPreenchimento?.origem || '',
          provas: provas,
          historico: historico,
          metas_mensais: metasDoIndicador
        };
      });

      // 4.x) só ativos
      const soAtivos = indicadoresCalculados.filter(ind => ind.ativo);

      // 4.x) entra se for do(s) setor(es) do gestor OU visível para todos
      const comVis = soAtivos.filter(ind => isDoGestorOuTodos(ind, window.__setoresUsuarioNomes));

      // 4.x) pelo menos 1 mês preenchido (valor em algum mês do histórico OU valor_atual válido)
      const comPreench = comVis.filter(ind => {
        const temAtual = ind?.valor_atual != null && !Number.isNaN(Number(ind.valor_atual));
        const temHistorico = Array.isArray(ind?.historico) &&
          ind.historico.some(h => h && h.valor != null && !Number.isNaN(Number(h.valor)));
        return temAtual || temHistorico;
      });

      // (opcional) logs de diagnóstico
      console.debug('[gestores] ativos:', soAtivos.length);
      console.debug('[gestores] visíveis (meus setores OU todos):', comVis.length);
      console.debug('[gestores] com algum preenchimento:', comPreench.length);
      console.debug('[gestores] exemplos (para todos):',
        comVis.filter(x => isVisivelParaTodos(getIndicVisFlag(x))).slice(0,5).map(x => ({
          id: x.id, nome: x.nome, vis: getIndicVisFlag(x), setor: x.setor_nome
        }))
      );

      indicadoresComValoresGlobais = comPreench;

      console.table(comVis.slice(0, 15).map(i => ({
        id: i.id,
        nome: i.nome,
        setor: i.setor_nome,
        visRaw: getIndicVisFlag(i),
        ehParaTodos: isVisivelParaTodos(getIndicVisFlag(i)),
        temValor: Array.isArray(i.historico) && i.historico.some(h => h?.valor != null && !Number.isNaN(Number(h.valor))),
      })));

    // 5) Popula filtros e renderiza
    atualizarSelectSetoresComPreenchimento();
    preencherFiltrosAnoMes();
    aplicarFiltros();

  } catch (error) {
    console.error('Erro ao carregar indicadores ou preenchimentos:', error);
    alert('Erro ao carregar dados. Verifique sua conexão ou faça login novamente.');
  }
});

// --------- Renderização de cards ---------

function renderizarIndicadores(dados) {
  const container = document.getElementById('indicadores-container');
  container.innerHTML = '';

  // 50 cores fixas mapeadas por ID de setor
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
    const corSetor = coresSetores[indicador.setor] || "#64748b";

    // Variação
    let variacaoIcon = '';
    let variacaoClass = '';
    let variacaoText = '';

    if (indicador.tipo_meta === 'crescente') {
      variacaoIcon = indicador.variacao >= 0 ? '↑' : '↓';
      variacaoClass = indicador.variacao >= 0 ? 'text-green-500' : 'text-red-500';
      variacaoText = `<span class="tooltip ${variacaoClass} font-semibold">${indicador.variacao >= 0 ? '+' : ''}${indicador.variacao}% ${variacaoIcon}<span class="tooltiptext">Comparado ao mês anterior ou meta do período</span></span>`;
    } else if (indicador.tipo_meta === 'decrescente') {
      variacaoIcon = indicador.variacao > 0 ? '↑' : '↓';
      variacaoClass = indicador.variacao < 0 ? 'text-green-500' : 'text-red-500';
      variacaoText = `<span class="tooltip ${variacaoClass} font-semibold">${indicador.variacao > 0 ? '+' : ''}${indicador.variacao}% ${variacaoIcon}<span class="tooltiptext">Comparado ao mês anterior ou meta do período</span></span>`;
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

    card.addEventListener('click', () => {
      mostrarDetalhes(indicador);
    });
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

// --------- Modal de detalhes ---------

function mostrarDetalhes(indicador) {
  const modal = document.getElementById('detalhe-modal');
  const modalContent = document.getElementById('modal-content');
  const setoresGestor = window.__setoresUsuarioNomes || [];
  const podeEditar = setoresGestor.some(
    nome => normalizarTexto(nome) === normalizarTexto(indicador.setor_nome)
  );

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
      <div class="flex gap-4 items-end">
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
            <th class="px-4 py-2 border">Competência</th>
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

  // Topo
  document.getElementById('titulo-indicador').textContent = indicador.nome;
  document.getElementById('tipo-meta-indicador').textContent = indicador.tipo_meta;
  document.getElementById('setor-indicador').textContent = indicador.setor_nome;
  document.getElementById('meta-indicador').textContent = formatarValorComTipo(indicador.valor_meta, indicador.tipo_valor);
  document.getElementById('responsavel-indicador').textContent = indicador.responsavel || '—';
  document.getElementById('ultimo-preenchimento-indicador').textContent = indicador.ultimaAtualizacao
    ? new Date(indicador.ultimaAtualizacao).toLocaleDateString('pt-BR') : 'Sem dados';

  // Tabela (competência MM/AAAA, sem usar Date)
  const corpoTabela = document.getElementById('corpo-historico-modal');
  corpoTabela.innerHTML = '';

  const porMesModal = new Map();
  (indicador.historico || [])
    .sort((a, b) => String(a.data).localeCompare(String(b.data)))
    .forEach(item => {
      const chaveMes = String(item.data).slice(0,7); // YYYY-MM
      porMesModal.set(chaveMes, item);               // último do mês prevalece
    });

  Array.from(porMesModal.values()).forEach(item => {
    const [ano, mes] = String(item.data).slice(0,7).split('-');
    const chave = `${ano}-${mes}`;

    const metaMensal = indicador.metas_mensais?.find(m => (m.mes || '').startsWith(chave));
    const metaFinal = metaMensal ? parseFloat(metaMensal.valor_meta) : parseFloat(item.meta);

    const atingido = verificarAtingimento(indicador.tipo_meta, parseFloat(item.valor), metaFinal);
    const statusTexto = atingido ? '✅ Atingida' :
      (indicador.tipo_meta === 'monitoramento' ? '📊 Monitoramento' : '❌ Não Atingida');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 border">${mes}/${ano}</td>
      <td class="px-4 py-2 border">${formatarValorComTipo(item.valor, indicador.tipo_valor)}</td>
      <td class="px-4 py-2 border">${formatarValorComTipo(metaFinal, indicador.tipo_valor)}</td>
      <td class="px-4 py-2 border">${statusTexto}</td>
      <td class="px-4 py-2 border text-center">
        <button class="text-blue-600 underline text-sm hover:text-blue-800"
                onclick="abrirComentarioPopup('${item.comentario?.replace(/'/g, "\\'") || ''}')">Ver</button>
      </td>
      <td class="px-4 py-2 border text-center">
        ${item.provas?.length > 0
          ? `<button class="text-blue-600 underline text-sm hover:text-blue-800" onclick="abrirProvasPopup('${item.provas[0]}')">Abrir</button>`
          : '-'}
      </td>
      ${podeEditar ? `
        <td class="px-4 py-2 border text-center">
          <button class="text-blue-600 underline text-sm hover:text-blue-800" onclick="abrirModalEdicaoIndividual(${item.id}, ${item.valor})">Editar Valor</button>
          <button class="text-blue-600 underline text-sm hover:text-blue-800" onclick="abrirModalEdicaoComentario(${item.id}, '${item.comentario?.replace(/'/g, "\\'") || ''}')">Editar Comentário</button>
          <button class="text-blue-600 underline text-sm hover:text-blue-800" onclick="abrirModalEdicaoProva(${item.id}, '${item.provas?.[0] || ''}')">Editar Prova</button>
        </td>
      ` : '' }
    `;
    corpoTabela.appendChild(tr);
  });

  // Fechar
  const btnFechar = document.getElementById('fechar-modal');
  if (btnFechar) {
    btnFechar.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  // Filtro histórico
  aplicarFiltroHistorico(indicador, "", "");

  // Último preenchimento (compatível com paginação)
  fetch(`${apiBase}/preenchimentos/?indicador=${indicador.id}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
    .then(res => res.json())
    .then(json => {
      const lista = asList(json);
      if (!lista.length) return;
      const ultimo = lista[lista.length - 1];
      const responsavel =
        ultimo?.preenchido_por?.first_name ||
        ultimo?.preenchido_por?.username || "—";
      const data =
        ultimo?.data_preenchimento
          ? new Date(ultimo.data_preenchimento).toLocaleDateString("pt-BR")
          : "—";
      document.getElementById("responsavel-indicador").textContent = responsavel;
      document.getElementById("ultimo-preenchimento-indicador").textContent = data;
    })
    .catch(error => console.error("Erro ao buscar último preenchimento:", error));

  modal.classList.remove("hidden");

  // Exportações (Competência MM/AAAA sem usar Date)
  document.getElementById('exportar-excel').addEventListener('click', () => {
    const dados = (indicador.historico || []).map(item => {
      const [a, m] = String(item.data).slice(0,7).split('-');
      return {
        "Competência": `${m}/${a}`,
        "Valor Realizado": parseFloat(item.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        "Meta": parseFloat(item.meta).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        "Status": verificarAtingimento(indicador.tipo_meta, item.valor, item.meta) ? "✅ Atingida" : "❌ Não Atingida",
        "Comentário": item.comentario || "-",
        "Provas": item.provas?.length > 0 ? item.provas[0] : "-"
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(dados);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Histórico");
    XLSX.writeFile(workbook, `${indicador.nome}_historico.xlsx`);
  });

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

  // Gráfico — rótulos também como MM/AAAA (sem Date)
  const canvas = document.getElementById('grafico-desempenho');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    if (window.graficoDesempenho) window.graficoDesempenho.destroy();

    const labels = (indicador.historico || []).map(item => {
      const [a, m] = String(item.data).slice(0,7).split('-');
      return `${m}/${a}`;
    });

    window.graficoDesempenho = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Valor',
            data: (indicador.historico || []).map(item => item.valor),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.3,
            fill: true
          },
          {
            label: 'Meta',
            data: (indicador.historico || []).map(item => parseFloat(item.meta)),
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

  document.getElementById('btn-aplicar-filtro-periodo').addEventListener('click', () => {
    const dataInicio = document.getElementById('filtro-inicio').value;
    const dataFim = document.getElementById('filtro-fim').value;
    aplicarFiltroHistorico(indicador, dataInicio, dataFim);
  });

  // Listeners dos modais auxiliares (se existirem na página)
  const btnCancComent = document.getElementById('cancelar-edicao-comentario');
  const btnSalvarComent = document.getElementById('salvar-comentario');
  const btnCancProva = document.getElementById('cancelar-edicao-prova');
  const btnSalvarProva = document.getElementById('salvar-prova');

  if (btnCancComent) btnCancComent.addEventListener('click', () => document.getElementById('editar-comentario-modal').classList.add('hidden'));
  if (btnSalvarComent) btnSalvarComent.addEventListener('click', salvarComentario);
  if (btnCancProva) btnCancProva.addEventListener('click', () => document.getElementById('editar-prova-modal').classList.add('hidden'));
  if (btnSalvarProva) btnSalvarProva.addEventListener('click', salvarProva);
}

// --------- Listeners gerais de UI ---------

document.addEventListener('DOMContentLoaded', () => {
  if (typeof carregarUsuarioLogado === 'function') {
    try { carregarUsuarioLogado(); } catch (e) { /* opcional */ }
  }

  const filtroSetor = document.getElementById('filter-setor');
  const filtroAno = document.getElementById('filter-ano');
  const filtroMes = document.getElementById('filter-mes');
  const filtroStatus = document.getElementById('filter-status');
  const limparFiltros = document.getElementById('limpar-filtros');

  if (filtroSetor) filtroSetor.addEventListener('change', aplicarFiltros);
  if (filtroAno) filtroAno.addEventListener('change', () => { popularMesesDoAnoSelecionado(filtroAno.value); aplicarFiltros(); });
  if (filtroMes) filtroMes.addEventListener('change', aplicarFiltros);
  if (filtroStatus) filtroStatus.addEventListener('change', aplicarFiltros);

  if (limparFiltros) {
    limparFiltros.addEventListener('click', () => {
      if (filtroSetor) filtroSetor.value = 'todos';
      if (filtroAno) filtroAno.value = 'todos';
      popularMesesDoAnoSelecionado('todos');
      if (filtroMes) filtroMes.value = 'todos';
      if (filtroStatus) filtroStatus.value = 'todos';
      __PAGE_INDEX = 1;
      aplicarFiltros();
    });
  }

  // Fechar modais clicando fora
  const detalheModal = document.getElementById('detalhe-modal');
  const editarValorUnicoModal = document.getElementById('editar-valor-unico-modal');
  const editarComentarioModal = document.getElementById('editar-comentario-modal');
  const editarProvaModal = document.getElementById('editar-prova-modal');

  if (detalheModal) detalheModal.addEventListener('click', (e) => { if (e.target === detalheModal) detalheModal.classList.add('hidden'); });
  if (editarValorUnicoModal) editarValorUnicoModal.addEventListener('click', (e) => { if (e.target === editarValorUnicoModal) editarValorUnicoModal.classList.add('hidden'); });
  if (editarComentarioModal) editarComentarioModal.addEventListener('click', (e) => { if (e.target === editarComentarioModal) editarComentarioModal.classList.add('hidden'); });
  if (editarProvaModal) editarProvaModal.addEventListener('click', (e) => { if (e.target === editarProvaModal) editarProvaModal.classList.add('hidden'); });

  const btnCancUnico = document.getElementById('cancelar-edicao-unico');
  const btnSalvarUnico = document.getElementById('salvar-valor-unico');
  if (btnCancUnico) btnCancUnico.addEventListener('click', () => document.getElementById('editar-valor-unico-modal').classList.add('hidden'));
  if (btnSalvarUnico) btnSalvarUnico.addEventListener('click', salvarValorUnico);
});

// --------- Filtros (ano/mês) ---------

function preencherFiltrosAnoMes() {
  const selectAno = document.getElementById('filter-ano');
  const selectMes = document.getElementById('filter-mes');
  if (!selectAno || !selectMes) return;

  selectAno.innerHTML = `<option value="todos">Todos os Anos</option>`;

  periodosDisponiveis = {};
  indicadoresComValoresGlobais.forEach(indicador => {
    (indicador.historico || []).forEach(item => {
      const [year, month] = String(item.data).slice(0,7).split('-'); // sem Date
      if (!periodosDisponiveis[year]) periodosDisponiveis[year] = new Set();
      periodosDisponiveis[year].add(month);
    });
  });

  const sortedYears = Object.keys(periodosDisponiveis).sort((a, b) => parseInt(a) - parseInt(b));
  sortedYears.forEach(year => {
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

  let mesesParaAdicionar = new Set();
  if (selectedYear === 'todos') {
    Object.values(periodosDisponiveis).forEach(mesesSet => mesesSet.forEach(mes => mesesParaAdicionar.add(mes)));
  } else if (periodosDisponiveis[selectedYear]) {
    periodosDisponiveis[selectedYear].forEach(mes => mesesParaAdicionar.add(mes));
  }

  const sortedMonths = Array.from(mesesParaAdicionar).sort((a, b) => parseInt(a) - parseInt(b));
  sortedMonths.forEach(month => {
    const monthName = new Date(2000, parseInt(month) - 1, 1).toLocaleString('pt-BR', { month: 'long' });
    const option = document.createElement('option');
    option.value = month;
    option.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    selectMes.appendChild(option);
  });
}

// --------- Aplicar filtro no histórico (modal) ---------

function aplicarFiltroHistorico(indicador, dataInicio = "", dataFim = "") {
  const corpoTabela = document.getElementById('corpo-historico-modal');
  const canvas = document.getElementById('grafico-desempenho');
  const setoresGestor = window.__setoresUsuarioNomes || [];
  const podeEditar = setoresGestor.some(
    nome => normalizarTexto(nome) === normalizarTexto(indicador.setor_nome)
  );

  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  corpoTabela.innerHTML = '';

  // Converte inputs YYYY-MM para inteiro YYYYMM (sem usar Date)
  const toYM = (ymStr) => {
    if (!ymStr) return null;
    const [y, m] = ymStr.split('-').map(Number);
    return y * 100 + m;
  };
  const iniYM = dataInicio ? toYM(dataInicio) : null;
  const fimYM = dataFim ? toYM(dataFim) : null;

  // 🔸 configurações de periodicidade do indicador
  const passo   = normalizarPeriodicidade(indicador.periodicidade);
  const mesAnc  = extrairMesInicial(indicador);
  const { inicioYM: indIniYM, fimYM: indFimYM } = extrairJanela(indicador);

  // 1) filtra por período + periodicidade
  const historicoFiltrado = (indicador.historico || []).filter(item => {
    const [y, m] = String(item.data).slice(0, 7).split('-').map(Number);
    const curr = y * 100 + m;

    // período escolhido pelo usuário
    if (iniYM && curr < iniYM) return false;
    if (fimYM && curr > fimYM) return false;

    // janela do indicador
    if (!inJanela(y, m, indIniYM, indFimYM)) return false;

    // passo (1,2,3,6,12) ancorado em mes_inicial
    if (!mesPertenceAoCalendario(m, mesAnc, passo)) return false;

    return true;
  });

  // 2) DEDUP por mês (YYYY-MM) — o último registro do mês prevalece
  const porMesFiltro = new Map();
  historicoFiltrado
    .sort((a, b) => String(a.data).localeCompare(String(b.data)))
    .forEach(item => {
      const chaveMes = String(item.data).slice(0, 7); // YYYY-MM
      porMesFiltro.set(chaveMes, item);               // sobrescreve, guardando o último do mês
    });

  // 3) Array final ordenado sem duplicatas por mês
  const hist = Array.from(porMesFiltro.values())
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));

  // 4) monta linhas da tabela
  hist.forEach(item => {
    const [ano, mes] = String(item.data).slice(0, 7).split('-');
    const chave = `${ano}-${mes}`;

    const metaMensal = indicador.metas_mensais?.find(m => (m.mes || '').startsWith(chave));
    const metaFinal = metaMensal ? parseFloat(metaMensal.valor_meta) : parseFloat(item.meta);

    const atingido = verificarAtingimento(indicador.tipo_meta, Number(item.valor), metaFinal);
    const statusTexto = atingido ? '✅ Atingida' :
      (indicador.tipo_meta === 'monitoramento' ? '📊 Monitoramento' : '❌ Não Atingida');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-4 py-2 border">${mes}/${ano}</td>

      <td class="px-4 py-2 border">
        ${formatarValorComTipo(item.valor, indicador.tipo_valor)}
        ${podeEditar ? `<button class="text-blue-600 text-xs px-2 py-1 ml-2 rounded hover:text-blue-800"
                          onclick="abrirModalEdicaoIndividual(${item.id}, ${item.valor})">
                          <i class="fas fa-edit"></i>
                        </button>` : ''}
      </td>

      <td class="px-4 py-2 border">
        ${formatarValorComTipo(metaFinal, indicador.tipo_valor)}
        
      </td>

      <td class="px-4 py-2 border">${statusTexto}</td>

      <td class="px-4 py-2 border text-center">
        <button class="text-blue-600 underline text-sm hover:text-blue-800"
                onclick="abrirComentarioPopup('${(item.comentario ?? '').toString().replace(/'/g, "\\'")}')">Ver</button>
        ${podeEditar ? `<button class="text-blue-600 text-xs px-2 py-1 ml-2 rounded hover:text-blue-800"
                          onclick="abrirModalEdicaoComentario(${item.id}, '${(item.comentario ?? '').toString().replace(/'/g, "\\'")}')">
                          <i class="fas fa-edit"></i>
                        </button>` : ''}
      </td>

      <td class="px-4 py-2 border text-center">
        ${item.provas?.length > 0
          ? `<button class="text-blue-600 underline text-sm hover:text-blue-800"
                     onclick="abrirProvasPopup('${item.provas[0]}')">Abrir</button>`
          : '-'}
        ${podeEditar ? `<button class="text-blue-600 text-xs px-2 py-1 ml-2 rounded hover:text-blue-800"
                          onclick="abrirModalEdicaoProva(${item.id}, '${item.provas?.[0] || ''}')">
                          <i class="fas fa-edit"></i>
                        </button>` : ''}
      </td>
    `;
    corpoTabela.appendChild(tr);
  });

  // 5) gráfico (um ponto por mês)
  if (window.graficoDesempenho) window.graficoDesempenho.destroy();

  const labels = hist.map(item => {
    const [a, m] = String(item.data).slice(0, 7).split('-');
    return `${m}/${a}`;
  });

  window.graficoDesempenho = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Valor',
          data: hist.map(item => item.valor),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.3,
          fill: true
        },
        {
          label: 'Meta',
          data: hist.map(item => {
            const [a, m] = String(item.data).slice(0, 7).split('-');
            const chave = `${a}-${m}`;
            const mMensal = indicador.metas_mensais?.find(x => (x.mes || '').startsWith(chave));
            return mMensal ? parseFloat(mMensal.valor_meta) : parseFloat(item.meta);
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

// --------- Aplicar filtros (cards) ---------

function aplicarFiltros() {
  const setorSelecionado = document.getElementById('filter-setor')?.value || 'todos';
  const statusSelecionado = document.getElementById('filter-status')?.value || 'todos';
  const anoSelecionado = document.getElementById('filter-ano')?.value || 'todos';
  const mesSelecionado = document.getElementById('filter-mes')?.value || 'mes-atual';

  let dadosFiltradosTemporarios = [...indicadoresComValoresGlobais];

  if (setorSelecionado !== 'todos') {
    const alvo = normalizarTexto(setorSelecionado);
    dadosFiltradosTemporarios = dadosFiltradosTemporarios.filter(ind => {
      const nomeNorm = normalizarTexto(ind.setor_nome);
      return nomeNorm.includes(alvo);
    });
  }

  let indicadoresParaRenderizar = [];

  dadosFiltradosTemporarios.forEach(indicadorOriginal => {
    let valorNoPeriodo = null;
    let metaNoPeriodo = parseFloat(indicadorOriginal.valor_meta);
    let ultimaAtualizacaoNoPeriodo = null;
    let comentariosNoPeriodo = indicadorOriginal.comentarios;
    let provasNoPeriodo = indicadorOriginal.provas;
    let responsavelNoPeriodo = indicadorOriginal.responsavel;
    let variacaoNoPeriodo = indicadorOriginal.variacao;

    if (mesSelecionado === 'mes-atual' || (anoSelecionado === 'todos' && mesSelecionado === 'todos')) {
      valorNoPeriodo = indicadorOriginal.valor_atual;
      metaNoPeriodo = parseFloat(indicadorOriginal.valor_meta);
      ultimaAtualizacaoNoPeriodo = indicadorOriginal.ultimaAtualizacao;
      comentariosNoPeriodo = indicadorOriginal.comentarios;
      provasNoPeriodo = indicadorOriginal.provas;
      responsavelNoPeriodo = indicadorOriginal.responsavel;
      variacaoNoPeriodo = indicadorOriginal.variacao;
    } else {
      const preenchimentoDoPeriodo = (indicadorOriginal.historico || [])
        .filter(item => {
          const itemYear = String(item.data).slice(0,4);
          const itemMonth = String(item.data).slice(5,7);
          const matchesYear = anoSelecionado === 'todos' || itemYear === anoSelecionado;
          const matchesMonth = mesSelecionado === 'todos' || itemMonth === mesSelecionado;
          return matchesYear && matchesMonth;
        })
        .sort((a, b) => String(b.data).localeCompare(String(a.data)))
        .at(0);

      if (preenchimentoDoPeriodo) {
        valorNoPeriodo = preenchimentoDoPeriodo.valor;
        metaNoPeriodo = preenchimentoDoPeriodo.meta;
        ultimaAtualizacaoNoPeriodo = preenchimentoDoPeriodo.data;
        comentariosNoPeriodo = preenchimentoDoPeriodo.comentario;
        provasNoPeriodo = preenchimentoDoPeriodo.provas;

        if (metaNoPeriodo !== 0) {
          variacaoNoPeriodo = ((valorNoPeriodo - metaNoPeriodo) / metaNoPeriodo) * 100;
        } else {
          variacaoNoPeriodo = 0;
        }
      } else {
        return; // sem dados no período, não renderiza
      }
    }

    const indicadorPeriodo = {
      ...indicadorOriginal,
      valor_atual: valorNoPeriodo,
      atingido: verificarAtingimento(indicadorOriginal.tipo_meta, valorNoPeriodo, metaNoPeriodo),
      variacao: parseFloat((variacaoNoPeriodo || 0).toFixed(2)),
      valor_meta: metaNoPeriodo,
      ultimaAtualizacao: ultimaAtualizacaoNoPeriodo,
      comentarios: comentariosNoPeriodo,
      provas: provasNoPeriodo,
      responsavel: responsavelNoPeriodo
    };
    indicadoresParaRenderizar.push(indicadorPeriodo);
  });

  // Filtro por status (inclui 'monitoramento' e exclui monitoramento dos demais)
  if (statusSelecionado !== 'todos') {
    const v = String(statusSelecionado || '').toLowerCase();
    indicadoresParaRenderizar = indicadoresParaRenderizar.filter(ind => {
      if (v === 'monitoramento') {
        // Somente indicadores cujo tipo é monitoramento
        return ind.tipo_meta === 'monitoramento';
      }
      if (v === 'atingidos') {
        // Exclui monitoramento deste grupo
        return ind.tipo_meta !== 'monitoramento' && ind.atingido === true;
      }
      if (v === 'nao-atingidos') {
        // Exclui monitoramento deste grupo
        return ind.tipo_meta !== 'monitoramento' && ind.atingido === false;
      }
      return true;
    });
  }

  renderComPaginacao(indicadoresParaRenderizar);
}

// --------- Select de setores ---------

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
      const setores = asList(data);
      select.innerHTML = '<option value="todos">Todos os Setores</option>';
      setores.forEach(setor => {
        const opt = document.createElement("option");
        opt.value = setor.nome.toLowerCase().replace(/\s+/g, '-');
        opt.textContent = setor.nome;
        select.appendChild(opt);
      });
    })
    .catch(err => console.error("Erro ao preencher setores:", err));
}

function atualizarSelectSetoresComPreenchimento() {
  const select = document.getElementById("filter-setor");
  if (!select) return;

  const base = (indicadoresComValoresGlobais || []);

  const slugs = new Set();
  const nomePorSlug = {};
  for (const i of base) {
    const nome = i.setor_nome || '';
    const slug = nome.toLowerCase().replace(/\s+/g, '-');
    nomePorSlug[slug] = nome;
    slugs.add(slug);
  }

  select.innerHTML = '<option value="todos">Todos os Setores</option>' +
    [...slugs]
      .sort((a, b) => (nomePorSlug[a] || '').localeCompare(nomePorSlug[b] || ''))
      .map(slug => `<option value="${slug}">${nomePorSlug[slug]}</option>`)
      .join('');
}

// --------- Popups simples ---------

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

// --------- Editar valor / comentário / prova ---------

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

function abrirModalEdicaoComentario(idPreenchimento, comentarioAtual) {
  const modal = document.getElementById('editar-comentario-modal');
  const textarea = document.getElementById('campo-novo-comentario');
  textarea.value = comentarioAtual;
  textarea.dataset.preenchimentoId = idPreenchimento;
  modal.classList.remove('hidden');
}

async function salvarComentario() {
  const textarea = document.getElementById('campo-novo-comentario');
  const idPreenchimento = textarea.dataset.preenchimentoId;
  const novoComentario = textarea.value;

  try {
    const response = await fetch(`${apiBase}/preenchimentos/${idPreenchimento}/`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ comentario: novoComentario })
    });

    if (!response.ok) throw new Error(`Erro na API: ${response.statusText}`);

    alert("Comentário atualizado com sucesso.");
    document.getElementById('editar-comentario-modal').classList.add('hidden');
    location.reload();
  } catch (err) {
    console.error("Erro ao atualizar o comentário:", err);
    alert("Erro ao atualizar o comentário. Verifique o console.");
  }
}

function abrirModalEdicaoProva(idPreenchimento, provaAtual) {
  const modal = document.getElementById('editar-prova-modal');
  const provaInfo = document.getElementById('prova-atual-info');
  const nomeProva = document.getElementById('nome-prova-atual');
  const linkProva = document.getElementById('link-prova');
  const input = document.getElementById('campo-nova-prova');

  input.value = ''; // Reset
  if (provaAtual && String(provaAtual).trim() !== '') {
    const nomeArquivo = String(provaAtual).split('/').pop().split('?')[0];
    nomeProva.textContent = nomeArquivo;
    linkProva.href = provaAtual;
    provaInfo.classList.remove('hidden');
  } else {
    provaInfo.classList.add('hidden');
  }
  input.dataset.preenchimentoId = idPreenchimento;
  modal.classList.remove('hidden');
}

async function salvarProva() {
  const input = document.getElementById('campo-nova-prova');
  const idPreenchimento = input.dataset.preenchimentoId;
  const file = input.files[0];

  if (!file) {
    alert("Nenhum novo arquivo selecionado. A prova não foi alterada.");
    document.getElementById('editar-prova-modal').classList.add('hidden');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    alert("O arquivo é muito grande. O tamanho máximo permitido é 2MB.");
    return;
  }

  const formData = new FormData();
  formData.append('arquivo', file);

  try {
    const response = await fetch(`${apiBase}/preenchimentos/${idPreenchimento}/`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${token}` },
      body: formData
    });

    if (!response.ok) {
      let mensagemErro = `Erro na API: ${response.statusText}`;
      try {
        const erro = await response.json();
        mensagemErro = Object.values(erro).flat().join('\n');
      } catch (e) { /* noop */ }
      throw new Error(mensagemErro);
    }

    alert("Prova atualizada com sucesso.");
    document.getElementById('editar-prova-modal').classList.add('hidden');
    location.reload();
  } catch (err) {
    console.error("Erro ao atualizar a prova:", err);
    alert("Erro ao atualizar a prova:\n" + err.message);
  }
}
