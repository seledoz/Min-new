window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installMaxLightModule = function installMaxLightModule(bot) {
  const configStorageKey = "minibiaBot.maxLight.config";
  const controlsId = "minibia-bot-max-light-section";
  const config = Object.assign(
    {
      enabled: false,
      level: 255,
      color: 215,
    },
    bot.storage.get(configStorageKey, {})
  );

  let timerId = null;
  let originalLight = null;
  let lastAppliedTarget = null;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getPlayer() {
    return window.gameClient?.player || window.gameClient?.world?.player || null;
  }

  function cloneLight(light) {
    if (!light || typeof light !== "object") return null;
    return {
      level: Number(light.level ?? light.intensity ?? light.amount ?? 0),
      color: Number(light.color ?? light.colour ?? 215),
    };
  }

  function captureOriginalLight(player) {
    if (originalLight || !player) return;
    originalLight = cloneLight(player.light || player.__light || player.state?.light);
  }

  function callLightSetter(player, level, color) {
    const setters = [
      player?.setLight,
      player?.updateLight,
      player?.setCreatureLight,
      window.gameClient?.setPlayerLight,
      window.gameClient?.world?.setCreatureLight,
    ].filter((setter) => typeof setter === "function");

    for (const setter of setters) {
      try {
        setter.call(setter === player?.setLight || setter === player?.updateLight || setter === player?.setCreatureLight ? player : window.gameClient, {
          level,
          color,
        });
        return true;
      } catch (firstError) {
        try {
          setter.call(player, level, color);
          return true;
        } catch (secondError) {}
      }
    }

    return false;
  }

  function assignLightObject(target, level, color) {
    if (!target || typeof target !== "object") return false;

    let changed = false;
    const keys = ["light", "__light"];
    keys.forEach((key) => {
      if (target[key] && typeof target[key] === "object") {
        if ("level" in target[key] || !("intensity" in target[key])) target[key].level = level;
        if ("intensity" in target[key]) target[key].intensity = level;
        if ("amount" in target[key]) target[key].amount = level;
        if ("color" in target[key] || !("colour" in target[key])) target[key].color = color;
        if ("colour" in target[key]) target[key].colour = color;
        changed = true;
      }
    });

    if (target.state?.light && typeof target.state.light === "object") {
      target.state.light.level = level;
      target.state.light.color = color;
      changed = true;
    }

    return changed;
  }

  function applyGameLight() {
    if (!config.enabled) return false;

    const player = getPlayer();
    if (!player) return false;

    captureOriginalLight(player);
    const level = Math.max(1, Math.min(255, Number(config.level) || 255));
    const color = Math.max(0, Math.min(255, Number(config.color) || 215));

    const setterApplied = callLightSetter(player, level, color);
    const objectApplied = assignLightObject(player, level, color);

    lastAppliedTarget = player;
    return setterApplied || objectApplied;
  }

  function restoreOriginalLight() {
    const player = lastAppliedTarget || getPlayer();
    if (!player || !originalLight) return false;

    callLightSetter(player, originalLight.level, originalLight.color);
    assignLightObject(player, originalLight.level, originalLight.color);
    originalLight = null;
    lastAppliedTarget = null;
    return true;
  }

  function refreshControls() {
    const toggle = document.getElementById("minibia-bot-max-light-enabled");
    if (toggle) toggle.checked = !!config.enabled;
  }

  function startTimer() {
    if (timerId != null) return;
    applyGameLight();
    timerId = window.setInterval(applyGameLight, 250);
  }

  function stopTimer() {
    if (timerId == null) return;
    window.clearInterval(timerId);
    timerId = null;
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    config.enabled = !!config.enabled;
    config.level = Math.max(1, Math.min(255, Number(config.level) || 255));
    config.color = Math.max(0, Math.min(255, Number(config.color) || 215));
    persistConfig();

    if (config.enabled) {
      startTimer();
      applyGameLight();
    } else {
      stopTimer();
      restoreOriginalLight();
    }

    refreshControls();
    return { ...config };
  }

  function start() {
    return updateConfig({ enabled: true });
  }

  function stop() {
    return updateConfig({ enabled: false });
  }

  function toggle() {
    return updateConfig({ enabled: !config.enabled });
  }

  function injectControls() {
    if (document.getElementById(controlsId)) {
      refreshControls();
      return true;
    }

    const mainColumn = document.querySelector("#minibia-bot-panel .mb-main-column");
    if (!mainColumn) return false;

    const section = document.createElement("div");
    section.id = controlsId;
    section.className = "mb-section mb-column-section";
    section.innerHTML = `
      <div class="mb-label">Game Light</div>
      <div class="mb-stack">
        <label class="mb-toggle">
          <input type="checkbox" id="minibia-bot-max-light-enabled" />
          <span>Full Screen Spell Light</span>
        </label>
        <div class="mb-small-note">Uses the player light source like utevo lux. No brightness filter.</div>
      </div>
    `;

    mainColumn.appendChild(section);
    section.querySelector("#minibia-bot-max-light-enabled")?.addEventListener("change", (event) => {
      updateConfig({ enabled: !!event.target.checked });
    });

    refreshControls();
    return true;
  }

  const controlsTimerId = window.setInterval(injectControls, 500);

  bot.addCleanup(() => {
    window.clearInterval(controlsTimerId);
    stopTimer();
    restoreOriginalLight();
    document.getElementById(controlsId)?.remove();
  });

  bot.maxLight = {
    start,
    stop,
    toggle,
    updateConfig,
    injectControls,
    config,
    status: () => ({ running: !!config.enabled, config: { ...config } }),
  };

  if (config.enabled) startTimer();
  window.setTimeout(injectControls, 0);
};
