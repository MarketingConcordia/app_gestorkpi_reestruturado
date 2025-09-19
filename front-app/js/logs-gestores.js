const token = localStorage.getItem("access");
if (!token) { window.location.href = "login.html"; }

// Base única para a API (sem duplicar /api)
const __BASE = String(window.API_BASE_URL || "").replace(/\/+$/, "");
const apiBase = __BASE.endsWith("/api") ? __BASE : `${__BASE}/api`;

// Normaliza resposta DRF (paginada ou lista simples)
function asList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

document.addEventListener("DOMContentLoaded", () => {
  // Esconde a tabela inicialmente (se existir)
  const tabela = document.getElementById("tabela-logs");
  if (tabela) tabela.style.display = "none";

  // Só carrega e mostra depois de aplicar os filtros
  const btn = document.getElementById("btn-aplicar-filtros");
  if (btn) btn.addEventListener("click", carregarLogsDoGestor);

  // ✅ NOVO: Enter no filtro por nome do indicador
  const inputIndicador = document.getElementById("filtro-indicador-nome");
  if (inputIndicador) {
    inputIndicador.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        carregarLogsDoGestor();
      }
    });
  }
});

// 🔸 Carrega apenas os logs do gestor autenticado
async function carregarLogsDoGestor() {
  const dataInicio = document.getElementById("filtro-data-inicio")?.value || "";
  const dataFim = document.getElementById("filtro-data-fim")?.value || "";
  const indicadorNome = document.getElementById("filtro-indicador-nome")?.value.trim() || ""; // ✅ NOVO

  const btn = document.getElementById("btn-aplicar-filtros");
  if (btn) btn.disabled = true;

  try {
    // Monta URL com params e paginação
    const params = new URLSearchParams();
    if (dataInicio) params.append("data_inicio", dataInicio);
    if (dataFim) params.append("data_fim", dataFim);
    if (indicadorNome) params.append("indicador_nome", indicadorNome); // ✅ NOVO
    params.append("page_size", "200");

    let url = `${apiBase}/logs/?${params.toString()}`;
    const acumulado = [];

    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Erro ao carregar logs: ${res.status} ${res.statusText}`);

      const data = await res.json();
      acumulado.push(...asList(data));
      url = data.next || null;
    }

    renderizarLogs(acumulado);

    // Mostra a tabela só agora
    const tabela = document.getElementById("tabela-logs");
    if (tabela) tabela.style.display = "table";

  } catch (err) {
    console.error("Erro ao carregar logs do gestor:", err);
    alert("Erro ao carregar os logs.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderizarLogs(logs) {
  const tbody = document.getElementById("listaLogs");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="text-center text-gray-500 py-4">Nenhum log encontrado.</td>
      </tr>
    `;
    const counter = document.getElementById("contador-logs"); // ✅ NOVO
    if (counter) counter.textContent = `( 0 registros )`;     // ✅ NOVO
    return;
  }

  logs.forEach(log => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-2 text-sm text-gray-900">${log.usuario_nome || "-"}</td>
      <td class="px-4 py-2 text-sm text-gray-700">${log.acao || "-"}</td>
      <td class="px-4 py-2 text-sm text-gray-500">${formatarData(log.data)}</td>
    `;
    tbody.appendChild(tr);
  });

  const counter = document.getElementById("contador-logs");   // ✅ NOVO
  if (counter) counter.textContent = `( ${logs.length} registros )`; // ✅ NOVO
}

function formatarData(isoString) {
  if (!isoString) return "-";
  const data = new Date(isoString);
  if (isNaN(data.getTime())) return "-";
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const ano = data.getFullYear();
  const horas = String(data.getHours()).padStart(2, '0');
  const minutos = String(data.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${ano} ${horas}:${minutos}`;
}