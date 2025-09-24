(function () {
  const overlay = document.getElementById('global-loader');
  let active = 0, showTimer = null, hideTimer = null, shownAt = 0;
  const MIN_DELAY = 150;  // ms antes de mostrar (evita piscar em reqs muito rápidas)
  const MIN_SHOW  = 300;  // ms mínimo visível (evita piscar ao sumir)

  function actuallyShow() {
    if (!overlay) return;
    overlay.hidden = false;
    document.documentElement.classList.add('loading');
    shownAt = Date.now();
  }
  function show() {
    if (showTimer || !overlay) return;
    showTimer = setTimeout(() => { showTimer = null; actuallyShow(); }, MIN_DELAY);
  }
  function hide() {
    if (!overlay) return;
    const elapsed = Date.now() - shownAt;
    const wait = Math.max(0, MIN_SHOW - elapsed);
    clearTimeout(showTimer); showTimer = null;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      overlay.hidden = true;
      document.documentElement.classList.remove('loading');
      hideTimer = null;
    }, wait);
  }
  function start() { if (++active === 1) show(); }
  function stop()  { if (active > 0 && --active === 0) hide(); }

  // Patch leve do fetch: conta requests em andamento
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    start();
    try { return await origFetch.apply(this, args); }
    finally { stop(); }
  };

  // Expor helper global
  window.Loader = {
    start, stop,
    withLoading: async (fn) => { try { start(); return await fn(); } finally { stop(); } },
    withButton: async (btn, fn) => {
      if (!btn) return fn();
      try {
        btn.classList.add('is-loading'); btn.disabled = true;
        return await (typeof fn === 'function' ? fn() : fn);
      } finally {
        btn.disabled = false; btn.classList.remove('is-loading');
      }
    }
  };

  // Mostrar loader ao navegar entre páginas (links internos)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const external = a.target === '_blank' || (a.origin && a.origin !== location.origin);
    if (external || a.hasAttribute('data-no-loading')) return;
    // Mostra até a nova página carregar
    overlay.hidden = false;
    document.documentElement.classList.add('loading');
  });

  // Garantir que sumiu quando a página carregou
  window.addEventListener('pageshow', () => { overlay && (overlay.hidden = true); document.documentElement.classList.remove('loading'); });
})();

// front-app/js/loader.js
(function () {
  /**
   * Usa: await btnLoading(botao, () => Promise da ação)
   * - Desabilita, aplica classe is-loading e garante limpeza no finally.
   */
  window.btnLoading = async function (btn, fn) {
    try {
      if (btn) { btn.classList.add('is-loading'); btn.disabled = true; }
      const out = (typeof fn === 'function') ? await fn() : await fn;
      return out;
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
    }
  };
})();
