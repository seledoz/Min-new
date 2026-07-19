(() => {
  const repository = "seledoz/min-new";
  const ref = "main";
  const rawBaseUrl = `https://raw.githubusercontent.com/${repository}/${ref}`;
  const sourceFiles = [
    "src/version.js",
    "src/core.js",
    "src/modules/pz.js",
    "src/modules/xray.js",
    "src/modules/panic.js",
    "src/modules/rune.js",
    "src/modules/heal.js",
    "src/modules/anti-paralyze.js",
    "src/modules/damage-tts-alert.js",
    "src/modules/auto-invisible.js",
    "src/modules/auto-magic-shield.js",
    "src/modules/auto-attack-exclude.js",
    "src/modules/auto-attack.js",
    "src/modules/auto-attack-priority.js",
    "src/modules/auto-attack-rune-cooldown.js",
    "src/modules/auto-attack-rune-retry.js",
    "src/modules/auto-attack-block-follow-while-targeted.js",
    "src/modules/auto-attack-aoe.js",
    "src/modules/auto-attack-gfb.js",
    "src/modules/great-fireball-v2.js",
    "src/modules/auto-attack-aoe-layout.js",
    "src/modules/lure-mode.js",
    "src/modules/aoe-cooldown-input-fix.js",
    "src/modules/low-cap-alarm.js",
    "src/modules/mining.js",
    "src/modules/red-text-alert.js",
    "src/modules/cave.js",
    "src/modules/cave-forward-loop.js",
    "src/modules/cave-arrow-keys.js",
    "src/modules/cave-waypoint-actions.js",
    "src/modules/equip-ring.js",
    "src/modules/auto-eat.js",
    "src/modules/talk.js",
    "src/modules/rune-maker-drop.js",
    "src/modules/rune-maker-drop-modern-ids.js",
    "src/ui/panel.js",
    "src/modules/panel-scroll.js",
    "src/modules/github-waypoint-library.js",
    "src/main.js",
    "src/modules/anti-paralyze-toggle-fix.js",
    "src/modules/player-screen-alert.js",
    "src/modules/auto-attack-keep-distance.js",
    "src/modules/auto-attack-keep-distance-bootstrap.js",
    "src/modules/great-fireball-v2-screen-click-fix.js",
    "src/modules/xray-overlay-floor-mode.js",
    "src/modules/rune-maker-drop-inspector.js",
  ];

  function installUiCompatibilityShim() {
    if (document.__minNewUiCompatibilityShimInstalled) return;
    const originalGetElementById = document.getElementById.bind(document);
    document.getElementById = function getElementByIdWithMinNewCompat(id) {
      if (id === "k9x-panel") return originalGetElementById("minibia-bot-panel") || originalGetElementById(id);
      return originalGetElementById(id);
    };
    document.__minNewUiCompatibilityShimInstalled = true;
  }

  function blankPanelTitle() {
    const title = document.querySelector("#minibia-bot-panel .mb-title");
    if (title) {
      title.textContent = "";
      title.setAttribute("title", "");
      title.style.fontSize = "0";
      title.style.minHeight = "16px";
      title.style.flex = "1 1 auto";
    }
  }

  function syncCollapseButtons() {
    const panel = document.getElementById("minibia-bot-panel");
    if (!panel) return;

    const collapsed = panel.dataset.collapsed === "true";
    panel.querySelectorAll("#minibia-bot-collapse, #minibia-bot-collapse-left").forEach((button) => {
      button.textContent = collapsed ? "+" : "−";
      button.setAttribute("aria-label", collapsed ? "Maximize panel" : "Minimize panel");
      button.setAttribute("title", collapsed ? "Maximize" : "Minimize");
    });
  }

  function ensureLeftCollapseButton() {
    const panel = document.getElementById("minibia-bot-panel");
    const titlebar = panel?.querySelector?.(".mb-titlebar");
    const rightButton = panel?.querySelector?.("#minibia-bot-collapse");
    if (!panel || !titlebar || !rightButton) return;

    let leftButton = panel.querySelector("#minibia-bot-collapse-left");
    if (!leftButton) {
      leftButton = rightButton.cloneNode(true);
      leftButton.id = "minibia-bot-collapse-left";
      titlebar.prepend(leftButton);
      leftButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        rightButton.click();
        window.setTimeout(syncCollapseButtons, 0);
      });
    }

    if (!document.__minNewCollapseButtonSyncInstalled) {
      document.__minNewCollapseButtonSyncInstalled = true;
      document.addEventListener("click", (event) => {
        if (event.target?.closest?.("#minibia-bot-collapse")) {
          window.setTimeout(syncCollapseButtons, 0);
        }
      });
    }

    syncCollapseButtons();
  }

  function removePanelDebugSection() {
    const debugToggle = document.getElementById("minibia-bot-debug-enabled");
    const debugSection = debugToggle?.closest?.(".mb-section");
    if (debugSection) {
      debugSection.remove();
      return;
    }

    const labels = Array.from(document.querySelectorAll("#minibia-bot-panel .mb-label"));
    const debugLabel = labels.find((label) => String(label.textContent || "").trim().toLowerCase() === "debug");
    debugLabel?.closest?.(".mb-section")?.remove();
  }

  function removePanicRunnerSection() {
    const setHomeButton = document.getElementById("minibia-bot-set-home");
    const panicSection = setHomeButton?.closest?.(".mb-section");
    if (panicSection) {
      panicSection.remove();
      return;
    }

    document.getElementById("minibia-bot-home")?.closest?.(".mb-section")?.remove();
    document.getElementById("minibia-bot-panic-unknown")?.closest?.(".mb-section")?.remove();
    document.getElementById("minibia-bot-panic-health")?.closest?.(".mb-section")?.remove();
    document.getElementById("minibia-bot-panic-return")?.closest?.(".mb-section")?.remove();
  }

  function keepPanelTitleBlank() {
    blankPanelTitle();
    ensureLeftCollapseButton();
    removePanelDebugSection();
    removePanicRunnerSection();
    let attempts = 0;
    const timerId = window.setInterval(() => {
      blankPanelTitle();
      ensureLeftCollapseButton();
      removePanelDebugSection();
      removePanicRunnerSection();
      attempts += 1;
      if (attempts >= 20) window.clearInterval(timerId);
    }, 250);
  }

  async function loadSourceFile(path) {
    const response = await fetch(`${rawBaseUrl}/${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);

    let code = await response.text();
    if (path === "src/version.js") {
      code = code
        .replaceAll("%%BRANCH%%", ref)
        .replaceAll("%%COMMIT%%", "source-loader")
        .replaceAll("%%DATE%%", new Date().toISOString());
    }

    window.eval(`\n//# sourceURL=${rawBaseUrl}/${path}\n${code}`);
  }

  async function loadBot() {
    console.log("[minibia-bot] loading source bundle", { repository, ref });
    installUiCompatibilityShim();
    window.__minibiaBotBundle = {};

    for (const file of sourceFiles) {
      await loadSourceFile(file);
    }

    keepPanelTitleBlank();
    console.log("[minibia-bot] source bundle loaded");
  }

  loadBot().catch((error) => {
    console.error("[minibia-bot] failed to load source bundle", error);
    alert(`Minibia bot failed to load: ${error.message || error}`);
  });
})();