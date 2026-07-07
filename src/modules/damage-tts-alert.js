window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installDamageTtsAlertModule = function installDamageTtsAlertModule(bot) {
  const configStorageKey = "minibiaBot.damageTtsAlert.config";
  const defaultConfig = {
    enabled: false,
    tickMs: 250,
    repeatMs: 3000,
    durationMs: 30000,
    text: "player under attack",
  };

  const state = {
    running: false,
    timerId: null,
    lastObservedHp: null,
    alertUntilAt: 0,
    lastSpokenAt: 0,
    uiTimerId: null,
  };

  const config = Object.assign({}, defaultConfig, bot.storage.get(configStorageKey, {}) || {});

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function readHp() {
    const snapshot = bot.getPlayerSnapshot?.();
    const hp = Number(snapshot?.health);
    return Number.isFinite(hp) ? hp : null;
  }

  function speak(now = Date.now()) {
    if (typeof window.speechSynthesis === "undefined") {
      bot.log("damage voice alert unavailable: speech synthesis missing");
      return false;
    }

    const repeatMs = Math.max(500, Number(config.repeatMs) || defaultConfig.repeatMs);
    if (now - state.lastSpokenAt < repeatMs) {
      return false;
    }

    const utterance = new SpeechSynthesisUtterance(String(config.text || defaultConfig.text));
    window.speechSynthesis.speak(utterance);
    state.lastSpokenAt = now;
    return true;
  }

  function checkDamage(now = Date.now()) {
    const hp = readHp();
    if (hp == null || hp <= 0) {
      state.lastObservedHp = hp;
      return false;
    }

    const previousHp = Number(state.lastObservedHp);
    state.lastObservedHp = hp;

    if (Number.isFinite(previousHp) && hp < previousHp) {
      state.alertUntilAt = now + Math.max(0, Number(config.durationMs) || defaultConfig.durationMs);
      state.lastSpokenAt = 0;
      bot.log("damage voice alert triggered", { previousHp, hp });
    }

    if (state.alertUntilAt > now) {
      return speak(now);
    }

    return false;
  }

  function scheduleNextTick() {
    if (!state.running) return;
    state.timerId = window.setTimeout(tick, Math.max(50, Number(config.tickMs) || defaultConfig.tickMs));
  }

  function tick() {
    if (!state.running) return;

    try {
      if (config.enabled) {
        checkDamage();
      }
    } catch (error) {
      bot.log("damage voice alert tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.repeatMs = Math.max(500, Number(config.repeatMs) || defaultConfig.repeatMs);
    config.durationMs = Math.max(0, Number(config.durationMs) || defaultConfig.durationMs);
    persistConfig();
    state.lastObservedHp = null;
    syncToggle();

    if (state.running) {
      return false;
    }

    state.running = true;
    bot.log("damage voice alert started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    config.enabled = false;
    state.alertUntilAt = 0;
    state.lastSpokenAt = 0;

    if (shouldPersistEnabled) {
      persistConfig();
    }

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    state.running = false;
    syncToggle();
    bot.log("damage voice alert stopped");
    return true;
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "text")) {
      nextConfig.text = String(nextConfig.text || defaultConfig.text);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "repeatMs")) {
      nextConfig.repeatMs = Math.max(500, Number(nextConfig.repeatMs) || defaultConfig.repeatMs);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "durationMs")) {
      nextConfig.durationMs = Math.max(0, Number(nextConfig.durationMs) || defaultConfig.durationMs);
    }

    Object.assign(config, nextConfig);
    persistConfig();

    if (config.enabled) {
      start({});
    } else if (state.running) {
      stop({ persistEnabled: true });
    }

    syncToggle();
    return { ...config };
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      lastObservedHp: state.lastObservedHp,
      alertUntilAt: state.alertUntilAt,
      lastSpokenAt: state.lastSpokenAt,
    };
  }

  function syncToggle() {
    const toggle = document.getElementById("minibia-bot-damage-tts-alert-enabled");
    if (toggle) {
      toggle.checked = !!config.enabled;
    }
  }

  function injectPanelToggle() {
    if (document.getElementById("minibia-bot-damage-tts-alert-enabled")) {
      syncToggle();
      return true;
    }

    const autoHealToggle = document.getElementById("minibia-bot-auto-heal-enabled");
    const autoHealSection = autoHealToggle?.closest?.(".mb-section");
    const stack = autoHealSection?.querySelector?.(".mb-stack") || autoHealSection;
    if (!stack) {
      return false;
    }

    const label = document.createElement("label");
    label.className = "mb-toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = "minibia-bot-damage-tts-alert-enabled";
    input.checked = !!config.enabled;
    input.addEventListener("change", () => {
      if (input.checked) {
        start();
      } else {
        stop();
      }
    });

    const text = document.createElement("span");
    text.textContent = "Damage Voice Alert";

    const note = document.createElement("div");
    note.className = "mb-small-note";
    note.textContent = "When HP drops, says “player under attack” every 3 seconds for 30 seconds.";

    label.appendChild(input);
    label.appendChild(text);
    stack.appendChild(label);
    stack.appendChild(note);
    return true;
  }

  function watchForPanel() {
    if (injectPanelToggle()) {
      return;
    }

    let attempts = 0;
    state.uiTimerId = window.setInterval(() => {
      attempts += 1;
      if (injectPanelToggle() || attempts >= 40) {
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

  bot.damageTtsAlert = {
    start,
    stop,
    updateConfig,
    status,
    checkDamage,
    config,
  };

  if (config.enabled) {
    start({});
  }

  window.setTimeout(watchForPanel, 0);
};