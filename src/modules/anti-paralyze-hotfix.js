window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(() => {
  const STORAGE_KEY = "minibiaBot.antiParalyze.config";
  const INSTALL_RETRY_MS = 250;
  const MAX_INSTALL_ATTEMPTS = 80;
  const PARALYZE_PATTERN = /(paraly|paralys|paralis|slow)/i;

  function install(bot) {
    if (!bot || bot.__antiParalyzeRuntimeFixInstalled) return !!bot;

    bot.antiParalyze?.stop?.({ persistEnabled: false });

    const previousConfig = bot.storage.get(STORAGE_KEY, {}) || {};
    const config = Object.assign(
      {
        tickMs: 50,
        spellWords: "",
        recastCooldownMs: 2040,
        enabled: false,
      },
      previousConfig
    );

    const state = {
      running: false,
      timerId: null,
      lastCastAt: 0,
      detectionSource: null,
      detectedElement: null,
      uiObserver: null,
      uiToggle: null,
      uiSpellInput: null,
      uiToggleHandler: null,
      uiSpellHandler: null,
    };

    function persistConfig() {
      bot.storage.set(STORAGE_KEY, { ...config });
    }

    function safeRead(object, key) {
      try {
        return object?.[key];
      } catch (_error) {
        return undefined;
      }
    }

    function getPlayerCandidates() {
      const candidates = [
        window.gameClient?.player,
        window.client?.player,
        window.game?.player,
        window.Game?.player,
        window.minibia?.player,
        bot.gameClient?.player,
        bot.client?.player,
        bot.player,
      ];
      return [...new Set(candidates.filter(Boolean))];
    }

    function valueLooksParalyzed(value, depth = 0, seen = new Set()) {
      if (value == null || depth > 3) return false;
      if (typeof value === "string") return PARALYZE_PATTERN.test(value);
      if (typeof value === "number" || typeof value === "boolean") return false;
      if (typeof value !== "object" && typeof value !== "function") return false;
      if (seen.has(value)) return false;
      seen.add(value);

      let keys;
      try {
        keys = Object.getOwnPropertyNames(value).slice(0, 100);
      } catch (_error) {
        return false;
      }

      for (const key of keys) {
        if (PARALYZE_PATTERN.test(key)) {
          const entry = safeRead(value, key);
          if (entry === true || Number(entry) > 0 || valueLooksParalyzed(entry, depth + 1, seen)) {
            return true;
          }
        }
      }

      const likelyKeys = [
        "name", "type", "condition", "conditionName", "status", "state",
        "effect", "effects", "conditions", "debuffs", "buffs", "flags",
        "activeConditions", "conditionList", "conditionMap"
      ];
      for (const key of likelyKeys) {
        const entry = safeRead(value, key);
        if (valueLooksParalyzed(entry, depth + 1, seen)) return true;
      }

      if (value instanceof Map) {
        for (const [key, entry] of value.entries()) {
          if (valueLooksParalyzed(key, depth + 1, seen) || valueLooksParalyzed(entry, depth + 1, seen)) return true;
        }
      } else if (value instanceof Set || Array.isArray(value)) {
        for (const entry of value) {
          if (valueLooksParalyzed(entry, depth + 1, seen)) return true;
        }
      }

      return false;
    }

    function runtimeLooksParalyzed() {
      for (const player of getPlayerCandidates()) {
        const directFlags = [
          "paralyzed", "paralysed", "isParalyzed", "isParalysed",
          "hasParalyze", "hasParalysis", "slowed", "isSlowed"
        ];
        for (const key of directFlags) {
          const value = safeRead(player, key);
          try {
            const active = typeof value === "function" ? value.call(player) : value;
            if (active === true || Number(active) > 0) {
              state.detectionSource = `player:${key}`;
              return true;
            }
          } catch (_error) {
            // Continue through remaining detection methods.
          }
        }

        const conditionSources = [
          safeRead(player, "conditions"),
          safeRead(player, "condition"),
          safeRead(player, "effects"),
          safeRead(player, "statusEffects"),
          safeRead(player, "debuffs"),
          safeRead(player, "states"),
          safeRead(player, "state"),
          player,
        ];
        for (const source of conditionSources) {
          if (valueLooksParalyzed(source)) {
            state.detectionSource = "player-runtime";
            return true;
          }
        }

        const currentSpeed = Number(
          safeRead(player, "speed") ?? safeRead(player, "currentSpeed") ??
          safeRead(player, "movementSpeed") ?? safeRead(player, "walkSpeed") ??
          safeRead(safeRead(player, "state"), "speed") ??
          safeRead(safeRead(player, "state"), "currentSpeed")
        );
        const normalSpeed = Number(
          safeRead(player, "baseSpeed") ?? safeRead(player, "normalSpeed") ??
          safeRead(player, "defaultSpeed") ?? safeRead(player, "originalSpeed") ??
          safeRead(safeRead(player, "state"), "baseSpeed") ??
          safeRead(safeRead(player, "state"), "normalSpeed")
        );
        if (Number.isFinite(currentSpeed) && Number.isFinite(normalSpeed) && normalSpeed > 0) {
          const reduction = normalSpeed - currentSpeed;
          if (reduction >= 10 || currentSpeed / normalSpeed <= 0.92) {
            state.detectionSource = `speed:${currentSpeed}/${normalSpeed}`;
            return true;
          }
        }
      }
      return false;
    }

    function elementSignals(element) {
      if (!(element instanceof Element) || element.closest("#minibia-bot-panel")) return "";
      const values = [
        element.id,
        element.className,
        element.getAttribute("title"),
        element.getAttribute("aria-label"),
        element.getAttribute("alt"),
        element.getAttribute("name"),
        element.getAttribute("data-condition"),
        element.getAttribute("data-status"),
        element.getAttribute("data-effect"),
        element.getAttribute("data-tooltip"),
        element.getAttribute("src"),
        element.getAttribute("style"),
      ];
      try {
        values.push(window.getComputedStyle(element).backgroundImage);
      } catch (_error) {}
      return values.filter(Boolean).map(String).join(" ");
    }

    function domLooksParalyzed() {
      const selector = [
        '[title*="paraly" i]', '[aria-label*="paraly" i]', '[alt*="paraly" i]',
        '[class*="paraly" i]', '[id*="paraly" i]', '[src*="paraly" i]',
        '[data-condition*="paraly" i]', '[data-status*="paraly" i]',
        '[data-effect*="paraly" i]', '[style*="paraly" i]',
        '[title*="paralis" i]', '[aria-label*="paralis" i]', '[src*="paralis" i]'
      ].join(",");

      const direct = document.querySelector(selector);
      if (direct && !direct.closest("#minibia-bot-panel")) {
        state.detectedElement = direct;
        state.detectionSource = `dom:${direct.id || direct.className || direct.tagName}`;
        return true;
      }

      const likelyIcons = document.querySelectorAll("img, [style*='background'], [class*='icon' i], [class*='condition' i], [class*='status' i]");
      for (const element of likelyIcons) {
        if (PARALYZE_PATTERN.test(elementSignals(element))) {
          state.detectedElement = element;
          state.detectionSource = `dom-signal:${element.id || element.className || element.tagName}`;
          return true;
        }
      }
      state.detectedElement = null;
      return false;
    }

    function isParalyzedActive() {
      state.detectionSource = null;
      return runtimeLooksParalyzed() || domLooksParalyzed();
    }

    function shouldPrioritizeHeal() {
      const healStatus = bot.heal?.status?.();
      const stats = bot.heal?.readStats?.();
      const hp = Number(stats?.hp?.current);
      const minHp = Math.max(0, Number(bot.heal?.config?.minHp) || 0);
      return !!healStatus?.running && Number.isFinite(hp) && hp > 0 && hp <= minHp;
    }

    function tryAntiParalyze(now = Date.now()) {
      if (!config.enabled || !state.running) return false;
      const spellWords = String(config.spellWords || "").trim();
      if (!spellWords || !isParalyzedActive()) return false;

      if (shouldPrioritizeHeal()) {
        bot.heal?.tryHeal?.();
        return false;
      }

      const cooldown = Math.max(0, Number(config.recastCooldownMs) || 0);
      if (now - state.lastCastAt < cooldown) return false;

      const sent = bot.sendChat(spellWords);
      if (sent) {
        state.lastCastAt = now;
        bot.log("cast anti-paralyze spell", {
          spellWords,
          detectionSource: state.detectionSource,
        });
      }
      return sent;
    }

    function tick() {
      if (!state.running) return;
      try {
        tryAntiParalyze();
      } catch (error) {
        bot.log("anti-paralyze runtime detection failed", error?.message || error);
      } finally {
        if (state.running) {
          state.timerId = window.setTimeout(tick, Math.max(25, Number(config.tickMs) || 50));
        }
      }
    }

    function syncUi() {
      const toggle = document.getElementById("minibia-bot-anti-paralyze-enabled");
      const spellInput = document.getElementById("minibia-bot-anti-paralyze-spell");
      if (toggle) toggle.checked = state.running;
      if (spellInput && document.activeElement !== spellInput) spellInput.value = config.spellWords || "";
    }

    function start(overrides = {}) {
      Object.assign(config, overrides, { enabled: true });
      config.spellWords = String(config.spellWords || "").trim();
      persistConfig();
      if (state.running) {
        syncUi();
        return false;
      }
      state.running = true;
      tick();
      syncUi();
      bot.log("anti-paralyze runtime monitor started", { ...config });
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
      return true;
    }

    function updateConfig(nextConfig = {}) {
      if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
        nextConfig.spellWords = String(nextConfig.spellWords || "").trim();
      }
      Object.assign(config, nextConfig);
      persistConfig();
      syncUi();
      return { ...config };
    }

    function bindUiControls() {
      const toggle = document.getElementById("minibia-bot-anti-paralyze-enabled");
      const spellInput = document.getElementById("minibia-bot-anti-paralyze-spell");
      if (!toggle || !spellInput) return false;

      if (state.uiToggle !== toggle) {
        if (state.uiToggle && state.uiToggleHandler) {
          state.uiToggle.removeEventListener("change", state.uiToggleHandler, true);
        }
        state.uiToggle = toggle;
        state.uiToggleHandler = (event) => {
          event.stopImmediatePropagation();
          const spellWords = String(spellInput.value || "").trim();
          updateConfig({ spellWords });
          if (toggle.checked) start({ spellWords });
          else stop();
          toggle.checked = state.running;
        };
        toggle.addEventListener("change", state.uiToggleHandler, true);
      }

      if (state.uiSpellInput !== spellInput) {
        if (state.uiSpellInput && state.uiSpellHandler) {
          state.uiSpellInput.removeEventListener("change", state.uiSpellHandler, true);
        }
        state.uiSpellInput = spellInput;
        state.uiSpellHandler = (event) => {
          event.stopImmediatePropagation();
          updateConfig({ spellWords: spellInput.value });
        };
        spellInput.addEventListener("change", state.uiSpellHandler, true);
      }

      syncUi();
      return true;
    }

    function status() {
      const paralyzed = isParalyzedActive();
      return {
        running: state.running,
        config: { ...config },
        paralyzed,
        detectionSource: state.detectionSource,
        detectedElement: state.detectedElement
          ? {
              tag: state.detectedElement.tagName,
              id: state.detectedElement.id || null,
              className: String(state.detectedElement.className || "") || null,
            }
          : null,
        healPriorityActive: shouldPrioritizeHeal(),
        lastCastAt: state.lastCastAt,
      };
    }

    bot.antiParalyze = {
      start,
      stop,
      status,
      updateConfig,
      isParalyzedActive,
      shouldPrioritizeHeal,
      tryAntiParalyze,
      config,
    };
    bot.__antiParalyzeHotfixInstalled = true;
    bot.__antiParalyzeRuntimeFixInstalled = true;

    state.uiObserver = new MutationObserver(() => bindUiControls());
    state.uiObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(bindUiControls, 0);

    bot.addCleanup?.(() => {
      stop({ persistEnabled: false });
      state.uiObserver?.disconnect();
      if (state.uiToggle && state.uiToggleHandler) {
        state.uiToggle.removeEventListener("change", state.uiToggleHandler, true);
      }
      if (state.uiSpellInput && state.uiSpellHandler) {
        state.uiSpellInput.removeEventListener("change", state.uiSpellHandler, true);
      }
    });

    if (config.enabled) start();
    bot.log("anti-paralyze runtime detection installed");
    return true;
  }

  let attempts = 0;
  const timerId = window.setInterval(() => {
    attempts += 1;
    if (install(window.minibiaBot) || attempts >= MAX_INSTALL_ATTEMPTS) {
      window.clearInterval(timerId);
    }
  }, INSTALL_RETRY_MS);
})();