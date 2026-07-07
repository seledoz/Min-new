window.__minibiaBotBundle = window.__minibiaBotBundle || {};

// Safe layout helper: no observers. It retries briefly, then stops.
(function moveAoeIntoFourthColumnSafely() {
  const columnId = "minibia-bot-aoe-column";
  const styleId = "minibia-bot-aoe-column-style";

  function installStyle() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #minibia-bot-panel {
        width: min(98vw, 1260px) !important;
        max-width: calc(100vw - 12px) !important;
      }
      #minibia-bot-panel[data-collapsed="true"] {
        width: 220px !important;
      }
      #minibia-bot-panel .mb-body:not([hidden]) {
        grid-template-columns: minmax(0, 1fr) 280px 240px 280px !important;
      }
      #minibia-bot-panel .mb-aoe-column {
        display: grid !important;
        gap: 10px !important;
        align-content: start !important;
        min-width: 0 !important;
      }
      #minibia-bot-panel #minibia-bot-auto-attack-aoe-section {
        max-height: none !important;
        overflow: visible !important;
      }
      @media (max-width: 760px) {
        #minibia-bot-panel .mb-body:not([hidden]) {
          grid-template-columns: 1fr !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function moveAoeSection() {
    const panel = document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
    const body = panel?.querySelector?.(".mb-body");
    const aoeSection = document.getElementById("minibia-bot-auto-attack-aoe-section");
    if (!panel || !body || !aoeSection) return false;

    installStyle();

    let column = document.getElementById(columnId);
    if (!column) {
      column = document.createElement("div");
      column.id = columnId;
      column.className = "mb-aoe-column";
      body.appendChild(column);
    }

    if (aoeSection.parentElement !== column) {
      column.prepend(aoeSection);
    }

    return true;
  }

  let attempts = 0;
  const retryId = window.setInterval(() => {
    attempts += 1;
    const moved = moveAoeSection();
    if (moved || attempts >= 30) {
      window.clearInterval(retryId);
    }
  }, 1000);

  moveAoeSection();
})();

(function makeGfbStartAoeScanner() {
  function enableAoeScannerForGfb() {
    try {
      const bot = window.minibiaBot;
      const gfbToggle = document.getElementById("minibia-bot-gfb-enabled");
      if (!bot?.attackAoe || !gfbToggle?.checked) return;

      bot.attackAoe.updateConfig?.({ enabled: true, gfbEnabled: true });
      bot.attackAoe.start?.({ enabled: true, gfbEnabled: true });

      const aoeToggle = document.getElementById("minibia-bot-auto-attack-aoe-enabled");
      if (aoeToggle) aoeToggle.checked = true;
    } catch (error) {}
  }

  function attachGfbStartHandler() {
    const gfbToggle = document.getElementById("minibia-bot-gfb-enabled");
    if (!gfbToggle || gfbToggle.dataset.gfbStartHandlerInstalled === "true") return false;
    gfbToggle.dataset.gfbStartHandlerInstalled = "true";
    gfbToggle.addEventListener("change", enableAoeScannerForGfb);
    enableAoeScannerForGfb();
    return true;
  }

  let attempts = 0;
  const retryId = window.setInterval(() => {
    attempts += 1;
    const attached = attachGfbStartHandler();
    if (attached || attempts >= 30) window.clearInterval(retryId);
  }, 1000);

  attachGfbStartHandler();
})();

(function forceNormalAutoAttackRangeSix() {
  const storageKey = "minibiaBot.attack.config";

  function applySix() {
    try {
      const rawValue = window.localStorage.getItem(storageKey);
      const config = rawValue ? JSON.parse(rawValue) : {};
      if (config.maxTargetDistance !== 6) {
        config.maxTargetDistance = 6;
        window.localStorage.setItem(storageKey, JSON.stringify(config));
      }
      const attackConfig = window.minibiaBot?.attack?.config;
      if (attackConfig && attackConfig.maxTargetDistance !== 6) {
        attackConfig.maxTargetDistance = 6;
      }
    } catch (error) {}
  }

  applySix();
  window.setTimeout(applySix, 500);
})();
