window.__minibiaBotBundle = window.__minibiaBotBundle || {};

// Safe layout helper: no observers and no repeating layout loops.
// It only runs a few delayed passes after the panel has loaded.
(function moveAoeIntoFourthColumnSafely() {
  const columnId = "minibia-bot-aoe-column";
  const styleId = "minibia-bot-aoe-column-style";

  function installStyle() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #minibia-bot-panel {
        width: min(98vw, 1260px);
      }
      #minibia-bot-panel .mb-body:not([hidden]) {
        grid-template-columns: minmax(0, 1fr) 280px 240px 280px;
      }
      #minibia-bot-panel .mb-aoe-column {
        display: grid;
        gap: 10px;
        align-content: start;
        min-width: 0;
      }
      #minibia-bot-panel #minibia-bot-auto-attack-aoe-section {
        max-height: none;
        overflow: visible;
      }
      @media (max-width: 760px) {
        #minibia-bot-panel .mb-body:not([hidden]) {
          grid-template-columns: 1fr;
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

  window.setTimeout(moveAoeSection, 1000);
  window.setTimeout(moveAoeSection, 2500);
  window.setTimeout(moveAoeSection, 5000);
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
