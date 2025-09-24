// Mapa global: indicador_id -> tipo_valor ('monetario' | 'percentual' | 'numeral')
const tipoPorIndicador = new Map();

// 👇 novos mapas para meta padrão e tipo_meta por indicador
const metaPadraoPorIndicador = new Map();
const tipoMetaPorIndicador   = new Map();

// ✅ periodicidade (em meses) por indicador (1 = mensal, 3 = trimestral, etc.)
const periodicidadePorIndicador = new Map();

// 👇 cache das metas mensais
let __metasMensaisCache = null;

window.__indicadoresPermitidos = new Set();

// === ESTADO GERAL E SEGURANÇA DE ACESSO ===
document.addEventListener("DOMContentLoaded", () => {
    const perfil = localStorage.getItem("perfil_usuario");
    const token = localStorage.getItem("access");

    if (perfil !== "gestor") {
        alert("Acesso negado. Esta página é exclusiva para perfil gestor.");
        window.location.href = "index.html";
        return;
    }

    if (!token) {
        alert("Você precisa estar logado.");
        window.location.href = "login.html";
        return;
    }

    preencherIndicadoresGestor();
    configurarEventosDeFiltro();

    document.getElementById("btn-exportar-excel").addEventListener("click", exportarParaExcel);
    document.getElementById("btn-exportar-pdf").addEventListener("click", exportarParaPDF);
});

// === SETA OS INDICADORES DO GESTOR ===
function preencherIndicadoresGestor() {
    const token = localStorage.getItem("access");
    const select = document.getElementById("filter-indicador");

    fetch(`${window.API_BASE_URL}/api/indicadores/meus/`, {
        headers: { Authorization: `Bearer ${token}` }
    })
    .then(res => {
        if (!res.ok) throw new Error("Erro ao buscar indicadores do gestor");
        return res.json();
    })
    .then(data => {
        // Limpa e preenche o select
        select.innerHTML = `<option value="">Todos os indicadores</option>`;

        // zera e povoa o conjunto permitido
        window.__indicadoresPermitidos.clear();

        // ✅ mantenha SOMENTE os ativos (se 'ativo' não vier, assume ativo)
        const ativos = (Array.isArray(data) ? data : [])
          .filter(i => i.ativo !== false && i.ativo !== 0 && String(i.ativo ?? 'true').toLowerCase() !== 'false');

        ativos.forEach(indicador => {
          const opt = document.createElement("option");
          opt.value = indicador.id;
          opt.textContent = indicador.nome;
          select.appendChild(opt);

          // tipo
          tipoPorIndicador.set(indicador.id, indicador.tipo_valor || 'numeral');

          // 👇 meta padrão e tipo_meta para completar meses vazios
          metaPadraoPorIndicador.set(indicador.id, Number(indicador.valor_meta ?? 0));
          tipoMetaPorIndicador.set(indicador.id, indicador.tipo_meta || 'crescente');

          // ✅ periodicidade em meses (campo comum: indicador.periodicidade). Default = 1
          periodicidadePorIndicador.set(
            indicador.id,
            Number(indicador.periodicidade ?? 1)
          );

          // ✅ registra como permitido para este gestor (apenas ativos entram)
          window.__indicadoresPermitidos.add(indicador.id);
        });
    })
    .catch(err => {
        console.error("Erro ao carregar indicadores do gestor:", err);
        alert("Erro ao carregar indicadores do gestor.");
    });
}

// === EVENTOS ===
function configurarEventosDeFiltro() {
    document.getElementById("btn-filtrar").addEventListener("click", carregarPreenchimentos);
}

// === GERA MESES POR INDICADOR ===
function gerarMesesDoIndicador(mesInicialStr, periodicidade) {
    const datas = [];
    const dataInicial = new Date(mesInicialStr);
    let ano = dataInicial.getFullYear();
    let mes = dataInicial.getMonth() + 1;

    const hoje = new Date();
    const anoFim = hoje.getFullYear();
    const mesFim = hoje.getMonth() + 1;

    while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
        datas.push(`${ano}-${String(mes).padStart(2, "0")}`);
        mes += periodicidade;
        if (mes > 12) {
            mes = mes % 12 || 12;
            ano += 1;
        }
    }

    return datas;
}

