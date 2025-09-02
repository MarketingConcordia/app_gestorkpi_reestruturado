// 🔹 Estado compartilhado
let preenchimentosRealizados = new Set();
let indicadorSelecionado = null;

// 🔸 Carregar preenchimentos realizados pelo usuário logado
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

// 🔸 Carregar indicadores pendentes (exceto os já preenchidos)
function carregarIndicadores() {
  const token = localStorage.getItem('access');

  fetch(`${window.API_BASE_URL}/api/indicadores/pendentes/`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
    .then(res => {
      if (!res.ok) throw new Error("Erro ao buscar indicadores");
      return res.json();
    })
    .then(data => {
      if (!Array.isArray(data)) throw new Error("Resposta inválida (esperado array)");

      const container = document.getElementById('indicadores-container');
      container.innerHTML = '';

      const hoje = new Date();
      const mesAtual = hoje.getMonth() + 1;
      const anoAtual = hoje.getFullYear();

      data.forEach(indicador => {
        const mes = indicador.mes;
        const ano = indicador.ano;
        const chave = `${indicador.id}_${mes}_${ano}`;

        if (!preenchimentosRealizados.has(chave)) {
          const div = document.createElement('div');
          div.className = "bg-white p-4 rounded shadow-md";

          div.innerHTML = `
          <div class="bg-white shadow-md border-l-4 border-yellow-400 p-4 rounded-lg flex flex-col gap-3">
              <div class="flex items-start justify-between">
                <div>
                  <h3 class="text-base font-semibold text-gray-800">${indicador.nome}</h3>
                  <p class="text-sm text-gray-500">${indicador.descricao || ''}</p>
                </div>
                <div class="text-yellow-500">
                  <i class="fas fa-exclamation-triangle text-xl"></i>
                </div>
              </div>

              <div class="bg-yellow-100 text-yellow-800 px-3 py-2 rounded-md text-sm flex items-center gap-2">
                <i class="fas fa-clock"></i>
                <span>Preenchimento pendente de <strong>${String(mes).padStart(2, '0')}/${ano}</strong></span>
              </div>

              <div class="flex justify-end">
                <button 
                  onclick='abrirModal(${JSON.stringify(indicador)})'
                  class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-all duration-200"
                >
                  Preencher
                </button>
              </div>
          </div>
          `;

          document.getElementById('indicadores-container').appendChild(div);
        }
      });
    })
    .catch(error => {
      console.error('Erro ao carregar indicadores:', error);
    });
}

// 🔸 Abrir modal de preenchimento
function abrirModal(indicador) {
    indicadorSelecionado = indicador;
    document.getElementById('titulo-indicador').innerText = `Preencher - ${indicador.nome}`;
    document.getElementById('modal-preencher').classList.remove('hidden');

    // Limpar campos
    document.getElementById('valor').value = '';
    document.getElementById('comentario').value = '';
    document.getElementById('origem').value = '';
    document.getElementById('provas').value = '';

    // Definir MÊS/ANO conforme o indicador pendente (e bloquear edição)
    const mes = String(indicador.mes).padStart(2, '0');
    const ano = indicador.ano;
    document.getElementById('mes').value = `${mes}/${ano}`;
    document.getElementById('mes').disabled = true;
}


// 🔸 Fechar modal
function fecharModal() {
  document.getElementById('modal-preencher').classList.add('hidden');
}

// 🔸 Submissão do preenchimento
document.getElementById('formPreenchimento').addEventListener('submit', async function (e) {
    e.preventDefault();

    const token = localStorage.getItem('access');
    const valor = document.getElementById('valor').value;
    const mesAno = document.getElementById('mes').value;
    const comentario = document.getElementById('comentario').value;
    const arquivo = document.getElementById('provas').files[0];
    // ✅ Verificar se o arquivo excede 2MB
    if (arquivo && arquivo.size > 2 * 1024 * 1024) {
        alert("O arquivo é muito grande. O tamanho máximo permitido é 2MB.");
        return;
    }
    const origem = document.getElementById('origem').value;

    if (!indicadorSelecionado || !valor || !mesAno) {
        alert("Preencha os campos obrigatórios.");
        return;
    }

    const [mes, ano] = mesAno.split('/');

    const formData = new FormData();
    formData.append('indicador', parseInt(indicadorSelecionado.id || indicadorSelecionado.indicador));
    formData.append('valor_realizado', valor);
    formData.append('mes', parseInt(mes));
    formData.append('ano', parseInt(ano));

    if (comentario) formData.append('comentario', comentario);        
    if (origem) formData.append('origem', origem);                     
    if (arquivo) formData.append('arquivo', arquivo);                 

    try {
        const response = await fetch(`${window.API_BASE_URL}/api/preenchimentos/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (!response.ok) {
          let mensagemErro = "Erro ao salvar o preenchimento.";

          const clone = response.clone(); // ✅ clone a resposta antes de ler
          try {
            const erro = await response.json();
            console.error("⚠️ Erro da API:", erro);
            mensagemErro = Object.values(erro).flat().join('\n');
          } catch (e) {
            const texto = await clone.text(); // ✅ use o clone para .text()
            console.error("⚠️ Erro HTML da API:", texto);
            mensagemErro = "Erro interno no servidor (500). Verifique os logs do Django.";
          }

          throw new Error(mensagemErro);
        }

        alert('Preenchimento salvo com sucesso!');
        fecharModal();
        await carregarPreenchimentos();
        carregarIndicadores();

    } catch (error) {
      console.error("Erro detalhado:", error);
      alert("Erro ao salvar o preenchimento:\n" + error.message);
    }

});


// 🔸 Iniciar carregamento ao abrir a página
window.onload = async () => {
  await carregarPreenchimentos();
  carregarIndicadores();
};