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
        data.forEach(indicador => {
            const opt = document.createElement("option");
            opt.value = indicador.id;
            opt.textContent = indicador.nome;
            select.appendChild(opt);
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

// === CARREGA DADOS API ===
function carregarPreenchimentos() {
    const token = localStorage.getItem("access");
    const indicadorId = document.getElementById("filter-indicador").value;
    const setoresUsuario = JSON.parse(localStorage.getItem("setores_usuario") || "[]");

    if (!token || !setoresUsuario.length) {
        alert("Erro: token ou setores do gestor não encontrados.");
        return;
    }

    let url = `${window.API_BASE_URL}/api/preenchimentos/`;

    if (indicadorId) {
        url += `?indicador=${indicadorId}`;
    }

    fetch(url, {
        headers: { "Authorization": `Bearer ${token}` }
    })
    .then(async res => {
        const text = await res.text();
        if (!text) {
            console.warn("Resposta vazia da API.");
            aplicarFiltros([]);
            return;
        }

        const data = JSON.parse(text);
        const preenchimentos = Array.isArray(data) ? data : data.results || [];

        // 🔎 Filtro por setor apenas se estiver em "Todos"
        const preenchimentosFiltrados = indicadorId
            ? preenchimentos.filter(p => p.indicador === parseInt(indicadorId))
            : preenchimentos;

        aplicarFiltros(preenchimentosFiltrados);
    })
    .catch(err => {
        console.error("Erro ao carregar preenchimentos:", err);
        alert("Erro ao buscar os dados do histórico.");
    });
}


// === FILTRA COM BASE EM ANO/MÊS ===
function aplicarFiltros(preenchimentos) {
    const indicadorSelecionado = document.getElementById("filter-indicador").value;
    const dataInicialStr = document.getElementById("filter-data-inicial").value;
    const dataFinalStr = document.getElementById("filter-data-final").value;
    const statusSelecionado = document.getElementById("filter-status").value;

    if (!dataInicialStr || !dataFinalStr || !statusSelecionado) {
        console.warn("Preencha todos os filtros para aplicar.");
        return;
    }

    const [anoIni, mesIni] = dataInicialStr.split("-").map(Number);
    const [anoFim, mesFim] = dataFinalStr.split("-").map(Number);
    const inicioTimestamp = new Date(anoIni, mesIni - 1).getTime();
    const fimTimestamp = new Date(anoFim, mesFim - 1).getTime();

    const lista = Array.isArray(preenchimentos) ? preenchimentos : preenchimentos.results || [];

    const filtrados = lista.filter(p => {
        const preenTimestamp = new Date(p.ano, p.mes - 1).getTime();

        const condDataInicial = preenTimestamp >= inicioTimestamp;
        const condDataFinal = preenTimestamp <= fimTimestamp;
        const condIndicador = indicadorSelecionado ? p.indicador === parseInt(indicadorSelecionado) : true;

        let condStatus = true;
        if (statusSelecionado === "atingidos") {
            condStatus = calcularStatus(p.valor_realizado, p.meta, p.tipo_meta) === "Atingida";
        } else if (statusSelecionado === "nao-atingidos") {
            condStatus = calcularStatus(p.valor_realizado, p.meta, p.tipo_meta) === "Não atingida";
        }

        return condIndicador && condDataInicial && condDataFinal && condStatus;
    });

    renderizarHistorico(filtrados);
}

// === RENDERIZA TABELA ===
function renderizarHistorico(preenchimentos) {
    const tbody = document.getElementById("historico-body");
    const thead = document.getElementById("historico-head");
    tbody.innerHTML = "";
    thead.innerHTML = "";

    const mesesSet = new Set();
    const dadosAgrupados = {};

    preenchimentos.forEach(p => {
        const chaveMes = `${p.ano}-${String(p.mes).padStart(2, "0")}`;
        mesesSet.add(chaveMes);

        if (!dadosAgrupados[p.indicador_nome]) {
            dadosAgrupados[p.indicador_nome] = {};
        }

        dadosAgrupados[p.indicador_nome][chaveMes] = {
            valor: p.valor_realizado,
            meta: p.meta,
            status: calcularStatus(p.valor_realizado, p.meta ?? 0, p.tipo_meta)
        };
    });

    const mesesOrdenados = Array.from(mesesSet).sort();

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

    // Corpo
    for (const indicador in dadosAgrupados) {
        let row = `<td class="px-4 py-2 font-semibold">${indicador}</td>`;

        mesesOrdenados.forEach(mes => {
            const dados = dadosAgrupados[indicador][mes];
            if (dados) {
                const corStatus = dados.status === "Atingida" ? "text-green-600" :
                                  dados.status === "Não atingida" ? "text-red-600" : "text-gray-600";
                const icone = dados.status === "Atingida" ? "✅" :
                              dados.status === "Não atingida" ? "❌" : "📊";

                row += `
                    <td class="px-4 py-2 border-l border-gray-300">${formatarValor(dados.valor)}</td>
                    <td class="px-4 py-2">${formatarValor(dados.meta)}</td>
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
    if (valor == null) return "Sem dados";
    if (meta == null) return "Meta não definida";

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

function formatarValor(valor) {
    if (valor == null) return "—";
    return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
