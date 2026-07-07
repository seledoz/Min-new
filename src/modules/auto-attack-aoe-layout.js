window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installAutoAttackAoeLayoutFix() {
  const columnId = "minibia-bot-fourth-column";
  const styleId = "minibia-bot-fourth-column-style";

  function installStyle() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #minibia-bot-panel:not([data-collapsed="true"]) {
        width: min(98vw, 1440px) !important;
        max-width: calc(100vw - 12px) !important;
      }
      #minibia-bot-panel[data-collapsed="true"] {
        width: 220px !important;
      }
      #minibia-bot-panel[data-collapsed="true"] .mb-body,
      #minibia-bot-panel .mb-body[hidden] {
        display: none !important;
      }
      #minibia-bot-panel:not([data-collapsed="true"]) .mb-body:not([hidden]) {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) 280px 240px 300px !important;
        gap: 10px !important;
        align-items: start !important;
        overflow: visible !important;
      }
      #minibia-bot-panel .mb-fourth-column {
        display: grid !important;
        gap: 10px !important;
        align-content: start !important;
        min-width: 0 !important;
      }
      #minibia-bot-auto-attack-aoe-section {
        max-height: none !important;
        overflow: visible !important;
        width: 100% !important;
      }
    `;
    document.head.appendChild(style);
  }

  function getPanel() {
    return document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
  }

  function getPanelBody(panel) {
    return panel?.querySelector?.(".mb-body") || null;
  }

  function ensureFourthColumn() {
    const panel = getPanel();
    const body = getPanelBody(panel);
    if (!panel || !body) return null;

    installStyle();

    let column = document.getElementById(columnId);
    if (!column) {
      column = document.createElement("div");
      column.id = columnId;
      column.className = "mb-fourth-column mb-aoe-column";
      body.appendChild(column);
    }

    if (panel.dataset.collapsed === "true" || body.hidden) {
      return column;
    }

    panel.style.maxWidth = "calc(100vw - 12px)";
    panel.style.width = "min(98vw, 1440px)";
    body.style.setProperty("display", "grid", "important");
    body.style.setProperty("grid-template-columns", "minmax(0, 1fr) 280px 240px 300px", "important");
    body.style.setProperty("gap", "10px", "important");
    body.style.setProperty("align-items", "start", "important");
    body.style.setProperty("overflow", "visible", "important");

    return column;
  }

  function moveAoeSectionToFourthColumn() {
    const section = document.getElementById("minibia-bot-auto-attack-aoe-section");
    const column = ensureFourthColumn();
    if (!section || !column) return false;

    if (section.parentElement !== column) {
      column.prepend(section);
    }

    section.style.setProperty("max-height", "none", "important");
    section.style.setProperty("overflow", "visible", "important");
    section.style.setProperty("width", "100%", "important");
    section.dataset.panelColumn = "fourth";
    return true;
  }

  function runLayoutPass() {
    try {
      moveAoeSectionToFourthColumn();
    } catch (error) {
      console.warn("[minibia-bot] AoE layout adjustment failed", error);
    }
  }

  runLayoutPass();
  window.setTimeout(runLayoutPass, 500);
  window.setTimeout(runLayoutPass, 1500);
  window.setTimeout(runLayoutPass, 3000);
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
  window.setTimeout(applySix, 1500);
})();
