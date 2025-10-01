// =============================
// 🔹 Estado Global
// =============================
let preenchimentosRealizados = new Set();
let indicadorSelecionado = null;

// IDs de setores do usuário logado (gestor)
let __setoresUsuarioIds = new Set();      // Number
let __setoresUsuarioIdsStr = new Set();   // String (espelha os mesmos IDs)

// 🔹 NOVO: conjunto de (indicador_mes_ano) que JÁ têm preenchimento ≠ '-'
let __preenchidosQualquerUsuario = new Set();

// =============================
// 🔹 Helpers
// =============================

// Extrai o ID do setor de um item do endpoint de pendentes, tolerando formatos diferentes
function extrairSetorIdDoItem(item) {
  const candidatos = [
    item?.setor,
    item?.setor?.id,
    item?.indicador_setor,
    item?.indicador?.setor,
    item?.indicador?.setor?.id,
  ];

  for (const c of candidatos) {
    if (c !== undefined && c !== null && c !== "") return c;
  }
  return null;
}

// -------------------- NOVOS HELPERS (periodicidade) --------------------
function normalizarPeriodicidade(raw) {
  // aceita 1/2/3/6/12, "mensal", "bimestral", "trimestral", "semestral", "anual"
  if (raw == null) return 1;
  if (typeof raw === 'number') return Math.max(1, raw || 1);
  const s = String(raw).trim().toLowerCase();
  if (/^\d+$/.test(s)) return Math.max(1, parseInt(s, 10));
  if (s.includes('bimes')) return 2;
  if (s.includes('trimes')) return 3;
  if (s.includes('semes')) return 6;
  if (s.includes('anual')) return 12;
  return 1; // padrão mensal
}

function extrairMesInicial(obj) {
  // Aceita: Date, "YYYY-MM", "YYYY-MM-DD", número 1..12
  const candidatos = [
    obj?.mes_inicial, obj?.mes_inicio, obj?.mes_referencia,
    obj?.mes_base, obj?.mes_inicial_referencia
  ];
  for (const c of candidatos) {
    if (c == null) continue;

    // número direto (1..12)
    if (typeof c === 'number' && c >= 1 && c <= 12) return c;

    const s = String(c).trim();
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) {
      // "YYYY-MM" ou "YYYY-MM-DD"
      const parts = s.split('-');
      return parseInt(parts[1], 10); // mês 1..12
    }
  }
  return 1; // fallback: janeiro
}

// 🔹 NOVO: extrair janela completa (YYYY-MM) para usar como corte
function extrairJanela(obj) {
  // Retorna { inicioYM: "YYYY-MM" | null, fimYM: "YYYY-MM" | null }
  const toYM = (val) => {
    if (val == null) return null;
    const s = String(val).trim();
    if (/^\d{4}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7); // YYYY-MM
    return null;
  };
  return {
    inicioYM: toYM(obj?.mes_inicial),
    fimYM: toYM(obj?.mes_final)
  };
}

function mesPertenceAoCalendario(mes, mesInicial, passoMeses) {
  // Ex.: passo=2 e mesInicial=1 => meses válidos: 1,3,5,7,9,11
  if (!Number.isFinite(mes) || !Number.isFinite(mesInicial) || !Number.isFinite(passoMeses)) return true;
  const diff = ((mes - mesInicial) % passoMeses + passoMeses) % passoMeses;
  return diff === 0;
}

// Helpers YM
function toYMStr(ano, mes) { return `${String(ano).padStart(4,'0')}-${String(mes).padStart(2,'0')}`; }
function ymToInt(ym) {               // "YYYY-MM" ->  YYYY*100 + MM
  if (!ym) return null;
  const [y, m] = ym.split('-').map(Number);
  return y * 100 + m;
}
function inJanela(ano, mes, inicioYM, fimYM) {
  const cur = ano * 100 + mes;
  const i = ymToInt(inicioYM);
  const f = ymToInt(fimYM);
  if (i != null && cur < i) return false;
  if (f != null && cur > f) return false;
  return true;
}

// Mapa: id do indicador -> { passoMeses, mesInicial, inicioYM, fimYM }
const __mapaConfigsIndicadores = new Map();

