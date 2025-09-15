// Mapa global: indicador_id -> tipo_valor, e nome -> tipo_valor (fallback)
const tipoPorIndicadorId = new Map();
const tipoPorIndicadorNome = new Map();

// === ESTADO GERAL E SEGURANÇA DE ACESSO ===
document.addEventListener("DOMContentLoaded", async () => {
  const perfil = localStorage.getItem("perfil_usuario");
  const token = localStorage.getItem("access");

  if (perfil !== "master") {
    alert("Acesso negado. Esta página é exclusiva para perfil master.");
    window.location.href = "indexgestores.html";
    return;
  }

  if (!token) {
    alert("Você precisa estar logado.");
    window.location.href = "login.html";
    return;
  }

  try {
    await carregarSetores();       // aguarda setores
    await carregarIndicadores();   // só então popula indicadores
  } catch (e) {
    console.error("Falha ao carregar filtros:", e);
  }

  configurarEventosDeFiltro();
  if (typeof carregarUsuarioLogado === "function") {
    try { carregarUsuarioLogado(); } catch (e) {}
  }

  document.getElementById("btn-ver-historico")?.addEventListener("click", carregarPreenchimentos);
  document.getElementById("btn-exportar-excel")?.addEventListener("click", exportarParaExcel);
  document.getElementById("btn-exportar-pdf")?.addEventListener("click", exportarParaPDF);
});

// === FUNÇÕES DE FILTRO E HISTÓRICO ===
function normalizarTexto(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // remove acentos
    .replace(/\s+/g, " ")           // colapsa espaços
    .trim();
}

// Cache de preenchimentos para montar a lista de indicadores com pelo menos 1 mês
let __preenchimentosCache = null;

