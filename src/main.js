(() => {
  const bundle = window.__minibiaBotBundle || window.__minibiaBotReloadBundle || {};
  const persistedEnabledModules = [
    ["rune", "minibiaBot.rune.config"],
    ["heal", "minibiaBot.heal.config"],
    ["antiParalyze", "minibiaBot.antiParalyzeV2.config"],
    ["autoHaste", "minibiaBot.autoHaste.config"],
    ["damageTtsAlert", "minibiaBot.damageTtsAlert.config"],
    ["invisible", "minibiaBot.invisible.config"],
    ["magicShield", "minibiaBot.magicShield.config"],
    ["attack", "minibiaBot.attack.config"],
    ["attackAoe", "minibiaBot.attackAoe.config"],
    ["greatFireballV2", "minibiaBot.greatFireballV2.config"],
    ["lureMode", "minibiaBot.lure.config"],
    ["attackExclude", "minibiaBot.attackExclude.config"],
    ["attackPriority", "minibiaBot.attackPriority.config"],
    ["redTextAlert", "minibiaBot.redTextAlert.config"],
    ["cave", "minibiaBot.cave.config"],
    ["caveForwardLoop", "minibiaBot.caveForwardLoop.config"],
    ["equipRing", "minibiaBot.equipRing.config"],
    ["mining", "minibiaBot.mining.config"],
    ["eat", "minibiaBot.eat.config"],
    ["talk", "minibiaBot.talk.config"],
    ["runeMakerDrop", "minibiaBot.runeMakerDrop.config"],
  ];

  function getPersistedEnabledSnapshot(bot) {
    const snapshot = {};
    const status = typeof bot?.status === "function" ? bot.status() : null;
    persistedEnabledModules.forEach(([moduleName]) => {
      const enabled = status?.[moduleName]?.config?.enabled;
      if (typeof enabled === "boolean") snapshot[moduleName] = enabled;
    });
    return snapshot;
  }

  function restorePersistedEnabledSnapshot(snapshot) {
    persistedEnabledModules.forEach(([moduleName, storageKey]) => {
      if (typeof snapshot?.[moduleName] !== "boolean") return;
      try {
        const rawValue = window.localStorage.getItem(storageKey);
        const config = rawValue ? JSON.parse(rawValue) : {};
        config.enabled = snapshot[moduleName];
        window.localStorage.setItem(storageKey, JSON.stringify(config));
      } catch (error) {
        console.error("[minibia-bot] failed to restore persisted enabled state", { module: moduleName, error });
      }
    });
  }

  function removePanelDebugSection() {
    const debugToggle = document.getElementById("minibia-bot-debug-enabled");
    const debugSection = debugToggle?.closest?.(".mb-section");
    if (debugSection) {
      debugSection.remove();
      return true;
    }

    const labels = Array.from(document.querySelectorAll("#minibia-bot-panel .mb-label"));
    const debugLabel = labels.find((label) => String(label.textContent || "").trim().toLowerCase() === "debug");
    debugLabel?.closest?.(".mb-section")?.remove();
    return !!debugLabel;
  }

  function boot(currentBundle = bundle) {
    const previousEnabledSnapshot = getPersistedEnabledSnapshot(window.minibiaBot);
    if (window.minibiaBot?.destroy) window.minibiaBot.destroy();
    restorePersistedEnabledSnapshot(previousEnabledSnapshot);

    const bot = currentBundle.createBot();
    currentBundle.installPzModule(bot);
    currentBundle.installXrayModule(bot);
    currentBundle.installPanicModule(bot);
    currentBundle.installRuneModule(bot);
    currentBundle.installHealModule(bot);
    currentBundle.installAntiParalyzeModule?.(bot);
    currentBundle.installAutoHasteModule?.(bot);
    currentBundle.installDamageTtsAlertModule?.(bot);
    currentBundle.installAutoInvisibleModule(bot);
    currentBundle.installAutoMagicShieldModule(bot);
    currentBundle.installAutoAttackModule(bot);
    bot.attack?.updateConfig?.({ maxTargetDistance: 7, runeCooldownMs: 2000 });
    currentBundle.installAutoAttackExcludeModule?.(bot);
    currentBundle.installAutoAttackAoeModule?.(bot);
    currentBundle.installRedTextAlertModule?.(bot);
    currentBundle.installCaveModule(bot);
    currentBundle.installCaveForwardLoopModule?.(bot);
    currentBundle.installCaveArrowKeysModule?.(bot);
    currentBundle.installEquipRingModule(bot);
    currentBundle.installMiningModule?.(bot);
    currentBundle.installAutoEatModule(bot);
    currentBundle.installTalkModule(bot);
    currentBundle.installPanel(bot);
    currentBundle.installCaveWaypointActionsModule?.(bot);

    bot.ui.inject();
    currentBundle.installRuneMakerDropModule?.(bot);
    currentBundle.installAutoAttackPriorityModule?.(bot);
    currentBundle.installGreatFireballV2Module?.(bot);
    currentBundle.installLureModeModule?.(bot);
    currentBundle.installGithubWaypointLibraryModule?.(bot);
    removePanelDebugSection();
    window.setTimeout(removePanelDebugSection, 0);
    bot.caveArrowKeys?.ensureDropdownOption?.();
    document.getElementById("minibia-bot-waypoint-profiles-section")?.remove();
    bot.start = (...args) => bot.rune.start(...args);
    bot.stop = (...args) => bot.rune.stop(...args);
    bot.reload = () => window.minibiaBotReload?.();
    bot.status = () => ({
      version: bot.version.number,
      branch: bot.version.branch,
      commit: bot.version.commit,
      pz: { home: bot.pz.getHomePz() },
      xray: bot.xray.status(),
      panic: bot.panic.status(),
      rune: bot.rune.status(),
      heal: bot.heal.status(),
      antiParalyze: bot.antiParalyze?.status?.() || null,
      autoHaste: bot.autoHaste?.status?.() || null,
      damageTtsAlert: bot.damageTtsAlert?.status?.() || null,
      invisible: bot.invisible.status(),
      magicShield: bot.magicShield.status(),
      attack: bot.attack.status(),
      attackExclude: bot.attackExclude?.status?.() || null,
      attackPriority: bot.attackPriority?.status?.() || null,
      attackAoe: bot.attackAoe?.status?.() || null,
      greatFireballV2: bot.greatFireballV2?.status?.() || null,
      lureMode: bot.lureMode?.status?.() || null,
      redTextAlert: bot.redTextAlert?.status?.() || null,
      cave: bot.cave.status(),
      caveForwardLoop: bot.caveForwardLoop?.status?.() || null,
      caveArrowKeys: bot.caveArrowKeys?.status?.() || null,
      githubWaypointLibrary: bot.githubWaypointLibrary ? { path: bot.githubWaypointLibrary.path } : null,
      equipRing: bot.equipRing.status(),
      mining: bot.mining?.status?.() || null,
      eat: bot.eat.status(),
      talk: bot.talk.status(),
      runeMakerDrop: bot.runeMakerDrop?.status?.() || null,
    });

    window.minibiaBot = bot;
    window.pzBot = bot.pz;
    console.log("[minibia-bot] ready", {
      version: bot.version.number,
      branch: bot.version.branch,
      commit: bot.version.commit,
      buildDate: bot.version.date,
      modules: ["pz", "xray", "panic", "rune", "heal", "antiParalyze", "autoHaste", "damageTtsAlert", "invisible", "magicShield", "attack", "attackExclude", "attackPriority", "attackAoe", "greatFireballV2", "lureMode", "redTextAlert", "cave", "caveForwardLoop", "caveArrowKeys", "caveWaypointActions", "githubWaypointLibrary", "equipRing", "mining", "eat", "talk", "runeMakerDrop", "ui"],
    });
    console.log("minibiaBot.reload()");
    console.log("minibiaBot.attackExclude.addName(\"monster name\")");
    console.log("minibiaBot.attackExclude.removeName(\"monster name\")");
    console.log("minibiaBot.attackPriority.addName(\"dragon lord\")");
    console.log("minibiaBot.attackPriority.moveName(\"dragon lord\", \"up\")");
    console.log("minibiaBot.attackPriority.removeName(\"dragon lord\")");
    console.log("minibiaBot.attackAoe.start({ spellHotbarSlot: 5, minMonsters: 3, squareRange: 3 })");
    console.log("minibiaBot.attackAoe.stop()");
    console.log("minibiaBot.greatFireballV2.start({ hotbarSlot: 8, minMonsters: 4 })");
    console.log("minibiaBot.greatFireballV2.stop()");
    console.log("minibiaBot.lureMode.updateConfig({ enabled: true, minMonsters: 3, maxDistance: 4 })");
    console.log("minibiaBot.redTextAlert.start()");
    console.log("minibiaBot.redTextAlert.stop()");
    console.log("minibiaBot.cave.start()");
    console.log("minibiaBot.cave.stop()");
    console.log("minibiaBot.damageTtsAlert.start()");
    console.log("minibiaBot.damageTtsAlert.stop()");
    console.log("minibiaBot.mining.start({ pickHotbarSlot: 5 })");
    console.log("minibiaBot.mining.stop()");
    return bot;
  }

  window.__minibiaBotReloadBundle = bundle;
  window.minibiaBotReload = () => boot(window.__minibiaBotReloadBundle || bundle);
  boot(bundle);
  delete window.__minibiaBotBundle;
})();