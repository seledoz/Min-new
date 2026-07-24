window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installHasteParalyzeMonsterRangeGuard = function installHasteParalyzeMonsterRangeGuard(bot) {
  const MONSTER_BLOCK_RANGE = 4;

  if (!bot || typeof bot.sendChat !== "function" || bot.__hasteParalyzeMonsterRangeGuardInstalled) {
    return;
  }

  function normalizePosition(value) {
    if (!value) return null;

    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

    return {
      x: Math.trunc(x),
      y: Math.trunc(y),
      z: Math.trunc(z),
    };
  }

  function getCreaturePosition(creature) {
    return normalizePosition(creature?.getPosition?.() || creature?.__position || creature?.position);
  }

  function getPlayerPosition() {
    return normalizePosition(bot.getPlayerPosition?.() || window.gameClient?.player?.getPosition?.());
  }

  function getTileDistance(from, to) {
    if (!from || !to || from.z !== to.z) return Number.POSITIVE_INFINITY;

    return Math.max(
      Math.abs(from.x - to.x),
      Math.abs(from.y - to.y)
    );
  }

  function getMonstersWithinRange(range = MONSTER_BLOCK_RANGE) {
    const playerPosition = getPlayerPosition();
    if (!playerPosition) return [];

    const monsters = bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || [];
    return monsters.filter((monster) => {
      const monsterPosition = getCreaturePosition(monster);
      return getTileDistance(playerPosition, monsterPosition) <= range;
    });
  }

  function normalizeSpellWords(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getBlockedModuleForMessage(message) {
    const normalizedMessage = normalizeSpellWords(message);
    if (!normalizedMessage) return null;

    const autoHasteStatus = bot.autoHaste?.status?.();
    const hasteWords = normalizeSpellWords(bot.autoHaste?.config?.spellWords);
    if (
      hasteWords &&
      normalizedMessage === hasteWords &&
      autoHasteStatus?.running &&
      bot.autoHaste?.config?.enabled
    ) {
      return "auto haste";
    }

    const antiParalyzeStatus = bot.antiParalyze?.status?.();
    const antiParalyzeWords = normalizeSpellWords(bot.antiParalyze?.config?.spellWords);
    if (
      antiParalyzeWords &&
      normalizedMessage === antiParalyzeWords &&
      antiParalyzeStatus?.running &&
      bot.antiParalyze?.config?.enabled
    ) {
      return "anti-paralyze";
    }

    const runeStatus = bot.rune?.status?.();
    const runeWords = normalizeSpellWords(bot.rune?.config?.runeSpellWords);
    if (
      runeWords &&
      normalizedMessage === runeWords &&
      runeStatus?.running &&
      bot.rune?.config?.enabled
    ) {
      return "magic level trainer";
    }

    return null;
  }

  const originalSendChat = bot.sendChat.bind(bot);

  bot.sendChat = function guardedSendChat(message, ...args) {
    const blockedModule = getBlockedModuleForMessage(message);
    if (blockedModule) {
      const nearbyMonsters = getMonstersWithinRange();
      if (nearbyMonsters.length > 0) {
        bot.logDebug?.(`blocked ${blockedModule} cast near monsters`, {
          range: MONSTER_BLOCK_RANGE,
          monsterCount: nearbyMonsters.length,
          monsters: nearbyMonsters.map((monster) => ({
            id: monster?.id ?? null,
            name: monster?.name || monster?.getName?.() || "Monster",
            position: getCreaturePosition(monster),
          })),
        });
        return false;
      }
    }

    return originalSendChat(message, ...args);
  };

  bot.__hasteParalyzeMonsterRangeGuardInstalled = true;
  bot.hasteParalyzeMonsterRangeGuard = {
    range: MONSTER_BLOCK_RANGE,
    getMonstersWithinRange,
    isBlocked: () => getMonstersWithinRange().length > 0,
  };

  bot.log("haste, anti-paralyze, and magic trainer monster range guard installed", {
    range: MONSTER_BLOCK_RANGE,
  });
};