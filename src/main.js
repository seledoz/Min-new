(() => {
  const bundle = window.__minibiaBotBundle || window.__minibiaBotReloadBundle || {};
  const persistedEnabledModules = [
    ["rune", "minibiaBot.rune.config"],
    ["heal", "minibiaBot.heal.config"],
    ["damageTtsAlert", "minibiaBot.damageTtsAlert.config"],
    ["invisible", "minibiaBot.invisible.config"],
    ["magicShield", "minibiaBot.magicShield.config"],
    ["attack", "minibiaBot.attack.config"],
    ["attackAoe", "minibiaBot.attackAoe.config"],
    ["attackExclude", "minibiaBot.attackExclude.config"],
    ["redTextAlert", "minibiaBot.redTextAlert.config"],
    ["cave", "minibiaBot.cave.config"],
    ["caveForwardLoop", "minibiaBot.caveForwardLoop.config"],
    ["equipRing", "minibiaBot.equipRing.config"],
    ["mining", "minibiaBot.mining.config"],
    ["eat", "minibiaBot.eat.config"],
    ["talk", "minibiaBot.talk.config"],
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

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function getTileDistance(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(Number(from.x) - Number(to.x)), Math.abs(Number(from.y) - Number(to.y)));
  }

  function clearCreatureTarget(target) {
    const player = window.gameClient?.player;
    if (!target?.id || !player || typeof window.gameClient?.send !== "function") return false;

    let cleared = false;
    if (player.__target?.id === target.id && typeof TargetPacket === "function") {
      player.setTarget(null);
      window.gameClient.send(new TargetPacket(0));
      cleared = true;
    }

    if (player.__followTarget?.id === target.id && typeof FollowPacket === "function") {
      player.setFollowTarget(null);
      window.gameClient.send(new FollowPacket(0));
      cleared = true;
    }

    return cleared;
  }

  function getNextCaveIndex(caveStatus) {
    const routeLength = Array.isArray(caveStatus?.route) ? caveStatus.route.length : 0;
    if (routeLength <= 1) return caveStatus?.currentIndex || 0;

    let direction = Number(caveStatus?.direction) || 1;
    let nextIndex = (Number(caveStatus?.currentIndex) || 0) + direction;

    if (nextIndex >= routeLength) {
      nextIndex = routeLength - 2;
    } else if (nextIndex < 0) {
      nextIndex = 1;
    }

    return Math.max(0, Math.min(routeLength - 1, nextIndex));
  }

  function installCaveCombatAntiStuckGuard(bot) {
    const ignoredTargetIds = new Map();
    let lastHandledTargetId = null;
    let lastHandledAt = 0;

    const timerId = window.setInterval(() => {
      try {
        const now = Date.now();
        for (const [id, expiresAt] of ignoredTargetIds.entries()) {
          if (expiresAt <= now) ignoredTargetIds.delete(id);
        }

        const caveStatus = bot.cave?.status?.();
        const attackStatus = bot.attack?.status?.();
        const currentTarget = bot.attack?.getCurrentTarget?.();
        const currentTargetId = currentTarget?.id || attackStatus?.currentTarget?.id || null;
        if (currentTargetId && ignoredTargetIds.has(currentTargetId)) {
          clearCreatureTarget(currentTarget || attackStatus.currentTarget);
          return;
        }

        if (!caveStatus?.running || !caveStatus.pausedForCombat || !attackStatus?.combatActive) return;
        const stuckForMs = now - Number(caveStatus.lastProgressAt || now);
        if (stuckForMs < 3000) return;

        const playerPosition = normalizePosition(bot.getPlayerPosition?.());
        const targetPosition = normalizePosition(currentTarget?.getPosition?.() || currentTarget?.__position || attackStatus.currentTarget?.position);
        if (!playerPosition || !targetPosition || playerPosition.z !== targetPosition.z) return;

        const distance = getTileDistance(playerPosition, targetPosition);
        if (distance <= 1) return;

        const targetId = currentTargetId;
        if (!targetId) return;
        if (targetId === lastHandledTargetId && now - lastHandledAt < 4000) return;

        ignoredTargetIds.set(targetId, now + 10000);
        clearCreatureTarget(currentTarget || attackStatus.currentTarget);
        bot.cave?.setCurrentIndex?.(getNextCaveIndex(caveStatus));
        lastHandledTargetId = targetId;
        lastHandledAt = now;

        bot.log("cave combat anti-stuck skipped target and advanced waypoint", {
          targetId,
          targetName: currentTarget?.name || attackStatus.currentTarget?.name || "Mob",
          distance,
          stuckForMs,
          ignoredForMs: 10000,
          nextIndex: getNextCaveIndex(caveStatus) + 1,
        });
      } catch (error) {
        bot.log?.("cave combat anti-stuck guard failed", error?.message || error);
      }
    }, 250);

    bot.addCleanup?.(() => window.clearInterval(timerId));
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
    currentBundle.installDamageTtsAlertModule?.(bot);
    currentBundle.installAutoInvisibleModule(bot);
    currentBundle.installAutoMagicShieldModule(bot);
    currentBundle.installAutoAttackModule(bot);
    bot.attack?.updateConfig?.({ maxTargetDistance: 7 });
    currentBundle.installAutoAttackExcludeModule?.(bot);
    currentBundle.installAutoAttackAoeModule?.(bot);
    currentBundle.installRedTextAlertModule?.(bot);
    currentBundle.installCaveModule(bot);
    installCaveCombatAntiStuckGuard(bot);
    currentBundle.installCaveForwardLoopModule?.(bot);
    currentBundle.installCaveArrowKeysModule?.(bot);
    currentBundle.installEquipRingModule(bot);
    currentBundle.installMiningModule?.(bot);
    currentBundle.installAutoEatModule(bot);
    currentBundle.installTalkModule(bot);
    currentBundle.installPanel(bot);
    currentBundle.installCaveWaypointActionsModule?.(bot);

    bot.ui.inject();
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
      damageTtsAlert: bot.damageTtsAlert?.status?.() || null,
      invisible: bot.invisible.status(),
      magicShield: bot.magicShield.status(),
      attack: bot.attack.status(),
      attackExclude: bot.attackExclude?.status?.() || null,
      attackAoe: bot.attackAoe?.status?.() || null,
      redTextAlert: bot.redTextAlert?.status?.() || null,
      cave: bot.cave.status(),
      caveForwardLoop: bot.caveForwardLoop?.status?.() || null,
      caveArrowKeys: bot.caveArrowKeys?.status?.() || null,
      equipRing: bot.equipRing.status(),
      mining: bot.mining?.status?.() || null,
      eat: bot.eat.status(),
      talk: bot.talk.status(),
    });

    window.minibiaBot = bot;
    window.pzBot = bot.pz;
    console.log("[minibia-bot] ready", {
      version: bot.version.number,
      branch: bot.version.branch,
      commit: bot.version.commit,
      buildDate: bot.version.date,
      modules: ["pz", "xray", "panic", "rune", "heal", "damageTtsAlert", "invisible", "magicShield", "attack", "attackExclude", "attackAoe", "redTextAlert", "cave", "caveForwardLoop", "caveArrowKeys", "caveWaypointActions", "equipRing", "mining", "eat", "talk", "ui"],
    });
    console.log("minibiaBot.reload()");
    console.log("minibiaBot.attackExclude.addName(\"monster name\")");
    console.log("minibiaBot.attackExclude.removeName(\"monster name\")");
    console.log("minibiaBot.attackAoe.start({ spellHotbarSlot: 5, minMonsters: 3, squareRange: 3 })");
    console.log("minibiaBot.attackAoe.stop()");
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