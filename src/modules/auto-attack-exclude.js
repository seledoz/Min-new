window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoAttackExcludeModule = function installAutoAttackExcludeModule(bot) {
  if (!bot || bot.attackExclude?.destroy) return bot?.attackExclude;

  const configStorageKey = "minibiaBot.attackExclude.config";
  const state = {
    installed: false,
    originalGetVisibleMonsters: null,
    uiTimerId: null,
  };

  const config = Object.assign(
    {
      enabled: true,
      excludedCreatureNames: [],
    },
    bot.storage.get(configStorageKey, {}) || {}
  );

  config.enabled = config.enabled !== false;
  config.excludedCreatureNames = normalizeNameList(config.excludedCreatureNames);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
    mirrorToAttackConfig();
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function normalizeDisplayName(name) {
    return String(name || "").trim();
  }

  function normalizeNameList(names) {
    const source = Array.isArray(names) ? names : String(names || "").split(/[\n,]/);
    return Array.from(new Set(source.map(normalizeName).filter(Boolean))).sort();
  }

  function isExcluded(creatureOrName) {
    if (!config.enabled) return false;
    const name = typeof creatureOrName === "string"
      ? normalizeName(creatureOrName)
      : normalizeName(creatureOrName?.name || "Mob");
    return !!name && config.excludedCreatureNames.includes(name);
  }

  function mirrorToAttackConfig() {
    if (bot.attack?.config) {
      bot.attack.config.excludedCreatureNames = [...config.excludedCreatureNames];
    }
  }

  function addName(name) {
    const normalized = normalizeName(name);
    if (!normalized) return false;
    if (!config.excludedCreatureNames.includes(normalized)) {
      config.excludedCreatureNames.push(normalized);
      config.excludedCreatureNames.sort();
      persistConfig();
    }
    refreshUiValues();
    return true;
  }

  function removeName(name) {
    const normalized = normalizeName(name);
    const before = config.excludedCreatureNames.length;
    config.excludedCreatureNames = config.excludedCreatureNames.filter((item) => item !== normalized);
    const removed = config.excludedCreatureNames.length !== before;
    if (removed) persistConfig();
    refreshUiValues();
    return removed;
  }

  function setNames(names) {
    config.excludedCreatureNames = normalizeNameList(names);
    persistConfig();
    refreshUiValues();
    return [...config.excludedCreatureNames];
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "enabled")) {
      config.enabled = nextConfig.enabled !== false;
    }
    if (Object.prototype.hasOwnProperty.call(nextConfig, "excludedCreatureNames")) {
      config.excludedCreatureNames = normalizeNameList(nextConfig.excludedCreatureNames);
    }
    persistConfig();
    refreshUiValues();
    return { ...config };
  }

  function installFilter() {
    if (state.installed || !bot.xray || typeof bot.xray.getVisibleMonsters !== "function") return false;
    state.originalGetVisibleMonsters = bot.xray.getVisibleMonsters.bind(bot.xray);
    bot.xray.getVisibleMonsters = function getVisibleMonstersWithExclusions(options = {}) {
      const monsters = state.originalGetVisibleMonsters(options) || [];
      if (options?.includeExcluded || !config.enabled || !config.excludedCreatureNames.length) {
        return monsters;
      }
      return monsters.filter((monster) => !isExcluded(monster));
    };
    state.installed = true;
    mirrorToAttackConfig();
    return true;
  }

  function uninstallFilter() {
    if (state.installed && state.originalGetVisibleMonsters && bot.xray) {
      bot.xray.getVisibleMonsters = state.originalGetVisibleMonsters;
    }
    state.installed = false;
    state.originalGetVisibleMonsters = null;
  }

  function status() {
    return {
      installed: state.installed,
      config: { ...config, excludedCreatureNames: [...config.excludedCreatureNames] },
    };
  }

  function findAutoAttackAnchor(panel) {
    return document.getElementById("minibia-bot-auto-attack-enabled")?.closest(".mb-section") ||
      document.getElementById("minibia-bot-auto-attack-enabled")?.parentElement ||
      panel.querySelector(".mb-cave-column") ||
      panel.querySelector(".mb-main-column") ||
      panel.querySelector(".mb-body") ||
      panel;
  }

  function ensureUi() {
    const panel = document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
    if (!panel || document.getElementById("minibia-bot-auto-attack-exclude-section")) return;

    const section = document.createElement("div");
    section.className = "mb-section mb-column-section";
    section.id = "minibia-bot-auto-attack-exclude-section";
    section.innerHTML = `
      <div class="mb-label">Exclude Monsters</div>
      <div class="mb-stack">
        <label class="mb-toggle">
          <input type="checkbox" id="minibia-bot-auto-attack-exclude-enabled" />
          <span>Do not target excluded monsters</span>
        </label>
        <div class="mb-inline">
          <input type="text" id="minibia-bot-auto-attack-exclude-input" placeholder="Monster name" />
          <button type="button" class="mb-small-button" id="minibia-bot-auto-attack-exclude-add">Add</button>
        </div>
        <div class="mb-list" id="minibia-bot-auto-attack-exclude-list"></div>
        <div class="mb-small-note">Names are not case-sensitive. Excluded monsters are ignored by Auto Attack and AoE.</div>
      </div>
    `;

    const anchor = findAutoAttackAnchor(panel);
    const aoeSection = document.getElementById("minibia-bot-auto-attack-aoe-section");
    if (aoeSection?.parentElement) {
      aoeSection.insertAdjacentElement("afterend", section);
    } else if (anchor?.parentElement) {
      anchor.insertAdjacentElement("afterend", section);
    } else {
      (panel.querySelector(".mb-cave-column") || panel.querySelector(".mb-body") || panel).appendChild(section);
    }

    const enabledInput = section.querySelector("#minibia-bot-auto-attack-exclude-enabled");
    const nameInput = section.querySelector("#minibia-bot-auto-attack-exclude-input");
    const addButton = section.querySelector("#minibia-bot-auto-attack-exclude-add");

    enabledInput?.addEventListener("change", () => updateConfig({ enabled: enabledInput.checked }));
    addButton?.addEventListener("click", () => {
      if (addName(nameInput?.value)) nameInput.value = "";
    });
    nameInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (addName(nameInput.value)) nameInput.value = "";
      }
    });

    refreshUiValues();
  }

  function refreshUiValues() {
    const enabledInput = document.getElementById("minibia-bot-auto-attack-exclude-enabled");
    const list = document.getElementById("minibia-bot-auto-attack-exclude-list");

    if (enabledInput) enabledInput.checked = !!config.enabled;
    if (!list) return;

    list.innerHTML = "";
    if (!config.excludedCreatureNames.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "No excluded monsters.";
      list.appendChild(empty);
      return;
    }

    config.excludedCreatureNames.forEach((name) => {
      const row = document.createElement("div");
      row.className = "mb-list-row";
      const label = document.createElement("span");
      label.textContent = name;
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "mb-small-button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => removeName(name));
      row.appendChild(label);
      row.appendChild(removeButton);
      list.appendChild(row);
    });
  }

  function destroy() {
    uninstallFilter();
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    document.getElementById("minibia-bot-auto-attack-exclude-section")?.remove();
  }

  bot.attackExclude = {
    installFilter,
    uninstallFilter,
    status,
    updateConfig,
    addName,
    removeName,
    setNames,
    isExcluded,
    destroy,
    config,
  };

  installFilter();
  state.uiTimerId = window.setInterval(() => { ensureUi(); refreshUiValues(); }, 1000);
  bot.addCleanup(destroy);
  ensureUi();
  return bot.attackExclude;
};
