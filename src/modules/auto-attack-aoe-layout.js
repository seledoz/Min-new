window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installAutoAttackAoeLayoutFix() {
  const columnId = "minibia-bot-fourth-column";

  function getPanel() {
    return document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
  }

  function getPanelBody(panel) {
    return panel?.querySelector?.(".mb-body") || panel?.querySelector?.(".mb-content") || null;
  }

  function ensureFourthColumn() {
    const panel = getPanel();
    const body = getPanelBody(panel);
    if (!panel || !body) return null;

    let column = document.getElementById(columnId);
    if (!column) {
      column = document.createElement("div");
      column.id = columnId;
      column.className = "mb-column mb-fourth-column";
      column.style.display = "flex";
      column.style.flexDirection = "column";
      column.style.gap = "8px";
      body.appendChild(column);
    }

    body.style.display = "grid";
    body.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";
    body.style.gap = "8px";
    body.style.alignItems = "start";
    body.style.overflow = "visible";
    panel.style.maxWidth = "none";
    panel.style.width = "min(96vw, 1320px)";

    return column;
  }

  function moveAoeSectionToFourthColumn() {
    const section = document.getElementById("minibia-bot-auto-attack-aoe-section");
    const column = ensureFourthColumn();
    if (!section || !column) return false;

    if (section.parentElement !== column) {
      column.insertBefore(section, column.firstChild || null);
    }

    section.style.maxHeight = "none";
    section.style.overflow = "visible";
    section.style.width = "100%";
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
  window.setInterval(tick, 1000);
})();
