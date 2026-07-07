window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installAutoAttackAoeLayoutFix() {
  const layoutId = "minibia-bot-auto-attack-aoe-layout";

  function moveEnergyWaveBesideAoe() {
    const section = document.getElementById("minibia-bot-auto-attack-aoe-section");
    if (!section || section.dataset.energyWaveLayout === "beside") return false;

    const stack = section.querySelector(":scope > .mb-stack") || section.querySelector(".mb-stack");
    const waveEnabled = document.getElementById("minibia-bot-energy-wave-enabled");
    const energySection = waveEnabled?.closest?.(".mb-section");
    if (!stack || !energySection) return false;

    const title = section.querySelector(":scope > .mb-label");
    const enableToggle = document.getElementById("minibia-bot-auto-attack-aoe-enabled")?.closest?.(".mb-toggle");
    const squareHotkey = document.getElementById("minibia-bot-auto-attack-aoe-hotkey");
    const squareGrid = squareHotkey?.closest?.(".mb-field-grid");
    const requireAttack = document.getElementById("minibia-bot-auto-attack-aoe-require-attack")?.closest?.(".mb-toggle");
    const filters = document.getElementById("minibia-bot-auto-attack-aoe-respect-filters")?.closest?.(".mb-toggle");
    const status = document.getElementById("minibia-bot-auto-attack-aoe-status");

    const layout = document.createElement("div");
    layout.id = layoutId;
    layout.style.display = "grid";
    layout.style.gridTemplateColumns = "minmax(0, 1fr) minmax(0, 1fr)";
    layout.style.gap = "10px";
    layout.style.alignItems = "start";

    const squarePane = document.createElement("div");
    squarePane.className = "mb-stack";
    squarePane.id = "minibia-bot-square-aoe-pane";

    const wavePane = document.createElement("div");
    wavePane.className = "mb-stack";
    wavePane.id = "minibia-bot-energy-wave-pane";

    [enableToggle, squareGrid, requireAttack, filters, status].forEach((node) => {
      if (node) squarePane.appendChild(node);
    });
    wavePane.appendChild(energySection);

    layout.appendChild(squarePane);
    layout.appendChild(wavePane);

    stack.replaceChildren(layout);
    if (title) section.insertBefore(title, stack);

    section.dataset.energyWaveLayout = "beside";
    section.style.maxHeight = "none";
    section.style.overflow = "visible";

    const panel = document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
    const body = panel?.querySelector?.(".mb-body");
    if (body) {
      body.style.alignItems = "start";
    }

    return true;
  }

  function tick() {
    try {
      moveEnergyWaveBesideAoe();
    } catch (error) {
      // Layout-only helper: never break the bot if the panel changes.
      console.warn("[minibia-bot] AoE layout adjustment failed", error);
    }
  }

  tick();
  window.setInterval(tick, 1000);
})();
