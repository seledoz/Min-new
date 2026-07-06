window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installCaveArrowKeysModule = function installCaveArrowKeysModule(bot) {
  if (!bot || bot.caveArrowKeys?.destroy) return bot?.caveArrowKeys;

  const state = {
    installed: false,
    originalFindPath: null,
    lastStepAt: 0,
    lastKey: null,
    stepCount: 0,
    uiTimerId: null,
  };

  const config = {
    stepCooldownMs: 180,
  };

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function sameTile(left, right) {
    const a = normalizePosition(left);
    const b = normalizePosition(right);
    return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
  }

  function isArrowModeActive(to) {
    const caveStatus = bot.cave?.status?.() || null;
    if (!caveStatus?.running || caveStatus?.config?.pathfinderMode !== "arrow") return false;
    if (!caveStatus.currentWaypoint) return false;
    return sameTile(to, caveStatus.currentWaypoint);
  }

  function pickArrowKey(from, to) {
    const dx = Number(to.x) - Number(from.x);
    const dy = Number(to.y) - Number(from.y);

    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
      return dx > 0 ? "ArrowRight" : "ArrowLeft";
    }

    if (dy !== 0) {
      return dy > 0 ? "ArrowDown" : "ArrowUp";
    }

    return null;
  }

  function dispatchArrowKey(key) {
    const target = document.activeElement || document.body || document.documentElement;
    const eventInit = {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
      composed: true,
    };

    target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));

    window.setTimeout(() => {
      target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
      window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    }, 40);
  }

  function stepToward(from, to) {
    const fromPosition = normalizePosition(from);
    const toPosition = normalizePosition(to);
    if (!fromPosition || !toPosition || fromPosition.z !== toPosition.z) return false;

    const now = Date.now();
    if (now - state.lastStepAt < config.stepCooldownMs) return true;

    const key = pickArrowKey(fromPosition, toPosition);
    if (!key) return true;

    dispatchArrowKey(key);
    state.lastStepAt = now;
    state.lastKey = key;
    state.stepCount += 1;
    bot.log("cave arrow key step", {
      key,
      from: fromPosition,
      to: toPosition,
      stepCount: state.stepCount,
    });
    return true;
  }

  function installPathInterceptor() {
    const pathfinder = window.gameClient?.world?.pathfinder;
    if (!pathfinder || typeof pathfinder.findPath !== "function" || state.installed) return false;

    state.originalFindPath = pathfinder.findPath.bind(pathfinder);
    pathfinder.findPath = function findPathWithArrowMode(from, to, ...args) {
      if (isArrowModeActive(to)) {
        stepToward(from, to);
        return null;
      }

      return state.originalFindPath(from, to, ...args);
    };

    state.installed = true;
    return true;
  }

  function uninstallPathInterceptor() {
    const pathfinder = window.gameClient?.world?.pathfinder;
    if (state.installed && pathfinder && state.originalFindPath) {
      pathfinder.findPath = state.originalFindPath;
    }
    state.installed = false;
    state.originalFindPath = null;
  }

  function ensureDropdownOption() {
    const select = document.getElementById("minibia-bot-cave-pathfinder-mode");
    if (!select) return;

    if (!Array.from(select.options).some((option) => option.value === "arrow")) {
      const option = document.createElement("option");
      option.value = "arrow";
      option.textContent = "Arrow Keys";
      select.appendChild(option);
    }

    const mode = bot.cave?.status?.().config?.pathfinderMode;
    if (mode === "arrow") {
      select.value = "arrow";
    }
  }

  function status() {
    return {
      installed: state.installed,
      config: { ...config },
      lastStepAt: state.lastStepAt,
      lastKey: state.lastKey,
      stepCount: state.stepCount,
    };
  }

  function destroy() {
    uninstallPathInterceptor();
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    state.uiTimerId = null;
  }

  bot.caveArrowKeys = {
    installPathInterceptor,
    uninstallPathInterceptor,
    ensureDropdownOption,
    status,
    destroy,
    config,
  };

  installPathInterceptor();
  ensureDropdownOption();
  state.uiTimerId = window.setInterval(ensureDropdownOption, 1000);
  bot.addCleanup(destroy);
  return bot.caveArrowKeys;
};
