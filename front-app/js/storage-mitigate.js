/* Bloqueia localStorage para dados grandes e roteia para memória em tempo de execução */
(function () {
  const ALLOW_SMALL_KEYS = new Set([
    'access', 'refresh', 'perfil_usuario', 'tema', 'sidebar_collapsed'
  ]);
  const MAX_SIZE = 8192; // 8KB ~ strings grandes viram memória

  const mem = {}; // nosso armazenamento em memória
  const orig = {
    setItem: localStorage.setItem.bind(localStorage),
    getItem: localStorage.getItem.bind(localStorage),
    removeItem: localStorage.removeItem.bind(localStorage),
    clear: localStorage.clear.bind(localStorage)
  };

  localStorage.setItem = function (key, value) {
    const val = typeof value === 'string' ? value : String(value);
    const isLarge = val.length > MAX_SIZE || !ALLOW_SMALL_KEYS.has(key);

    if (isLarge) {
      mem[key] = val; // guarda só em memória (perde ao recarregar a página)
      console.warn('[storage] dado roteado para memória (não salvo em localStorage):', key);
      return;
    }
    return orig.setItem(key, val);
  };

  localStorage.getItem = function (key) {
    if (key in mem) return mem[key];
    return orig.getItem(key);
  };

  localStorage.removeItem = function (key) {
    if (key in mem) delete mem[key];
    return orig.removeItem(key);
  };

  // Exponha memória p/ debug opcional
  window.__MEMSTORE__ = mem;
})();