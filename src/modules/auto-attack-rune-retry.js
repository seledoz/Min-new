(() => {
  const retryMs = 100;
  const globalKey = "__minibiaAutoAttackRuneRetry";

  const previous = window[globalKey];
  if (previous?.timerId != null) {
    window.clearInterval(previous.timerId);
  }

  const state = {
    timerId: null,
    attack: null,
  };

  function shouldRetry(attack) {
    if (!attack || attack !== window.minibiaBot?.attack) return false;
    const status = attack.status?.();
    if (!status?.running || !status?.config?.enabled) return false;
    if (!attack.getCurrentTarget?.()) return false;
    return !!attack.normalizeHotbarSlot?.(attack.config?.runeHotbarSlot);
  }

  function tick() {
    try {
      const attack = window.minibiaBot?.attack || null;
      if (attack !== state.attack) state.attack = attack;
      if (shouldRetry(attack)) {
        attack.triggerRune?.(Date.now());
      }
    } catch (error) {
      window.minibiaBot?.log?.("auto attack rune retry failed", error?.message || error);
    }
  }

  state.timerId = window.setInterval(tick, retryMs);
  window[globalKey] = state;
})();