async function montarMapaConfigIndicadores(pendentes) {
  __mapaConfigsIndicadores.clear();
  const ids = [...new Set(pendentes.map(p => p.id))];

  const token = localStorage.getItem('access');
  const res = await fetch(`${window.API_BASE_URL}/api/indicadores/`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    console.warn('Falha ao buscar indicadores p/ periodicidade; assumindo mensal.');
    ids.forEach(id => __mapaConfigsIndicadores.set(id, {
      passoMeses: 1, mesInicial: 1, inicioYM: null, fimYM: null
    }));
    return;
  }
  const payload = await res.json();
  const todos = asList(payload);
  const porId = new Map(todos.map(x => [x.id, x]));

  ids.forEach(id => {
    const ind = porId.get(id) || {};
    const passoMeses = normalizarPeriodicidade(
      ind.periodicidade ?? ind.periodicidade_meses ?? ind.periodicidade_num
    );
    const mesInicial = extrairMesInicial(ind);
    const { inicioYM, fimYM } = extrairJanela(ind);
    __mapaConfigsIndicadores.set(id, { passoMeses, mesInicial, inicioYM, fimYM });
  });
}

function normalizeDecimalString(s) {
  if (s == null) return '';
  let v = ('' + s).trim().replace(/[R$\s%]/g, '');
  // "1.234,56" -> "1234.56"
  if (v.includes(',') && /\.\d{3}/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else if (v.includes(',')) v = v.replace(',', '.');
  return v;
}

function validarArquivo(arquivo) {
  const maxBytes = 2 * 1024 * 1024; // 2MB
  const okExt = ['pdf','jpg','jpeg','png','xlsx'];
  if (arquivo.size > maxBytes) throw new Error("O arquivo é muito grande. Máximo permitido: 2MB.");
  const ext = (arquivo.name.split('.').pop() || '').toLowerCase();
  if (!okExt.includes(ext)) throw new Error("Extensão de arquivo não permitida (PDF/JPG/PNG/XLSX).");
}

function montarFormDataSeguro() {
  if (!indicadorSelecionado) throw new Error("Indicador não selecionado.");

  const valorRaw = document.getElementById('valor').value;
  if (valorRaw == null || String(valorRaw).trim() === '') {
    // Se quiser permitir pendente (sem valor), remova esta validação
    throw new Error("Preencha o valor.");
  }

  const valorNorm = normalizeDecimalString(valorRaw);
  if (valorNorm === '' || Number.isNaN(Number(valorNorm))) {
    throw new Error("Valor inválido. Use 1234,56 ou 1234.56.");
  }

  const comentario = document.getElementById('comentario').value?.trim();
  const origem = document.getElementById('origem').value?.trim();
  const arquivo = document.getElementById('provas').files[0];
  if (arquivo) validarArquivo(arquivo);

  const fd = new FormData();
  // indicador/mes/ano vão via resolve-id (não precisa enviar de novo aqui)
  fd.append('valor_realizado', valorNorm); // "1234.56"
  if (comentario) fd.append('comentario', comentario);
  if (origem) fd.append('origem', origem);
  if (arquivo) fd.append('arquivo', arquivo, arquivo.name);

  return fd;
}

async function extrairErroHttp(res) {
  let payload = null, text = null;
  try { payload = await res.clone().json(); } catch {}
  if (!payload) { try { text = await res.clone().text(); } catch {} }

  const raw = payload || text || null;
  let msg = `Falha (${res.status})`;

  if (payload) {
    if (typeof payload.detail === 'string') {
      msg = payload.detail;
    } else {
      try {
        const flat = Object.values(payload).flat().join('\n');
        if (flat) msg = flat;
      } catch {
        msg = JSON.stringify(payload);
      }
    }
  } else if (typeof text === 'string' && text.trim()) {
    msg = text.length > 200 ? text.slice(0, 200) + '...' : text;
  }

  // normalizações úteis
  if (/Já existe preenchimento/i.test(msg)) {
    msg = "Já existe preenchimento para este indicador/mês/ano por este usuário.";
  }
  if (/Extens[aã]o de arquivo n[aã]o permitida/i.test(msg)) {
    msg = "Extensão de arquivo não permitida (apenas PDF/JPG/PNG/XLSX).";
  }
  return { message: msg, raw };
}

async function resolverPreenchimentoId(indicadorId, mes, ano, origem = 'manual') {
  const token = localStorage.getItem('access');
  const res = await fetch(`${window.API_BASE_URL}/api/preenchimentos/resolve-id/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ indicador: indicadorId, mes, ano, origem })
  });
  if (!res.ok) {
    const { message, raw } = await extrairErroHttp(res);
    console.error('Falha no resolve-id:', raw);
    throw new Error(message || 'Falha ao resolver ID do preenchimento.');
  }
  const data = await res.json();
  return data?.id;
}

function valorFoiPreenchido(valor) {
  if (valor === null || valor === undefined) return false;
  const s = String(valor).trim();
  if (s === '' || s === '-') return false;
  return true; // 0, 0.0, '0' são válidos (≠ '-')
}

// Utilitário para lidar com respostas paginadas {results:[]}
function asList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

async function carregarPreenchidosParaPendentes(pendentesDoMeuSetor) {
  __preenchidosQualquerUsuario = new Set();

  // Quais (ano,mes) existem nos pendentes?
  const yms = new Set(
    pendentesDoMeuSetor.map(p => `${p.ano}-${String(p.mes).padStart(2,'0')}`)
  );

  const token = localStorage.getItem('access');
  const base = `${window.API_BASE_URL}/api/preenchimentos/`;

  // Busca por cada (ano,mes) e popula o Set
  const reqs = [...yms].map(async ym => {
    const [ano, mesStr] = ym.split('-');
    const mes = Number(mesStr);
    const url = `${base}?ano=${ano}&mes=${mesStr}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
      console.warn('Falha ao buscar preenchimentos para', ym, res.status);
      return;
    }
    const data = asList(await res.json());
    data.forEach(pr => {
      const indicadorId = typeof pr.indicador === 'object' ? pr.indicador.id : pr.indicador;
      if (indicadorId == null) return;
      if (valorFoiPreenchido(pr.valor_realizado)) {
        const chave = `${indicadorId}_${mes}_${Number(ano)}`;
        __preenchidosQualquerUsuario.add(chave);
      }
    });
  });

  await Promise.all(reqs);
  console.debug('[preenchidos≠"-"]', __preenchidosQualquerUsuario);
}

