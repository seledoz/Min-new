window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(() => {
  const STORAGE_KEY = "minibiaBot.antiParalyze.config";
  const INSTALL_RETRY_MS = 250;
  const MAX_INSTALL_ATTEMPTS = 80;
  const PARALYZE_PATTERN = /\b(paraly(?:ze|zed|sis|sed|se)?|paralis(?:ia|ed|is|ysed|yzed)?)\b/i;

  function install(bot) {
    if (!bot || bot.__antiParalyzeHotfixInstalled) return !!bot;

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
      observer: null,
      statusDirty: true,
      cachedParalyzed: false,
    };

    function persistConfig() {
      bot.storage.set(STORAGE_KEY, { ...config });
    }

    function isVisible(element) {
      if (!(element instanceof Element)) return false;
      if (element.closest("#minibia-bot-panel")) return false;

      const style = window.getComputedStyle?.(element);
      if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) {
        return false;
      }

      const rect = element.getBoundingClientRect?.();
      return !!rect && rect.width > 0 && rect.height > 0;
    }

    function readElementSignals(element) {
      if (!(element instanceof Element)) return "";

      const values = [
        element.getAttribute("title"),
        element.getAttribute("aria-label"),
        element.getAttribute("alt"),
        element.getAttribute("data-condition"),
        element.getAttribute("data-status"),
        element.getAttribute("data-effect"),
        element.getAttribute("data-tooltip"),
        element.getAttribute("name"),
        element.id,
        element.className,
        element.textContent,
      ];

      if (element instanceof HTMLImageElement) {
        values.push(element.currentSrc, element.src);
      }

      const style = element.getAttribute("style");
      if (style) values.push(style);

      try {
        const backgroundImage = window.getComputedStyle(element).backgroundImage;
        if (backgroundImage && backgroundImage !== "none") values.push(backgroundImage);
      } catch (_error) {
        // Ignore elements that disappear while the status window is updating.
      }

      return values
        .filter((value) => value != null && value !== "")
        .map(String)
        .join(" ");
    }

    function looksLikeStatusContainer(element) {
      if (!(element instanceof Element)) return false;
      if (element.closest("#minibia-bot-panel")) return false;

      const identity = [
        element.id,
        element.className,
        element.getAttribute("role"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-window"),
        element.getAttribute("data-panel"),
      ]
        .filter(Boolean)
        .join(" ");

      return /(status|condition|effect|buff|debuff|character|state|icon)/i.test(identity);
    }

    function collectStatusRoots() {
      const roots = new Set();
      const selectors = [
        '[id*="status" i]',
        '[class*="status" i]',
        '[id*="condition" i]',
        '[class*="condition" i]',
        '[id*="effect" i]',
        '[class*="effect" i]',
        '[id*="buff" i]',
        '[class*="buff" i]',
        '[id*="debuff" i]',
        '[class*="debuff" i]',
        '[aria-label*="status" i]',
        '[title*="status" i]',
        '[data-window*="status" i]',
        '[data-panel*="status" i]',
      ];

      document.querySelectorAll(selectors.join(",")).forEach((element) => {
        if (looksLikeStatusContainer(element) && isVisible(element)) roots.add(element);
      });

      // Some clients use a generic window with a heading such as “Status”.
      document.querySelectorAll("div, section, aside, ul").forEach((element) => {
        if (!isVisible(element)) return;
        const ownLabel = [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.firstElementChild?.textContent,
        ]
          .filter(Boolean)
          .join(" ")
          .trim();
        if (/^(character\s+)?status(?:\s+effects?)?$/i.test(ownLabel)) roots.add(element);
      });

      return [...roots];
    }

    function findParalyzeInStatusWindow() {
      const roots = collectStatusRoots();

      for (const root of roots) {
        const candidates = [root, ...root.querySelectorAll("[title], [aria-label], [alt], [data-condition], [data-status], [data-effect], [data-tooltip], img, span, div")];
        for (const element of candidates) {
          if (!isVisible(element)) continue;
          const signals = readElementSignals(element);
          if (!PARALYZE_PATTERN.test(signals)) continue;

          state.detectedElement = element;
          state.detectionSource = `status-window:${element.id || element.className || element.tagName}`;
          return true;
        }
      }

      state.detectedElement = null;
      return false;
    }

    function isParalyzedActive() {
      state.detectionSource = null;

      if (!state.statusDirty) return state.cachedParalyzed;

      state.cachedParalyzed = findParalyzeInStatusWindow();
      state.statusDirty = false;
      return state.cachedParalyzed;
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

    function scheduleNextTick() {
      if (!state.running) return;
      state.timerId = window.setTimeout(tick, Math.max(25, Number(config.tickMs) || 50));
    }

    function tick() {
      if (!state.running) return;
      try {
        // Re-scan each tick even if the client changes an existing icon without adding a DOM node.
        state.statusDirty = true;
        tryAntiParalyze();
      } catch (error) {
        bot.log("anti-paralyze status-window tick failed", error?.message || error);
      } finally {
        scheduleNextTick();
      }
    }

    function startObserver() {
      if (state.observer || !document.documentElement) return;
      state.observer = new MutationObserver(() => {
        state.statusDirty = true;
      });
      state.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
        attributeFilter: [
          "class",
          "style",
          "title",
          "aria-label",
          "alt",
          "src",
          "data-condition",
          "data-status",
          "data-effect",
          "data-tooltip",
        ],
      });
    }

    function start(overrides = {}) {
      Object.assign(config, overrides, { enabled: true });
      config.spellWords = String(config.spellWords || "").trim();
      persistConfig();
      if (state.running) return false;
      state.running = true;
      state.statusDirty = true;
      startObserver();
      tick();
      bot.log("anti-paralyze status-window monitor started", { ...config });
      return true;
    }

    function stop(options = {}) {
      state.running = false;
      state.cachedParalyzed = false;
      state.detectedElement = null;
      if (state.timerId != null) {
        window.clearTimeout(state.timerId);
        state.timerId = null;
      }
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }
      if (options.persistEnabled !== false) {
        config.enabled = false;
        persistConfig();
      }
      return true;
    }

    function updateConfig(nextConfig = {}) {
      if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
        nextConfig.spellWords = String(nextConfig.spellWords || "").trim();
      }
      Object.assign(config, nextConfig);
      persistConfig();
      return { ...config };
    }

    function status() {
      state.statusDirty = true;
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

    bot.addCleanup?.(() => {
      if (state.timerId != null) window.clearTimeout(state.timerId);
      state.observer?.disconnect?.();
      state.running = false;
    });

    if (config.enabled) start();
    bot.log("anti-paralyze status-window detection installed");
    return true;
  }

  let attempts = 0;
  const timerId = window.setInterval(() => {
    attempts += 1;
    const bot = window.minibiaBot;
    if (install(bot) || attempts >= MAX_INSTALL_ATTEMPTS) {
      window.clearInterval(timerId);
    }
  }, INSTALL_RETRY_MS);
})();