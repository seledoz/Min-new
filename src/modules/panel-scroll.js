window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(() => {
  const styleId = "minibia-bot-panel-scroll-style";

  document.getElementById(styleId)?.remove();

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    #minibia-bot-panel {
      box-sizing: border-box;
      max-height: calc(100vh - 32px);
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }
  `;

  (document.head || document.documentElement).appendChild(style);
})();
