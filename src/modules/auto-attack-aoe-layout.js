window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installAutoAttackAoeLayoutFix() {
  const columnId = "minibia-bot-fourth-column";
  const styleId = "minibia-bot-fourth-column-style";

  function installStyle() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #minibia-bot-panel {
        width: min(98vw, 1440px) !important;
        max-width: calc(100vw - 12px) !important;
      }
      #minibia-bot-panel[data-collapsed="true"] {
        width: 220px !important;
      }
      #minibia-bot-panel[data-collapsed="true"] .mb-body {
        display: none !important;
      }
      #minibia-bot-panel:not([data-collapsed="true"]) .mb-body {
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

    const isCollapsed = panel.dataset.collapsed === "true";
    panel.style.maxWidth = "calc(100vw - 12px)";
    panel.style.width = isCollapsed ? "220px" : "min(98vw, 1440px)";

    if (isCollapsed) {
      body.style.setProperty("display", "none", "important");
      return column;
    }

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

  function tick() {
    try {
      moveAoeSectionToFourthColumn();
    } catch (error) {
      console.warn("[minibia-bot] AoE layout adjustment failed", error);
    }
  }

  tick();
  window.setTimeout(tick, 0);
  window.setTimeout(tick, 500);
  window.setTimeout(tick, 1500);
  window.setInterval(tick, 1000);

  const observer = new MutationObserver(tick);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
})();

(function forceNormalAutoAttackRangeSix() {
  const storageKey = "minibiaBot.attack.config";

  function persistSix() {
    try {
      const rawValue = window.localStorage.getItem(storageKey);
      const config = rawValue ? JSON.parse(rawValue) : {};
      if (config.maxTargetDistance !== 6) {
        config.maxTargetDistance = 6;
        window.localStorage.setItem(storageKey, JSON.stringify(config));
      }
    } catch (error) {}
  }

  function applySix() {
    try {
      persistSix();
      const attackConfig = window.minibiaBot?.attack?.config;
      if (attackConfig && attackConfig.maxTargetDistance !== 6) {
        attackConfig.maxTargetDistance = 6;
      }
    } catch (error) {}
  }

  applySix();
  window.setTimeout(applySix, 0);
  window.setTimeout(applySix, 500);
  window.setTimeout(applySix, 1500);
  window.setInterval(applySix, 1000);
})();