// ==== Helpers para meses YYYY-MM e metas ====
// Gera "YYYY-MM"
function ymStr(ano, mes) {
  return `${String(ano).padStart(4,'0')}-${String(mes).padStart(2,'0')}`;
}
// Lista meses entre ini e fim (inclusive) no formato YYYY-MM
function enumMonthsInclusive(iniYYYYMM, fimYYYYMM) {
  if (!iniYYYYMM || !fimYYYYMM) return [];
  let [y, m] = iniYYYYMM.split('-').map(Number);
  const [ey, em] = fimYYYYMM.split('-').map(Number);
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(ymStr(y, m));
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// diferença de meses: b - a (ambos 'YYYY-MM')
function diffMeses(aYYYYMM, bYYYYMM) {
  const [ay, am] = aYYYYMM.split('-').map(Number);
  const [by, bm] = bYYYYMM.split('-').map(Number);
  return (by * 12 + bm) - (ay * 12 + am);
}

// filtra lista de meses para manter só os alinhados com a periodicidade a partir do âncora
function filtrarMesesAlinhados(meses, anchorYYYYMM, periodicidade) {
  const per = Number(periodicidade || 1);
  if (per <= 1 || !anchorYYYYMM) return meses.slice();
  return meses.filter(mm => {
    const d = diffMeses(anchorYYYYMM, mm);
    return d >= 0 && d % per === 0;
  });
}

// encontra o primeiro mês (YYYY-MM) de um indicador na lista vinda da API
function encontrarAnchorPorIndicador(listaPreench, indicadorId) {
  const items = (Array.isArray(listaPreench) ? listaPreench : (listaPreench?.results || []))
    .filter(p => p.indicador === Number(indicadorId));
  if (!items.length) return null;
  items.sort((a,b) => a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes);
  return ymStr(items[0].ano, items[0].mes);
}

// Normaliza texto para comparar nomes de setor com segurança
function normalizarTexto(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

async function ensureMetasMensaisCache() {
  if (Array.isArray(__metasMensaisCache)) return __metasMensaisCache;
  const token = localStorage.getItem("access");
  const res = await fetch(`${window.API_BASE_URL}/api/metas-mensais/`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Erro ao carregar metas mensais");
  const data = await res.json();
  __metasMensaisCache = Array.isArray(data) ? data : (data.results || []);
  return __metasMensaisCache;
}

// Meta do mês (se existir) senão meta padrão do indicador
function metaPara(indicadorId, yyyyMM, metasMensais) {
  if (indicadorId == null) return null;
  const mm = metasMensais.find(m => m.indicador === indicadorId && String(m.mes).startsWith(yyyyMM));
  if (mm) return Number(mm.valor_meta);
  if (metaPadraoPorIndicador.has(indicadorId)) return Number(metaPadraoPorIndicador.get(indicadorId));
  return null;
}

function tipoMetaPara(indicadorId) {
  return tipoMetaPorIndicador.get(indicadorId) || 'crescente';
}

// === CARREGA DADOS API ===
async function carregarPreenchimentos() {
  const token = localStorage.getItem("access");
  const indicadorId = document.getElementById("filter-indicador").value;
  const setoresUsuario = JSON.parse(localStorage.getItem("setores_usuario") || "[]");

  if (!token || !setoresUsuario.length) {
    alert("Erro: token ou setores do gestor não encontrados.");
    return;
  }

  let url = `${window.API_BASE_URL}/api/preenchimentos/`;
  if (indicadorId) url += `?indicador=${encodeURIComponent(indicadorId)}`;

  try {
    const [res] = await Promise.all([
      fetch(url, { headers: { "Authorization": `Bearer ${token}` } }),
      ensureMetasMensaisCache()
    ]);

    if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${url}`);

    const data = await res.json();
    const preenchimentos = Array.isArray(data) ? data : (data.results || []);

    const permitidos = window.__indicadoresPermitidos || new Set();
    const soDoGestor = preenchimentos.filter(p => permitidos.has(p.indicador));

    const preenchimentosFiltrados = indicadorId
      ? soDoGestor.filter(p => p.indicador === Number(indicadorId))
      : soDoGestor;

    aplicarFiltros(preenchimentosFiltrados, __metasMensaisCache);
  } catch (err) {
    console.error("Erro ao carregar preenchimentos:", err);
    alert("Erro ao buscar os dados do histórico.");
  }
}


// === FILTRA COM BASE EM ANO/MÊS ===
function aplicarFiltros(preenchimentos, metasMensais) {
  const indicadorSelecionado = document.getElementById("filter-indicador").value;
  const dataInicialStr = document.getElementById("filter-data-inicial").value; // YYYY-MM
  const dataFinalStr   = document.getElementById("filter-data-final").value;   // YYYY-MM
  const statusSelecionado = document.getElementById("filter-status").value;

  if (!dataInicialStr || !dataFinalStr || !statusSelecionado) {
    console.warn("Preencha todos os filtros para aplicar.");
    return;
  }

  const mesesOrdenados = enumMonthsInclusive(dataInicialStr, dataFinalStr);

  const [anoIni, mesIni] = dataInicialStr.split("-").map(Number);
  const [anoFim, mesFim] = dataFinalStr.split("-").map(Number);
  const inicioTimestamp  = new Date(anoIni, mesIni - 1).getTime();
  const fimTimestamp     = new Date(anoFim,  mesFim - 1).getTime();

  const lista = Array.isArray(preenchimentos) ? preenchimentos : (preenchimentos?.results || []);

  // nomes dos setores do gestor (strings ou objetos com 'nome')
  const setoresUsuario = JSON.parse(localStorage.getItem("setores_usuario") || "[]");
  const setoresGestorNomes = setoresUsuario
    .map(s => s?.nome ?? s)
    .filter(Boolean)
    .map(normalizarTexto);

  const baseFiltrados = lista.filter(p => {
    const t = new Date(p.ano, p.mes - 1).getTime();
    const condDataIni   = t >= inicioTimestamp;
    const condDataFim   = t <= fimTimestamp;

    const condIndicador = indicadorSelecionado
      ? p.indicador === Number(indicadorSelecionado)
      : true;

    // 🔒 Indicadores do gestor via /indicadores/meus/
    const permitidos = window.__indicadoresPermitidos || new Set();
    const condGestorIndicador = permitidos.has(p.indicador);

    // 🔒 E também limitar pelos SETORES do gestor
    const setorDoRegistro = normalizarTexto(p.setor_nome || p.setor?.nome || "");
    const condGestorSetor = setoresGestorNomes.length
      ? setoresGestorNomes.includes(setorDoRegistro)
      : true;

    const v = String(statusSelecionado || "").toLowerCase();

    // tipo de meta do indicador (fonte do próprio indicador, como no index.js)
    const tipoMeta = String(
      (p.tipo_meta ?? tipoMetaPorIndicador.get(p.indicador) ?? "")
    ).toLowerCase();

    const isMonitoramento = (tipoMeta === "monitoramento");

    // meta efetiva do período (meta mensal > padrão). metaPara já faz fallback de padrão.
    const yyyyMM      = ymStr(p.ano, p.mes);
    const metaEfetiva = metaPara(p.indicador, yyyyMM, metasMensais);

    // atingimento para não-monitoramento
    const valorOk = (p.valor_realizado != null && !Number.isNaN(Number(p.valor_realizado)));
    const metaOk  = (metaEfetiva != null && !Number.isNaN(Number(metaEfetiva)));

    let atingidoBool = false;
    if (!isMonitoramento && valorOk && metaOk) {
      if (tipoMeta === "crescente") {
        atingidoBool = Number(p.valor_realizado) >= Number(metaEfetiva);
      } else if (tipoMeta === "decrescente") {
        atingidoBool = Number(p.valor_realizado) <= Number(metaEfetiva);
      }
    }

    // filtro de status igual ao index.js
    let condStatus = true;
    if (v === "monitoramento") {
      condStatus = isMonitoramento;
    } else if (v === "atingidos") {
      condStatus = !isMonitoramento && atingidoBool;
    } else if (v === "nao-atingidos" || v === "não-atingidos") {
      condStatus = !isMonitoramento && !atingidoBool;
    }

    return condIndicador && condDataIni && condDataFim && condGestorIndicador && condGestorSetor && condStatus;
  });

  const agrupado = {};
  baseFiltrados.forEach(p => {
    const chaveMes = ymStr(p.ano, p.mes);
    const indNome  = String(p.indicador_nome || "").trim();
    if (!indNome) return;

    if (!agrupado[indNome]) agrupado[indNome] = {};

    const metaMesTabela = metaPara(p.indicador, chaveMes, metasMensais) ?? p.meta;
    const tipoMetaTbl   = (p.tipo_meta ?? tipoMetaPorIndicador.get(p.indicador) ?? 'crescente');

    agrupado[indNome][chaveMes] = {
      valor:  p.valor_realizado,
      meta:   metaMesTabela,
      status: calcularStatus(p.valor_realizado, metaMesTabela, tipoMetaTbl),
      tipo_valor: p.tipo_valor ?? tipoPorIndicador.get(p.indicador) ?? 'numeral',
      _id: p.indicador
    };
  });

  Object.keys(agrupado).forEach(indNome => {
    const porMes = agrupado[indNome];
    const algumId = Object.values(porMes).find(x => x && x._id != null)?._id ?? null;

    // periodicidade deste indicador (1 = mensal, 3 = trimestral, etc.)
    const per = periodicidadePorIndicador.get(algumId) ?? 1;

    // âncora: 1º mês do indicador na base (se não achar, usa dataInicialStr)
    const anchor = encontrarAnchorPorIndicador(preenchimentos, algumId) || dataInicialStr;

    // meses em que ESTE indicador realmente "existe" (alinhados à periodicidade)
    const mesesPermitidos = filtrarMesesAlinhados(mesesOrdenados, anchor, per);

    // preenche SOMENTE os meses permitidos
    mesesPermitidos.forEach(yyyyMM => {
      if (!porMes[yyyyMM]) {
        const meta      = metaPara(algumId, yyyyMM, metasMensais);
        const tipoValor = tipoPorIndicador.get(algumId) ?? 'numeral';
        const tMeta     = tipoMetaPara(algumId);
        const status    = calcularStatus(0, meta, tMeta);

        porMes[yyyyMM] = {
          valor:  0,
          meta:   meta,
          status: status,
          tipo_valor: tipoValor
        };
      }
    });
  });

  renderizarHistorico(agrupado, mesesOrdenados);

  const historicoDiv = document.querySelector(".bg-white.rounded.shadow.p-4.mt-8");
  if (historicoDiv) {
    const temLinhas = Object.keys(agrupado).length > 0 && mesesOrdenados.length > 0;
    historicoDiv.style.display = temLinhas ? "" : "none";
  }
}

// === RENDERIZA TABELA ===
function renderizarHistorico(dadosAgrupados, mesesOrdenados) {
  const tbody = document.getElementById("historico-body");
  const thead = document.getElementById("historico-head");
  tbody.innerHTML = "";
  thead.innerHTML = "";

  // Cabeçalho
  let header = `<th class="px-4 py-2">Indicador</th>`;
  mesesOrdenados.forEach(mes => {
    const [ano, mesNum] = mes.split("-");
    const mesLabel = `${mesPtBr(mesNum)}/${ano.slice(2)}`;
    header += `
      <th class="px-4 py-2">Valor ${mesLabel}</th>
      <th class="px-4 py-2">Meta ${mesLabel}</th>
      <th class="px-4 py-2">Status ${mesLabel}</th>
    `;
  });
  thead.innerHTML = `<tr>${header}</tr>`;

  // Linhas
  Object.keys(dadosAgrupados).sort().forEach(indicador => {
    let row = `<td class="px-4 py-2 font-semibold">${indicador}</td>`;

    mesesOrdenados.forEach(mes => {
      const dados = (dadosAgrupados[indicador] || {})[mes];

      if (!dados) {
        // mês não aplicável ao indicador (fora da periodicidade) OU sem dado algum
        row += `
          <td class="px-4 py-2 border-l border-gray-300">—</td>
          <td class="px-4 py-2">—</td>
          <td class="px-4 py-2 text-gray-500">—</td>
        `;
      } else {
        const status = String(dados.status || "").toLowerCase();
        const corStatus = status === "atingida"
          ? "text-green-600"
          : (status === "não atingida" || status === "nao atingida")
            ? "text-red-600"
            : "text-gray-600";

        const icone = status === "atingida"
          ? "✅"
          : (status === "não atingida" || status === "nao atingida")
            ? "❌"
            : "📊";

        row += `
          <td class="px-4 py-2 border-l border-gray-300">${formatarValor(dados.valor, dados.tipo_valor)}</td>
          <td class="px-4 py-2">${formatarValor(dados.meta,  dados.tipo_valor)}</td>
          <td class="px-4 py-2 ${corStatus}">${icone} ${dados.status || "Sem dados"}</td>
        `;
      }
    });

    tbody.innerHTML += `<tr>${row}</tr>`;
  });
}

function calcularStatus(valor, meta, tipo) {
  const t = String(tipo || "").toLowerCase();

  // Para monitoramento, sempre exibir "Monitoramento"
  if (t === "monitoramento") return "Monitoramento";

  // Para avaliação (crescente/decrescente), precisamos de valor e meta
  if (valor == null || meta == null) return "Sem dados";

  if (t === "crescente")   return Number(valor) >= Number(meta) ? "Atingida" : "Não atingida";
  if (t === "decrescente") return Number(valor) <= Number(meta) ? "Atingida" : "Não atingida";

  return "Sem dados";
}

function mesPtBr(mes) {
    const nomes = {
        "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr", "05": "Mai", "06": "Jun",
        "07": "Jul", "08": "Ago", "09": "Set", "10": "Out", "11": "Nov", "12": "Dez"
    };
    return nomes[mes] || mes;
}

// ==== Helpers de formatação ====
function normalizarNumeroUniversal(input) {
  if (input == null) return null;
  let s = String(input).trim().replace(/\s/g, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  const decPos = Math.max(lastComma, lastDot);
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;

  let canon;
  if (decPos >= 0) {
    const after = s.slice(decPos + 1).replace(/[^\d]/g, "");
    if (!after.length) {
      canon = digits;
    } else {
      const intLen = digits.length - after.length;
      canon = (intLen <= 0)
        ? ("0." + digits.padStart(after.length, "0"))
        : (digits.slice(0, intLen) + "." + digits.slice(intLen));
    }
  } else {
    canon = digits;
  }

  const n = Number(canon);
  return Number.isFinite(n) ? canon : null;
}

function resolveTipoValor(tipo) {
  const t = String(tipo || '').trim().toLowerCase();
  if (['monetario','monetário','currency','money'].includes(t)) return 'monetario';
  if (['percentual','percent','percentage','%'].includes(t))     return 'percentual';
  return 'numeral';
}

// ==== Formatação final, respeitando o tipo ====
function formatarValor(valor, tipo_valor) {
  if (valor == null || valor === '') return "—";
  const canon = normalizarNumeroUniversal(valor);
  if (canon === null) return "—";

  const n = Number(canon);
  const tipo = resolveTipoValor(tipo_valor);

  if (tipo === 'monetario') {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
  }
  if (tipo === 'percentual') {
    // 👉 Ajuste esta convenção se sua API enviar 0.15 para 15%:
    const shown = n; // use: const shown = n * 100;  // se a API enviar 0.15 para 15%
    return shown.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) + "%";
  }
  // numeral
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

// === EXPORTAÇÃO PARA EXCEL ===
function exportarParaExcel() {
    const thead = document.getElementById("historico-head");
    const tbody = document.getElementById("historico-body");

    if (!thead || !tbody || tbody.rows.length === 0) {
        alert("Nenhum dado para exportar.");
        return;
    }

    // Cria a matriz de dados
    const data = [];

    // Cabeçalho
    const headerRow = [];
    thead.querySelectorAll("th").forEach(th => {
        headerRow.push(th.textContent.trim());
    });
    data.push(headerRow);

    // Linhas de dados
    tbody.querySelectorAll("tr").forEach(tr => {
        const row = [];
        tr.querySelectorAll("td").forEach(td => {
            row.push(td.textContent.trim());
        });
        data.push(row);
    });

    // Criação da planilha
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Histórico");

    // Exporta
    XLSX.writeFile(workbook, "relatorio-indicadores.xlsx");
}

// === EXPORTAÇÃO PARA PDF ===
function exportarParaPDF() {
    const container = document.querySelector(".bg-white.rounded.shadow.p-4.mt-8");

    if (!container) {
        alert("Nenhum conteúdo para exportar.");
        return;
    }

    // Pegando a div da TABELA diretamente
    const tabelaWrapper = container.querySelector(".overflow-x-auto");

    // Backup do estilo original
    const originalStyle = {
        width: tabelaWrapper.style.width,
        maxWidth: tabelaWrapper.style.maxWidth,
        overflow: tabelaWrapper.style.overflow
    };

    // ⬅️ Expandindo temporariamente
    tabelaWrapper.style.width = tabelaWrapper.scrollWidth + "px";
    tabelaWrapper.style.maxWidth = "none";
    tabelaWrapper.style.overflow = "visible";

    setTimeout(() => {
        html2canvas(tabelaWrapper, {
            scrollX: 0,
            scrollY: 0,
            width: tabelaWrapper.scrollWidth,
            height: tabelaWrapper.scrollHeight,
            scale: 2,
            useCORS: true
        }).then(canvas => {
            const imgData = canvas.toDataURL("image/png");

            const pdf = new jspdf.jsPDF({
                orientation: 'landscape',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });

            pdf.addImage(imgData, 'PNG', 0, 0);
            pdf.save("relatorio-indicadores.pdf");

            // Restaurar estilos
            Object.assign(tabelaWrapper.style, originalStyle);
        }).catch(err => {
            console.error("Erro ao gerar PDF:", err);
            alert("Erro ao gerar PDF.");
            Object.assign(tabelaWrapper.style, originalStyle);
        });
    }, 300);
}
