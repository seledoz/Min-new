window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installGmDefaultChatKillSwitch = function installGmDefaultChatKillSwitch(bot) {
  const state = {
    running: false,
    timerId: null,
    seenEntryKeys: new Set(),
  };

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function getDefaultChannels() {
    return (window.gameClient?.interface?.channelManager?.channels || []).filter(
      (channel) => normalizeName(channel?.name) === "default"
    );
  }

  function getEntryMessage(entry) {
    return String(entry?.message ?? entry?.text ?? entry?.content ?? "");
  }

  function getEntrySpeaker(entry, message) {
    const directSpeaker =
      entry?.speakerName ??
      entry?.speaker ??
      entry?.name ??
      entry?.author ??
      entry?.senderName ??
      entry?.sender;

    if (typeof directSpeaker === "string" && directSpeaker.trim()) {
      return directSpeaker.trim();
    }

    const saysMatch = message.match(/^(.+?)\s+says:\s*/i);
    return saysMatch?.[1]?.trim() || null;
  }

  function getEntryKey(channel, entry, index) {
    const message = getEntryMessage(entry);
    const time = entry?.__time ?? entry?.time ?? entry?.timestamp ?? "no-time";
    const speaker = getEntrySpeaker(entry, message) || "no-speaker";
    return `${channel?.name || "Default"}|${time}|${speaker}|${message}|${index}`;
  }

  function getCurrentEntries() {
    return getDefaultChannels().flatMap((channel) =>
      (channel?.__contents || []).map((entry, index) => ({
        channel,
        entry,
        index,
        message: getEntryMessage(entry),
      }))
    );
  }

  function rememberExistingEntries() {
    state.seenEntryKeys.clear();
    for (const item of getCurrentEntries()) {
      state.seenEntryKeys.add(getEntryKey(item.channel, item.entry, item.index));
    }
  }

  function stopAutomationForGmChat(speaker, message) {
    bot.playAlarm?.();
    bot.log("game master kill switch triggered from Default chat", {
      players: [speaker],
      speaker,
      message,
      source: "default-chat",
    });

    bot.rune?.stop?.();
    bot.eat?.stop?.();
    bot.invisible?.stop?.();
    bot.magicShield?.stop?.();
    bot.cave?.stop?.();
    bot.attack?.stop?.();
    bot.equipRing?.stop?.();

    if (bot.panic?.config) {
      bot.panic.config.unknownPlayerEnabled = false;
      bot.panic.config.healthLossEnabled = false;
      bot.panic.updateConfig?.({
        unknownPlayerEnabled: false,
        healthLossEnabled: false,
      });
      bot.panic.stop?.();
    }

    bot.ui?.refreshPanicStatus?.();
    bot.ui?.refreshRuneStatus?.();
    bot.ui?.refreshAutoEatStatus?.();
    bot.ui?.refreshAutoInvisibleStatus?.();
    bot.ui?.refreshAutoMagicShieldStatus?.();
    bot.ui?.refreshAutoAttackStatus?.();
    bot.ui?.refreshCaveStatus?.();
    bot.ui?.refreshEquipRingStatus?.();

    stop();
    return true;
  }

  function tick() {
    if (!state.running) return;

    const gmNames = new Set((bot.panic?.getGameMasterNames?.() || []).map(normalizeName));

    for (const item of getCurrentEntries()) {
      const key = getEntryKey(item.channel, item.entry, item.index);
      if (state.seenEntryKeys.has(key)) continue;
      state.seenEntryKeys.add(key);

      const speaker = getEntrySpeaker(item.entry, item.message);
      if (!speaker || !gmNames.has(normalizeName(speaker))) continue;

      stopAutomationForGmChat(speaker, item.message);
      return;
    }

    state.timerId = window.setTimeout(tick, Number(bot.panic?.config?.tickMs) || 200);
  }

  function start() {
    if (state.running) return false;
    state.running = true;
    rememberExistingEntries();
    tick();
    bot.log("GM Default chat kill switch watcher started");
    return true;
  }

  function stop() {
    if (!state.running && state.timerId == null) return false;
    state.running = false;
    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
    bot.log("GM Default chat kill switch watcher stopped");
    return true;
  }

  bot.gmDefaultChatKillSwitch = {
    start,
    stop,
    status: () => ({ running: state.running }),
  };

  start();
};
