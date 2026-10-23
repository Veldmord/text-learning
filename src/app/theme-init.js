// Тема и размер шрифта до первого рендера, чтобы экран не мигал. Встраивается в index.html при сборке,
// в CSP разрешается по SHA-256 (vite.config.ts); ключи совпадают с src/storage/settings.ts.
(function () {
  var theme = 'system';
  var font = 1;
  try {
    var s = JSON.parse(localStorage.getItem('tl.settings') || '{}');
    if (s.theme === 'light' || s.theme === 'dark') theme = s.theme;
    if (typeof s.fontSize === 'number' && s.fontSize >= 0 && s.fontSize <= 3) font = Math.round(s.fontSize);
  } catch {
    // localStorage недоступен — системная тема
  }
  var root = document.documentElement;
  if (theme !== 'system') root.setAttribute('data-theme', theme);
  root.setAttribute('data-font', String(font));
})();
