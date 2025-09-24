// =============================
// 🔹 Estado Global
// =============================
let preenchimentosRealizados = new Set();
let indicadorSelecionado = null;

// IDs de setores do usuário logado (gestor)
let __setoresUsuarioIds = new Set();      // Number
let __setoresUsuarioIdsStr = new Set();   // String (espelha os mesmos IDs)

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

    console.debug("[meu-usuario] setores IDs (Number):", Array.from(__setoresUsuarioIds));
    console.debug("[meu-usuario] setores IDs (String):", Array.from(__setoresUsuarioIdsStr));
  } catch (e) {
    console.error("Falha ao carregar setores do usuário:", e);
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

    data.forEach(item => {
      const indicadorId = typeof item.indicador === 'object' ? item.indicador.id : item.indicador;
      const chave = `${indicadorId}_${item.mes}_${item.ano}`;
      preenchimentosRealizados.add(chave);
    });

    console.log("✔️ Preenchimentos carregados:", preenchimentosRealizados);

  } catch (err) {
    console.error("Erro ao carregar preenchimentos:", err);
  }
}

// =============================
// 🔹 Carregar indicadores pendentes (apenas dos setores do gestor)
// =============================
async function carregarIndicadores() {
  const token = localStorage.getItem('access');

  try {
    const res = await fetch(`${window.API_BASE_URL}/api/indicadores/pendentes/`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error("Erro ao buscar indicadores pendentes");
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Resposta inválida (esperado array)");

    // Amostra de payload para debug
    console.debug("[pendentes] amostra bruta:", data.slice(0, 3));

    if (__setoresUsuarioIds.size === 0 && __setoresUsuarioIdsStr.size === 0) {
      console.warn("Usuário sem IDs de setor associados. Nada será exibido.");
      renderizarIndicadores([]);
      return;
    }

    // 🔒 Mantém somente itens cujo setor_id pertence aos setores do usuário (comparando número OU string)
    const pendentesDoMeuSetor = data.filter(item => {
      const sid = extrairSetorIdDoItem(item);
      return (
        sid != null &&
        ( __setoresUsuarioIds.has(Number(sid)) || __setoresUsuarioIdsStr.has(String(sid)) )
      );
    });

    // Se vier vazio, loga um diagnóstico
    if (pendentesDoMeuSetor.length === 0) {
      console.warn("[pendentes] vazio após filtro. Mapeando setor_id detectado nos primeiros itens:");
      data.slice(0, 10).forEach((it, idx) => {
        const sid = extrairSetorIdDoItem(it);
        console.warn(`  #${idx}`, {
          setor_detectado: sid,
          pertenceAoUsuario:
            sid != null &&
            ( __setoresUsuarioIds.has(Number(sid)) || __setoresUsuarioIdsStr.has(String(sid)) )
        });
      });
    }

    // 🔹 Agrupar por indicador
    const agrupados = {};
    pendentesDoMeuSetor.forEach(item => {
      const chave = `${item.id}`;
      if (!agrupados[chave]) {
        agrupados[chave] = {
          id: item.id,
          nome: item.nome,
          descricao: item.descricao,
          pendencias: []
        };
      }
      agrupados[chave].pendencias.push({
        mes: item.mes,
        ano: item.ano
      });
    });

    renderizarIndicadores(Object.values(agrupados));

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