// =============================
// 🔹 Carregar setores do usuário (IDs)
// =============================
async function carregarUsuarioSetores() {
  const token = localStorage.getItem('access');
  try {
    const res = await fetch(`${window.API_BASE_URL}/api/meu-usuario/`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Erro ao buscar /api/meu-usuario/");

    const user = await res.json();

    // 🔹 PERFIL do usuário (master/gestor/...)
    window.__perfilUsuario = String(user?.perfil || '').toLowerCase();
    window.__ehGestor = (window.__perfilUsuario === 'gestor');

    // Coleta IDs dos setores do usuário (inclui setor_principal como fallback)
    const idsDiretos = (Array.isArray(user?.setores) ? user.setores : [])
      .map(s => s?.id)
      .filter(id => id != null);

    const idPrincipal = user?.setor_principal?.id;

    const ids = [...new Set([
      ...idsDiretos,
      ...(idPrincipal != null ? [idPrincipal] : []),
    ])];

    __setoresUsuarioIds = new Set(ids.map(n => Number(n)));
    __setoresUsuarioIdsStr = new Set(ids.map(String));

    console.debug("[meu-usuario] perfil:", window.__perfilUsuario);
    console.debug("[meu-usuario] setores IDs (Number):", Array.from(__setoresUsuarioIds));
    console.debug("[meu-usuario] setores IDs (String):", Array.from(__setoresUsuarioIdsStr));
  } catch (e) {
    console.error("Falha ao carregar setores do usuário:", e);
    window.__perfilUsuario = undefined;
    window.__ehGestor = false;
    __setoresUsuarioIds = new Set();
    __setoresUsuarioIdsStr = new Set();
  }
}

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

    // 🔹 Limpa e repopula conforme a regra
    preenchimentosRealizados = new Set();

    // Apenas quando o usuário logado for GESTOR é que removemos meses da tela
    if (!window.__ehGestor) {
      console.debug("Usuário não é gestor — não filtra por preenchimentos próprios.");
      return;
    }

    data.forEach(item => {
      const indicadorId = typeof item.indicador === 'object' ? item.indicador.id : item.indicador;
      const chave = `${indicadorId}_${item.mes}_${item.ano}`;
      preenchimentosRealizados.add(chave);
    });

    console.log("✔️ Preenchimentos (do gestor) carregados:", preenchimentosRealizados);

  } catch (err) {
    console.error("Erro ao carregar preenchimentos:", err);
    preenchimentosRealizados = new Set();
  }
}

