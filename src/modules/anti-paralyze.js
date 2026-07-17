window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAntiParalyzeModule = function installAntiParalyzeModule(bot) {
  const configStorageKey = "minibiaBot.antiParalyzeV2.config";
  const PARALYZE_PATTERN = /(paraly|paralys|paralis)/i;
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
    detectionSource: null,
    detectedElement: null,
    uiObserver: null,
  };

  const config = Object.assign(
    {
      enabled: false,
      spellWords: "",
      tickMs: 50,
      recastCooldownMs: 2100,
    },
    bot.storage.get(configStorageKey, {})
  );

  config.tickMs = 50;
  config.recastCooldownMs = 2100;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    if (element.closest("#minibia-bot-panel")) return false;

    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width < 8 || rect.height < 8) return false;

    const style = window.getComputedStyle?.(element);
    return !style || (style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0);
  }

  function getElementSignals(element) {
    if (!(element instanceof Element)) return "";

    const values = [
      element.id,
      element.className,
      element.getAttribute("title"),
      element.getAttribute("aria-label"),
      element.getAttribute("alt"),
      element.getAttribute("name"),
      element.getAttribute("src"),
      element.getAttribute("data-condition"),
      element.getAttribute("data-status"),
      element.getAttribute("data-effect"),
      element.getAttribute("data-tooltip"),
      element.getAttribute("style"),
    ];

    try {
      values.push(window.getComputedStyle(element).backgroundImage);
    } catch (_error) {
      // The element may disappear while the status bar is updating.
    }

    return values.filter(Boolean).map(String).join(" ");
  }

  function findParalyzeStatusIcon() {
    state.detectionSource = null;
    state.detectedElement = null;

    const directSelector = [
      '[title*="paraly" i]',
      '[aria-label*="paraly" i]',
      '[alt*="paraly" i]',
      '[id*="paraly" i]',
      '[class*="paraly" i]',
      '[src*="paraly" i]',
      '[data-condition*="paraly" i]',
      '[data-status*="paraly" i]',
      '[data-effect*="paraly" i]',
      '[title*="paralis" i]',
      '[aria-label*="paralis" i]',
      '[alt*="paralis" i]',
      '[src*="paralis" i]',
    ].join(",");

    const directMatches = document.querySelectorAll(directSelector);
    for (const element of directMatches) {
      if (!isVisible(element)) continue;
      state.detectedElement = element;
      state.detectionSource = `direct:${element.id || element.className || element.tagName}`;
      return element;
    }

    const candidates = document.querySelectorAll(
      'img, [class*="status" i], [class*="condition" i], [class*="effect" i], [class*="debuff" i], [class*="icon" i], [style*="background" i]'
    );

    for (const element of candidates) {
      if (!isVisible(element)) continue;
      if (!PARALYZE_PATTERN.test(getElementSignals(element))) continue;

      state.detectedElement = element;
      state.detectionSource = `status-icon:${element.id || element.className || element.tagName}`;
      return element;
    }

    return null;
  }

  function isParalyzedActive() {
    return !!findParalyzeStatusIcon();
  }

  function shouldPrioritizeHpHeal() {
    const healStatus = bot.heal?.status?.();
    const hp = Number(healStatus?.stats?.hp?.current);
    const minHp = Math.max(0, Number(bot.heal?.config?.minHp) || 0);

    return (
      !!healStatus?.running &&
      !!bot.heal?.config?.enabled &&
      Number.isFinite(hp) &&
      hp > 0 &&
      hp <= minHp
    );
  }

  function tryAntiParalyze(now = Date.now()) {
    if (!state.running || !config.enabled) return false;

    const spellWords = String(config.spellWords || "").trim();
    if (!spellWords || !isParalyzedActive()) return false;

    if (shouldPrioritizeHpHeal()) {
      bot.heal?.tryHeal?.();
      return false;
    }

    if (now - state.lastCastAt < 2100) return false;

    const sent = bot.sendChat(spellWords);
    if (sent) {
      state.lastCastAt = now;
      bot.log("cast anti-paralyze spell", {
        spellWords,
        cooldownMs: 2100,
        detectionSource: state.detectionSource,
      });
    }

    return sent;
  }

  function scheduleNextTick() {
    if (!state.running) return;
    state.timerId = window.setTimeout(tick, 50);
  }

  function tick() {
    if (!state.running) return;

    try {
      tryAntiParalyze();
    } catch (error) {
      bot.log("anti-paralyze tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, {
      enabled: true,
      tickMs: 50,
      recastCooldownMs: 2100,
    });
    config.spellWords = String(config.spellWords || "").trim();
    persistConfig();

    if (state.running) {
      syncUi();
      return false;
    }

    state.running = true;
    tick();
    syncUi();
    bot.log("anti-paralyze started", { ...config });
    return true;
  }

  function stop(options = {}) {
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    if (options.persistEnabled !== false) {
      config.enabled = false;
      persistConfig();
    }

    syncUi();
    bot.log("anti-paralyze stopped");
    return true;
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim();
    }

    Object.assign(config, nextConfig, {
      tickMs: 50,
      recastCooldownMs: 2100,
    });
    persistConfig();
    syncUi();
    return { ...config };
  }

  function syncUi() {
    const toggle = document.getElementById("minibia-bot-anti-paralyze-enabled");
    const spellInput = document.getElementById("minibia-bot-anti-paralyze-spell");
    if (toggle) toggle.checked = state.running;
    if (spellInput && document.activeElement !== spellInput) spellInput.value = config.spellWords || "";
  }

  function installUi() {
    if (document.getElementById("minibia-bot-anti-paralyze-enabled")) {
      syncUi();
      return true;
    }

    const autoHealToggle = document.getElementById("minibia-bot-auto-heal-enabled");
    const autoHealSection = autoHealToggle?.closest?.(".mb-section");
    const autoHealStack = autoHealSection?.querySelector?.(".mb-stack");
    if (!autoHealStack) return false;

    const wrapper = document.createElement("div");
    wrapper.className = "mb-stack";
    wrapper.style.paddingTop = "8px";
    wrapper.style.borderTop = "1px solid rgba(224, 200, 148, 0.16)";
    wrapper.innerHTML = `
      <div class="mb-row">
        <label class="mb-toggle">
          <input type="checkbox" id="minibia-bot-anti-paralyze-enabled" />
          <span>Anti Paralyze</span>
        </label>
        <input type="text" id="minibia-bot-anti-paralyze-spell" placeholder="Spell words" />
      </div>
      <div class="mb-small-note">Detects the paralyze status icon. Auto Heal takes priority at or below Minimum HP. Cooldown: 2100 ms.</div>
    `;
    autoHealStack.appendChild(wrapper);

    const toggle = wrapper.querySelector("#minibia-bot-anti-paralyze-enabled");
    const spellInput = wrapper.querySelector("#minibia-bot-anti-paralyze-spell");
    spellInput.value = config.spellWords || "";
    toggle.checked = state.running;

    spellInput.addEventListener("change", () => {
      updateConfig({ spellWords: spellInput.value });
    });

    toggle.addEventListener("change", () => {
      const spellWords = String(spellInput.value || "").trim();
      updateConfig({ spellWords });
      if (toggle.checked) start({ spellWords });
      else stop();
      toggle.checked = state.running;
    });

    return true;
  }

  function status() {
    const paralyzed = isParalyzedActive();
    return {
      running: state.running,
      config: { ...config },
      paralyzed,
      healPriorityActive: shouldPrioritizeHpHeal(),
      detectionSource: state.detectionSource,
      detectedElement: state.detectedElement
        ? {
            tag: state.detectedElement.tagName,
            id: state.detectedElement.id || null,
            className: String(state.detectedElement.className || "") || null,
          }
        : null,
      lastCastAt: state.lastCastAt,
    };
  }

  state.uiObserver = new MutationObserver(() => installUi());
  state.uiObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(installUi, 0);

  bot.addCleanup?.(() => {
    stop({ persistEnabled: false });
    state.uiObserver?.disconnect();
  });

  bot.antiParalyze = {
    start,
    stop,
    status,
    updateConfig,
    isParalyzedActive,
    shouldPrioritizeHpHeal,
    tryAntiParalyze,
    config,
  };

  if (config.enabled) start();
};
