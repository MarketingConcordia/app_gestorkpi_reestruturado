// 1) Token (único item vindo do localStorage)
const token = localStorage.getItem("access");
if (!token) {
  window.location.href = "login.html";
}

// 2) Base única da API, sem duplicar /api
const __BASE = String(window.API_BASE_URL || "").replace(/\/+$/, "");
const apiBase = __BASE.endsWith("/api") ? __BASE : `${__BASE}/api`;

// 3) Helpers
const $ = (id) => document.getElementById(id);

// DRF: normaliza resposta paginada ou não
function asList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

// Busca paginada genérica (segue `next`)
async function fetchAll(url) {
  const out = [];
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    out.push(...asList(data));
    url = data.next || null;
  }
  return out;
}

// Formata data/hora dd/mm/yyyy hh:mm
function formatarData(isoString) {
  if (!isoString) return "-";
  const data = new Date(isoString);
  if (isNaN(data.getTime())) return "-";
  const dd = String(data.getDate()).padStart(2, "0");
  const mm = String(data.getMonth() + 1).padStart(2, "0");
  const yyyy = data.getFullYear();
  const hh = String(data.getHours()).padStart(2, "0");
  const min = String(data.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// 4) Preenchimentos iniciais
document.addEventListener("DOMContentLoaded", () => {
  // Esconde a tabela inicialmente
  const tabela = $("tabela-logs");
  if (tabela) tabela.style.display = "none";

  // Carrega filtros:
  carregarUsuarios();
  carregarSetores();

  // Botão aplicar
  const btn = $("btn-aplicar-filtros");
  if (btn) btn.addEventListener("click", carregarLogsComFiltros);

  // 🔎 NOVO: Enter no campo de indicador aplica os filtros
  $("filtro-indicador-nome")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      $("btn-aplicar-filtros")?.click();
    }
  });
});

// 5) Filtros: usuários
async function carregarUsuarios() {
  try {
    const url = `${apiBase}/usuarios/?page_size=200`;
    const usuarios = await fetchAll(url);

    const select = $("filtro-usuario");
    if (!select) return;
    select.innerHTML = `<option value="todos">Todos</option>`;

    usuarios.forEach((user) => {
      const nome = user.first_name || user.username || `id:${user.id}`;
      const opt = document.createElement("option");
      opt.value = user.id;
      opt.textContent = nome;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("Erro ao carregar usuários:", err);
  }
}

// 6) Filtros: setores
async function carregarSetores() {
  try {
    const url = `${apiBase}/setores/?page_size=200`;
    const setores = await fetchAll(url);

    const select = $("filtro-setor");
    if (!select) return;
    select.innerHTML = `<option value="todos">Todos</option>`;

    setores.forEach((setor) => {
      const opt = document.createElement("option");
      opt.value = setor.id;
      opt.textContent = setor.nome;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("Erro ao carregar setores:", err);
  }
}

// 7) Carrega logs com base nos filtros
async function carregarLogsComFiltros() {
  const btn = $("btn-aplicar-filtros");
  if (btn) {
    btn.disabled = true;
    btn.dataset._old = btn.textContent;
    btn.textContent = "Carregando...";
  }

  try {
    const usuario = $("filtro-usuario")?.value || "todos";
    const setor = $("filtro-setor")?.value || "todos";
    const dataInicio = $("filtro-data-inicio")?.value || "";
    const dataFim = $("filtro-data-fim")?.value || "";
    const indicadorNome = ($("filtro-indicador-nome")?.value || "").trim();

    // Validação simples de datas
    if (dataInicio && dataFim) {
      const di = new Date(dataInicio);
      const df = new Date(dataFim);
      if (di > df) {
        alert("A data inicial não pode ser maior que a data final.");
        return;
      }
    }

    const params = new URLSearchParams();
    if (usuario && usuario !== "todos") params.append("usuario", usuario);
    if (setor && setor !== "todos") params.append("setor", setor);
    if (dataInicio) params.append("data_inicio", dataInicio);
    if (dataFim) params.append("data_fim", dataFim);
    if (indicadorNome) params.append("indicador_nome", indicadorNome);
    params.append("page_size", "200");

    let url = `${apiBase}/logs/?${params.toString()}`;
    const logs = await fetchAll(url);

    renderizarLogs(logs);

    // Mostra a tabela só agora
    const tabela = $("tabela-logs");
    if (tabela) tabela.style.display = "table";
  } catch (err) {
    console.error("Erro ao aplicar filtros:", err);
    alert("Erro ao aplicar os filtros.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset._old || "Aplicar Filtros";
      delete btn.dataset._old;
    }
  }
}

// 8) Render
function renderizarLogs(logs) {
  const tbody = $("listaLogs");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="text-center text-gray-500 py-4">
          Nenhum log encontrado com os filtros selecionados.
        </td>
      </tr>
    `;
    // contador (se existir)
    const counter = $("contador-logs");
    if (counter) counter.textContent = "( 0 registros )";
    return;
  }

  logs.forEach((log) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm text-gray-900">${log.usuario_nome || "-"}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${log.acao || "-"}</td>
      <td class="px-4 py-2 text-sm text-gray-500">${formatarData(log.data)}</td>
    `;
    tbody.appendChild(tr);
  });

  // contador (se existir)
  const counter = $("contador-logs");
  if (counter) counter.textContent = `( ${logs.length} registros )`;
}