// =============================
// 🔹 Carregar indicadores pendentes (apenas dos setores do gestor)
// =============================
async function carregarIndicadores() {
  const token = localStorage.getItem('access');

  try {
    // 🔄 Fonte certa: pendentes de PREENCHIMENTO (gera “-” na virada do mês)
    const res = await fetch(`${window.API_BASE_URL}/api/preenchimentos/pendentes/`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error("Erro ao buscar indicadores pendentes");
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Resposta inválida (esperado array)");

    // Payload vem como Preenchimento; normaliza p/ {id,nome,descricao,setor,ano,mes}
    const normalizados = data.map(pr => {
      const ind = typeof pr.indicador === 'object' ? pr.indicador : { id: pr.indicador };
      return {
        id: ind.id,
        nome: ind.nome || pr.indicador_nome || 'Indicador',
        descricao: ind.extracao_indicador || ind.descricao || '',
        setor: ind.setor?.id ?? ind.setor ?? pr.setor_id ?? null,
        ano: pr.ano,
        mes: pr.mes,
      };
    });

    // Amostra de payload para debug
    console.debug("[pendentes(preenchimentos)] amostra normalizada:", normalizados.slice(0, 3));

    if (__setoresUsuarioIds.size === 0 && __setoresUsuarioIdsStr.size === 0) {
      console.warn("Usuário sem IDs de setor associados. Nada será exibido.");
      renderizarIndicadores([]);
      return;
    }

    // 🔒 Mantém somente itens cujo setor_id pertence aos setores do usuário
    const pendentesDoMeuSetor = normalizados.filter(item => {
      const sid = item.setor;
      return (
        sid != null &&
        ( __setoresUsuarioIds.has(Number(sid)) || __setoresUsuarioIdsStr.has(String(sid)) )
      );
    });

    if (pendentesDoMeuSetor.length === 0) {
      console.warn("[pendentes] vazio após filtro. Exemplo do set:", normalizados.slice(0, 5));
    }

    // ✅ Se você quer APENAS esconder o que JÁ tem valor (qualquer usuário), mantenha:
    await carregarPreenchidosParaPendentes(pendentesDoMeuSetor);

    // 🔹 Agrupar por indicador (sem bloquear por janela/passo — o backend já gera só meses válidos)
    const agrupados = {};
    pendentesDoMeuSetor.forEach(item => {
      const jaTemQualquerPreench =
        __preenchidosQualquerUsuario.has(`${item.id}_${item.mes}_${item.ano}`);
      if (jaTemQualquerPreench) return;

      const chave = `${item.id}`;
      if (!agrupados[chave]) {
        agrupados[chave] = {
          id: item.id,
          nome: item.nome,
          descricao: item.descricao,
          pendencias: []
        };
      }
      agrupados[chave].pendencias.push({ mes: item.mes, ano: item.ano });
    });

    // 🔹 NOVO: ordenar pendências por ano asc, depois mês asc
    Object.values(agrupados).forEach(gr => {
      gr.pendencias.sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes));
    });

    const listaFiltrada = Object.values(agrupados).filter(x => x.pendencias.length > 0);
    renderizarIndicadores(listaFiltrada);

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

  if (!Array.isArray(lista) || lista.length === 0) {
    container.innerHTML = `
      <div class="p-4 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded">
        Nenhum indicador pendente para seus setores.
      </div>`;
    return;
  }

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
          onclick="abrirModal(${indicador.id}, '${indicador.nome.replace(/'/g, "\\'")}', ${p.mes}, ${p.ano})"
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
let __isSubmitting = false;

document.getElementById('formPreenchimento').addEventListener('submit', async function (e) {
  e.preventDefault();
  if (__isSubmitting) return;
  __isSubmitting = true;

  const submitBtn = this.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  const token = localStorage.getItem('access');

  try {
    // monta FormData (normaliza número, valida arquivo, evita campos vazios)
    const formData = montarFormDataSeguro();

    // 1) resolve (ou cria) o ID do preenchimento para (indicador, mes, ano)
    const id = await resolverPreenchimentoId(
      indicadorSelecionado.id,
      indicadorSelecionado.mes,
      indicadorSelecionado.ano
    );

    // 2) PATCH no recurso específico
    const res = await fetch(`${window.API_BASE_URL}/api/preenchimentos/${id}/`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}` }, // NÃO definir Content-Type
      body: formData
    });

    if (!res.ok) {
      const { message, raw } = await extrairErroHttp(res);
      console.error('Falha no PATCH /preenchimentos/{id}:', raw);
      throw new Error(message);
    }

    alert('Preenchimento salvo com sucesso!');
    fecharModal();

    // Atualiza UI
    await carregarPreenchimentos();
    await carregarIndicadores();

  } catch (err) {
    console.error("Erro detalhado:", err);
    alert("Erro ao salvar o preenchimento:\n" + (err?.message || 'Falha desconhecida'));
  } finally {
    __isSubmitting = false;
    if (submitBtn) submitBtn.disabled = false;
  }
});

// =============================
// 🔹 Inicialização
// =============================
window.onload = async () => {
  await carregarUsuarioSetores();   // 1) saber setores do usuário
  await carregarPreenchimentos();   // 2) o que já foi preenchido
  await carregarIndicadores();      // 3) filtra e mostra pendentes
};