// Busca e mantém em cache os preenchimentos (evita múltiplas requisições idênticas)
async function ensurePreenchimentosCache() {
  if (Array.isArray(__preenchimentosCache)) return __preenchimentosCache;

  const token = localStorage.getItem("access");
  const res = await fetch(`${window.API_BASE_URL}/api/preenchimentos/`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Erro ao carregar preenchimentos (para filtro de indicadores)");

  const data = await res.json();
  __preenchimentosCache = Array.isArray(data) ? data : (data.results || []);
  return __preenchimentosCache;
}

function configurarEventosDeFiltro() {
  const selSetor = document.getElementById("filter-setor");
  const selIndicador = document.getElementById("filter-indicador");

  if (selSetor) {
    selSetor.addEventListener("change", async () => {
      // ao trocar de setor, reset o indicador e recarrega a lista
      if (selIndicador) selIndicador.value = "";
      await carregarIndicadores();
    });
  }
}

async function carregarSetores() {
  const token = localStorage.getItem("access");
  const res = await fetch(`${window.API_BASE_URL}/api/setores/`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Erro ao carregar setores");
  const data = await res.json();

  const select = document.getElementById("filter-setor");
  if (!select) return;

  select.innerHTML = `<option value="">Todos os setores</option>`;
  const setores = Array.isArray(data) ? data : data.results || [];
  setores.forEach(setor => {
    // o value fica como o NOME, para comparação por nome
    select.innerHTML += `<option value="${setor.nome}">${setor.nome}</option>`;
  });
}

async function carregarIndicadores() {
  const token = localStorage.getItem("access");
  const selSetor = document.getElementById("filter-setor");
  const setorSelecionado = selSetor ? selSetor.value : "";

  // 1) Busca a lista de indicadores
  const res = await fetch(`${window.API_BASE_URL}/api/indicadores/`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Erro ao carregar indicadores");
  const data = await res.json();
  const indicadores = Array.isArray(data) ? data : (data.results || []);

  // 2) Garante os preenchimentos em cache
  const preenchimentos = await ensurePreenchimentosCache();

  // 3) Normalizador (reusa o seu helper)
  const alvoSetorNorm = normalizarTexto(setorSelecionado);

  // 4) Conjunto de **nomes** de indicadores que têm pelo menos 1 mês preenchido
  //    - Se houver setor selecionado => considera apenas preenchimentos daquele setor
  //    - Se não houver setor => considera preenchimentos de qualquer setor
  const indicadoresComHistorico = new Set(
    preenchimentos
      .filter(p => {
        if (!alvoSetorNorm) return true; // sem setor => considera todos
        const setorDoP = normalizarTexto(p?.setor_nome || p?.setor?.nome || "");
        return setorDoP === alvoSetorNorm;
      })
      .map(p => String(p?.indicador_nome || p?.indicador?.nome || "").trim())
      .filter(nome => nome.length > 0)
  );

  // 5) Popular o <select> somente com indicadores que tenham pelo menos 1 mês preenchido
  const select = document.getElementById("filter-indicador");
  if (!select) return;
  select.innerHTML = `<option value="">Todos os Indicadores</option>`;

  const nomesJaInseridos = new Set();
  const setorSelecionadoNorm = alvoSetorNorm;

  indicadores
    .filter(i => {
      // a) Respeita o setor selecionado (quando houver)
      if (setorSelecionadoNorm) {
        const setorDoIndicador = normalizarTexto(i.setor_nome);
        if (setorDoIndicador !== setorSelecionadoNorm) return false;
      }
      // b) Garante pelo menos 1 mês preenchido
      const nomeInd = String(i.nome || "").trim();
      return indicadoresComHistorico.has(nomeInd);
    })
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")))
    .forEach(i => {
      const nome = String(i.nome || "").trim();
      if (!nome || nomesJaInseridos.has(nome)) return;
      nomesJaInseridos.add(nome);
      select.innerHTML += `<option value="${nome}">${nome}</option>`;

      // ✅ guardar o tipo por id e por nome (fallback)
      const tipo = (i.tipo_valor || 'numeral');
      if (i.id != null) tipoPorIndicadorId.set(i.id, tipo);
      tipoPorIndicadorNome.set(nome, tipo);
    });
}

function carregarPreenchimentos() {
    const token = localStorage.getItem("access");

    fetch(`${window.API_BASE_URL}/api/preenchimentos/`, {
        headers: { "Authorization": `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        const preenchimentos = Array.isArray(data) ? data : data.results || [];
        aplicarFiltros(preenchimentos);
    })
    .catch(err => {
        console.error("Erro ao carregar preenchimentos:", err);
        alert("Erro ao buscar os dados do histórico.");
    });
}

function aplicarFiltros(preenchimentos) {
    const setorSelecionado = document.getElementById("filter-setor").value;
    const indicadorSelecionado = document.getElementById("filter-indicador").value;
    const dataInicialStr = document.getElementById("filter-data-inicial").value;
    const dataFinalStr = document.getElementById("filter-data-final").value;
    const statusSelecionado = document.getElementById("filter-status").value;

    if (!dataInicialStr || !dataFinalStr || !statusSelecionado) {
        console.warn("Preencha todos os filtros para aplicar.");
        document.getElementById("historico-container").classList.add("hidden");
        return;
    }

    // ✅ Corrige a diferença de mês no UTC
    const [anoIni, mesIni] = dataInicialStr.split("-").map(Number);
    const [anoFim, mesFim] = dataFinalStr.split("-").map(Number);
    const inicioTimestamp = new Date(anoIni, mesIni - 1).getTime();
    const fimTimestamp = new Date(anoFim, mesFim - 1).getTime();

    const lista = Array.isArray(preenchimentos) ? preenchimentos : preenchimentos.results || [];

    const filtrados = lista.filter(p => {
        const dataTimestamp = new Date(p.ano, p.mes - 1).getTime();

        const condDataInicial = dataTimestamp >= inicioTimestamp;
        const condDataFinal = dataTimestamp <= fimTimestamp;
        const condSetor = setorSelecionado ? p.setor_nome === setorSelecionado : true;
        const condIndicador = indicadorSelecionado ? p.indicador_nome === indicadorSelecionado : true;

        let condStatus = true;
        if (statusSelecionado === "atingidos") {
            condStatus = calcularStatus(p.valor_realizado, p.meta, p.tipo_meta) === "Atingida";
        } else if (statusSelecionado === "nao-atingidos") {
            condStatus = calcularStatus(p.valor_realizado, p.meta, p.tipo_meta) === "Não atingida";
        }

        return condSetor && condIndicador && condDataInicial && condDataFinal && condStatus;
    });

    renderizarHistorico(filtrados);

    const historicoDiv = document.getElementById("historico-container");
    if (filtrados.length > 0) {
        historicoDiv.classList.remove("hidden");
    } else {
        historicoDiv.classList.add("hidden");
    }
}

function renderizarHistorico(preenchimentos) {
    const tbody = document.getElementById("historico-body");
    const thead = document.getElementById("historico-head");
    tbody.innerHTML = "";
    thead.innerHTML = "";

    const dadosAgrupados = {};
    const mesesSet = new Set();

    preenchimentos.forEach(p => {
        const chaveMes = `${p.ano}-${String(p.mes).padStart(2, '0')}`;
        mesesSet.add(chaveMes);

        if (!dadosAgrupados[p.indicador_nome]) {
            dadosAgrupados[p.indicador_nome] = {};
        }

        dadosAgrupados[p.indicador_nome][chaveMes] = {
            valor: p.valor_realizado,
            meta:  p.meta,
            status: calcularStatus(p.valor_realizado, p.meta, p.tipo_meta),
            // ✅ preferir o que vier do preenchimento; senão, buscar pelos mapas
            tipo_valor: p.tipo_valor
                    ?? (p.indicador != null ? tipoPorIndicadorId.get(p.indicador) : undefined)
                    ?? tipoPorIndicadorNome.get(p.indicador_nome)
                    ?? 'numeral'
        };
    });

    const mesesOrdenados = Array.from(mesesSet).sort();

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

    for (const indicador in dadosAgrupados) {
        let row = `<td class="px-4 py-2 font-semibold">${indicador}</td>`;

        mesesOrdenados.forEach(mes => {
            const dados = dadosAgrupados[indicador][mes];
            if (dados) {
                const status = (dados.status || "").toLowerCase();
                const corStatus = status === "atingida"
                    ? "text-green-600"
                    : status === "não atingida" || status === "nao atingida"
                    ? "text-red-600"
                    : "text-gray-600";

                const icone = status === "atingida"
                    ? "✅"
                    : status === "não atingida" || status === "nao atingida"
                    ? "❌"
                    : "📊";

                row += `
                    <td class="px-4 py-2 border-l border-gray-300">${formatarValor(dados.valor, dados.tipo_valor)}</td>
                    <td class="px-4 py-2">${formatarValor(dados.meta,  dados.tipo_valor)}</td>
                    <td class="px-4 py-2 ${corStatus}">${icone} ${dados.status}</td>
                `;
            } else {
                row += `<td class="px-4 py-2">—</td><td class="px-4 py-2">—</td><td class="px-4 py-2">—</td>`;
            }
        });

        tbody.innerHTML += `<tr>${row}</tr>`;
    }
}

function calcularStatus(valor, meta, tipo) {
    if (valor == null || meta == null) return "Sem dados";
    if (tipo === "crescente") return valor >= meta ? "Atingida" : "Não atingida";
    if (tipo === "decrescente") return valor <= meta ? "Atingida" : "Não atingida";
    return "Monitoramento";
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
    // 👉 Se a API enviar 0.15 para 15%, troque para: const shown = n * 100;
    const shown = n;
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
    const container = document.getElementById("historico-container");

    if (!container) {
        alert("Nenhum conteúdo para exportar.");
        return;
    }

    // 🔹 Salva estilo original
    const originalStyle = {
        width: container.style.width,
        maxWidth: container.style.maxWidth,
        overflowX: container.style.overflowX,
        overflowY: container.style.overflowY,
        height: container.style.height,
        maxHeight: container.style.maxHeight,
    };

    // 🔹 Expande completamente
    container.style.width = container.scrollWidth + "px";
    container.style.overflowX = "visible";
    container.style.overflowY = "visible";
    container.style.maxWidth = "none";
    container.style.height = "auto";
    container.style.maxHeight = "none";

    // Aguarda renderização
    setTimeout(() => {
        html2canvas(container, {
            scrollX: -window.scrollX,
            scrollY: -window.scrollY,
            windowWidth: document.body.scrollWidth,
            windowHeight: document.body.scrollHeight,
            scale: 2 // melhora a resolução
        }).then(canvas => {
            const imgData = canvas.toDataURL("image/png");

            const pdf = new jspdf.jsPDF({
                orientation: 'landscape',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });

            pdf.addImage(imgData, 'PNG', 0, 0);
            pdf.save("relatorio-indicadores.pdf");

            // 🔹 Restaura estilo original
            container.style.width = originalStyle.width;
            container.style.maxWidth = originalStyle.maxWidth;
            container.style.overflowX = originalStyle.overflowX;
            container.style.overflowY = originalStyle.overflowY;
            container.style.height = originalStyle.height;
            container.style.maxHeight = originalStyle.maxHeight;

        }).catch(err => {
            console.error("Erro ao gerar PDF:", err);
            alert("Erro ao gerar PDF.");

            // 🔹 Restaura estilo mesmo com erro
            container.style.width = originalStyle.width;
            container.style.maxWidth = originalStyle.maxWidth;
            container.style.overflowX = originalStyle.overflowX;
            container.style.overflowY = originalStyle.overflowY;
            container.style.height = originalStyle.height;
            container.style.maxHeight = originalStyle.maxHeight;
        });
    }, 300); // Delay para garantir reflow completo
}