window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installPlayerScreenAlertModule = function installPlayerScreenAlertModule(bot) {
  if (!bot || bot.playerScreenAlert) return bot?.playerScreenAlert || null;

  const configStorageKey = "minibiaBot.playerScreenAlert.config";
  const defaultConfig = {
    enabled: false,
    tickMs: 250,
    repeatMs: 3000,
    durationMs: 15000,
    text: "player on screen",
    safeNames: [],
  };

  const state = {
    running: false,
    timerId: null,
    uiTimerId: null,
    visibleUnsafePlayerIds: new Set(),
    alertUntilAt: 0,
    lastSpokenAt: 0,
  };

  const storedConfig = bot.storage.get(configStorageKey, {}) || {};
  const config = Object.assign({}, defaultConfig, storedConfig);
  config.safeNames = normalizeSafeNames(config.safeNames);
  config.repeatMs = Math.max(500, Number(config.repeatMs) || defaultConfig.repeatMs);
  config.durationMs = Math.max(1000, Number(config.durationMs) || defaultConfig.durationMs);

  function normalizeName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function displayName(value) {
    return String(value || "").trim();
  }

  function normalizeSafeNames(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
      .map(displayName)
      .filter((name) => {
        const normalized = normalizeName(name);
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
  }

  function persistConfig() {
    bot.storage.set(configStorageKey, {
      ...config,
      safeNames: [...config.safeNames],
    });
  }

  function isSafeName(name) {
    const normalized = normalizeName(name);
    return !!normalized && config.safeNames.some((safeName) => normalizeName(safeName) === normalized);
  }

  function getVisibleUnsafePlayers() {
    const players = bot.xray?.getVisiblePlayers?.({ sameFloorOnly: true }) || [];
    return players.filter((player) => !isSafeName(player?.name));
  }

  function getPlayerKey(player) {
    if (player?.id != null) return `id:${player.id}`;
    const normalized = normalizeName(player?.name);
    return normalized ? `name:${normalized}` : null;
  }

  function speak(now = Date.now(), force = false) {
    if (typeof window.speechSynthesis === "undefined" || typeof window.SpeechSynthesisUtterance !== "function") {
      bot.log("player screen alert unavailable: speech synthesis missing");
      return false;
    }

    if (!force && now - state.lastSpokenAt < config.repeatMs) return false;

    const utterance = new SpeechSynthesisUtterance(String(config.text || defaultConfig.text));
    window.speechSynthesis.speak(utterance);
    state.lastSpokenAt = now;
    return true;
  }

  function checkPlayers(now = Date.now()) {
    const visiblePlayers = getVisibleUnsafePlayers();
    const nextVisibleIds = new Set();
    const newlyVisiblePlayers = [];

    visiblePlayers.forEach((player) => {
      const key = getPlayerKey(player);
      if (!key) return;
      nextVisibleIds.add(key);
      if (!state.visibleUnsafePlayerIds.has(key)) newlyVisiblePlayers.push(player);
    });

    state.visibleUnsafePlayerIds = nextVisibleIds;

    if (newlyVisiblePlayers.length > 0) {
      state.alertUntilAt = now + config.durationMs;
      state.lastSpokenAt = 0;
      speak(now, true);
      bot.log("player on screen alert triggered", {
        players: newlyVisiblePlayers.map((player) => player?.name || player?.id || "unknown"),
        durationMs: config.durationMs,
      });
      return true;
    }

    if (state.alertUntilAt > now) {
      return speak(now);
    }

    return false;
  }

  function scheduleNextTick() {
    if (!state.running) return;
    state.timerId = window.setTimeout(tick, Math.max(100, Number(config.tickMs) || defaultConfig.tickMs));
  }

  function tick() {
    if (!state.running) return;
    try {
      if (config.enabled) checkPlayers();
    } catch (error) {
      bot.log("player screen alert tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start() {
    config.enabled = true;
    persistConfig();
    state.visibleUnsafePlayerIds = new Set(
      getVisibleUnsafePlayers().map(getPlayerKey).filter(Boolean)
    );
    state.alertUntilAt = 0;
    state.lastSpokenAt = 0;
    syncToggle();

    if (state.running) return false;
    state.running = true;
    bot.log("player screen alert started", { safeNames: [...config.safeNames] });
    tick();
    return true;
  }

  function stop(options = {}) {
    config.enabled = false;
    state.visibleUnsafePlayerIds.clear();
    state.alertUntilAt = 0;
    state.lastSpokenAt = 0;
    if (options.persistEnabled !== false) persistConfig();

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    state.running = false;
    syncToggle();
    bot.log("player screen alert stopped");
    return true;
  }

  function addSafeName(name) {
    const cleaned = displayName(name);
    if (!cleaned || isSafeName(cleaned)) return false;
    config.safeNames.push(cleaned);
    config.safeNames = normalizeSafeNames(config.safeNames);
    persistConfig();
    renderSafeList();
    return true;
  }

  function removeSafeName(name) {
    const normalized = normalizeName(name);
    const previousLength = config.safeNames.length;
    config.safeNames = config.safeNames.filter((safeName) => normalizeName(safeName) !== normalized);
    if (config.safeNames.length === previousLength) return false;
    persistConfig();
    renderSafeList();
    return true;
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "safeNames")) {
      nextConfig.safeNames = normalizeSafeNames(nextConfig.safeNames);
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "text")) {
      nextConfig.text = String(nextConfig.text || defaultConfig.text);
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "repeatMs")) {
      nextConfig.repeatMs = Math.max(500, Number(nextConfig.repeatMs) || defaultConfig.repeatMs);
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "durationMs")) {
      nextConfig.durationMs = Math.max(1000, Number(nextConfig.durationMs) || defaultConfig.durationMs);
    }
    Object.assign(config, nextConfig);
    config.safeNames = normalizeSafeNames(config.safeNames);
    persistConfig();

    if (config.enabled) start();
    else if (state.running) stop();

    syncToggle();
    renderSafeList();
    return { ...config, safeNames: [...config.safeNames] };
  }

  function status() {
    return {
      running: state.running,
      config: { ...config, safeNames: [...config.safeNames] },
      visibleUnsafePlayerIds: [...state.visibleUnsafePlayerIds],
      alertUntilAt: state.alertUntilAt,
      lastSpokenAt: state.lastSpokenAt,
    };
  }

  function syncToggle() {
    const toggle = document.getElementById("minibia-bot-player-screen-alert-enabled");
    if (toggle) toggle.checked = !!config.enabled;
  }

  function renderSafeList() {
    const list = document.getElementById("minibia-bot-player-safe-list");
    if (!list) return;
    list.innerHTML = "";

    if (!config.safeNames.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "No safe players added.";
      list.appendChild(empty);
      return;
    }

    config.safeNames.forEach((name) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "6px";
      row.style.marginTop = "4px";

      const label = document.createElement("span");
      label.textContent = name;
      label.style.overflow = "hidden";
      label.style.textOverflow = "ellipsis";

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "mb-button";
      removeButton.textContent = "Delete";
      removeButton.addEventListener("click", () => removeSafeName(name));

      row.appendChild(label);
      row.appendChild(removeButton);
      list.appendChild(row);
    });
  }

  function injectPanelSection() {
    if (document.getElementById("minibia-bot-player-screen-alert-enabled")) {
      syncToggle();
      renderSafeList();
      return true;
    }

    const panelBody = document.querySelector("#minibia-bot-panel .mb-body") || document.getElementById("minibia-bot-panel");
    if (!panelBody) return false;

    const section = document.createElement("div");
    section.className = "mb-section";
    section.id = "minibia-bot-player-screen-alert-section";

    const title = document.createElement("div");
    title.className = "mb-label";
    title.textContent = "Player Screen Alarm";

    const stack = document.createElement("div");
    stack.className = "mb-stack";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "mb-toggle";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.id = "minibia-bot-player-screen-alert-enabled";
    toggle.checked = !!config.enabled;
    toggle.addEventListener("change", () => toggle.checked ? start() : stop());

    const toggleText = document.createElement("span");
    toggleText.textContent = "Player On Screen Voice Alert";
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(toggleText);

    const note = document.createElement("div");
    note.className = "mb-small-note";
    note.textContent = "Repeats “player on screen” for 15 seconds when a new non-safe player enters. It re-arms after that player leaves.";

    const inputRow = document.createElement("div");
    inputRow.style.display = "flex";
    inputRow.style.gap = "6px";
    inputRow.style.marginTop = "6px";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.id = "minibia-bot-player-safe-name-input";
    nameInput.className = "mb-input";
    nameInput.placeholder = "Safe player name";
    nameInput.style.flex = "1 1 auto";

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "mb-button";
    addButton.textContent = "Add";

    const submitName = () => {
      if (addSafeName(nameInput.value)) nameInput.value = "";
    };
    addButton.addEventListener("click", submitName);
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitName();
      }
    });

    inputRow.appendChild(nameInput);
    inputRow.appendChild(addButton);

    const safeListTitle = document.createElement("div");
    safeListTitle.className = "mb-small-note";
    safeListTitle.textContent = "Safe list:";
    safeListTitle.style.marginTop = "6px";

    const safeList = document.createElement("div");
    safeList.id = "minibia-bot-player-safe-list";

    stack.appendChild(toggleLabel);
    stack.appendChild(note);
    stack.appendChild(inputRow);
    stack.appendChild(safeListTitle);
    stack.appendChild(safeList);
    section.appendChild(title);
    section.appendChild(stack);
    panelBody.appendChild(section);
    renderSafeList();
    return true;
  }

  function watchForPanel() {
    if (injectPanelSection()) return;
    let attempts = 0;
    state.uiTimerId = window.setInterval(() => {
      attempts += 1;
      if (injectPanelSection() || attempts >= 40) {
        window.clearInterval(state.uiTimerId);
        state.uiTimerId = null;
      }
    }, 250);
  }

  bot.addCleanup?.(() => {
    if (state.timerId != null) window.clearTimeout(state.timerId);
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    state.running = false;
  });

  bot.playerScreenAlert = {
    start,
    stop,
    addSafeName,
    removeSafeName,
    updateConfig,
    status,
    checkPlayers,
    config,
  };

  if (config.enabled) start();
  window.setTimeout(watchForPanel, 0);
  return bot.playerScreenAlert;
};

if (window.minibiaBot) {
  window.__minibiaBotBundle.installPlayerScreenAlertModule(window.minibiaBot);
}
