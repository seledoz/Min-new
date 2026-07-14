(() => {
  const retryMs = 100;
  let timerId = null;
  let installedAttack = null;

  function shouldRetry(attack) {
    if (!attack || attack !== window.minibiaBot?.attack) return false;
    const status = attack.status?.();
    if (!status?.running || !status?.config?.enabled) return false;
    if (!attack.getCurrentTarget?.()) return false;
    return !!attack.normalizeHotbarSlot?.(attack.config?.runeHotbarSlot);
  }

  function retryTick() {
    try {
      const attack = window.minibiaBot?.attack;
      if (shouldRetry(attack)) {
        attack.triggerRune?.(Date.now());
      }
    } catch (error) {
      window.minibiaBot?.log?.("auto attack rune retry failed", error?.message || error);
    }
  }

  function install() {
    const attack = window.minibiaBot?.attack;
    if (!attack || attack === installedAttack) return false;

    installedAttack = attack;
    if (timerId != null) window.clearInterval(timerId);
    timerId = window.setInterval(retryTick, retryMs);

    window.minibiaBot?.addCleanup?.(() => {
      if (timerId != null) window.clearInterval(timerId);
      timerId = null;
      installedAttack = null;
    });
    return true;
  }

  install();
  const installerId = window.setInterval(() => {
    if (install()) window.clearInterval(installerId);
  }, retryMs);
})();
