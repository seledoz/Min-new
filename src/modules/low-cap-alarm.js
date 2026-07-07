window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installLowCapAlarm() {
  if (window.__minibiaLowCapAlarmIntervalId) {
    window.clearInterval(window.__minibiaLowCapAlarmIntervalId);
    window.__minibiaLowCapAlarmIntervalId = null;
  }
  window.__minibiaLowCapAlarmToken = (window.__minibiaLowCapAlarmToken || 0) + 1;
  const token = window.__minibiaLowCapAlarmToken;

  const storageKey = "minibiaBot.lowCapAlarm.config";
  const sectionId = "minibia-bot-low-cap-alarm-section";
  const enabledId = "minibia-bot-low-cap-alarm-enabled";
  const thresholdId = "minibia-bot-low-cap-alarm-threshold";
  const statusId = "minibia-bot-low-cap-alarm-status";

  const config = Object.assign(
    {
      enabled: false,
      threshold: 50,
      beepIntervalMs: 3000,
      alertDurationMs: 30000,
      scanMs: 500,
      voiceMessage: "Your cap is low",
    },
    JSON.parse(window.localStorage.getItem(storageKey) || "{}") || {}
  );

  let alarmStartedAt = 0;
  let lastBeepAt = 0;
  let speechUnlocked = false;

  function saveConfig() {
    try { window.localStorage.setItem(storageKey, JSON.stringify(config)); } catch (error) {}
  }

  function numberValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function getCap() {
    const pageText = String(document.body?.innerText || "");
    const patterns = [
      /(?:^|\b)(?:cap|capacity)\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*(?:cap|capacity)\b/i,
    ];
    for (const pattern of patterns) {
      const match = pageText.match(pattern);
      if (!match) continue;
      const number = Number(String(match[1]).replace(/,/g, ""));
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  function unlockSpeech() {
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
      speechUnlocked = true;
      window.speechSynthesis.resume?.();
      return true;
    } catch (error) {
      return false;
    }
  }

  function speakLowCap() {
    try {
      if (window.__minibiaLowCapAlarmToken !== token) return false;
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
      unlockSpeech();
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(config.voiceMessage || "Your cap is low");
      utterance.volume = 1;
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
      speechUnlocked = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  function startAlarm() {
    alarmStartedAt = Date.now();
    lastBeepAt = 0;
  }

  function updateStatus() {
    const status = document.getElementById(statusId);
    if (!status) return;
    const cap = getCap();
    const threshold = numberValue(config.threshold, 0);
    if (!config.enabled) {
      status.textContent = "Status: off";
    } else if (cap == null) {
      status.textContent = `Status: watching, cap number not found, threshold ${threshold}`;
    } else if (alarmStartedAt) {
      const remaining = Math.max(0, Math.ceil((config.alertDurationMs - (Date.now() - alarmStartedAt)) / 1000));
      status.textContent = `Status: LOW CAP ${cap} / ${threshold} (${remaining}s, voice ${speechUnlocked ? "ready" : "locked"})`;
    } else {
      status.textContent = `Status: cap ${cap} / threshold ${threshold}`;
    }
  }

  function tickAlarm() {
    if (window.__minibiaLowCapAlarmToken !== token) return;
    const now = Date.now();
    const cap = getCap();
    const threshold = numberValue(config.threshold, 0);
    const below = cap != null && cap < threshold;

    if (!config.enabled || !below) {
      alarmStartedAt = 0;
      lastBeepAt = 0;
      updateStatus();
      return;
    }

    if (!alarmStartedAt || now - alarmStartedAt > config.alertDurationMs) startAlarm();

    if (!lastBeepAt || now - lastBeepAt >= config.beepIntervalMs) {
      speakLowCap();
      lastBeepAt = now;
    }

    updateStatus();
  }

  function ensureUi() {
    const panel = document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
    if (!panel || document.getElementById(sectionId)) return;
    const firstColumn = panel.querySelector(".mb-main-column") || panel.querySelector(".mb-body") || panel;
    const section = document.createElement("div");
    section.id = sectionId;
    section.className = "mb-section mb-column-section";
    section.innerHTML = `
      <div class="mb-label">Low Cap Alarm</div>
      <div class="mb-stack">
        <label class="mb-toggle"><input type="checkbox" id="${enabledId}" /><span>Enable Low Cap Alarm</span></label>
        <div class="mb-row-three">
          <span>Cap Below</span>
          <input type="number" id="${thresholdId}" min="0" step="1" />
          <span>cap</span>
        </div>
        <div class="mb-small-note" id="${statusId}">Status: off</div>
      </div>`;
    firstColumn.prepend(section);

    const enabled = document.getElementById(enabledId);
    const threshold = document.getElementById(thresholdId);
    enabled.checked = !!config.enabled;
    threshold.value = String(numberValue(config.threshold, 50));

    section.addEventListener("pointerdown", unlockSpeech);
    section.addEventListener("click", unlockSpeech);

    enabled.addEventListener("change", () => {
      unlockSpeech();
      config.enabled = !!enabled.checked;
      if (!config.enabled) {
        alarmStartedAt = 0;
        lastBeepAt = 0;
        window.speechSynthesis?.cancel?.();
      }
      saveConfig();
      updateStatus();
    });

    threshold.addEventListener("input", () => {
      config.threshold = numberValue(threshold.value, config.threshold);
      saveConfig();
      updateStatus();
    });
  }

  function tick() {
    if (window.__minibiaLowCapAlarmToken !== token) return;
    ensureUi();
    tickAlarm();
  }

  tick();
  window.__minibiaLowCapAlarmIntervalId = window.setInterval(tick, Math.max(250, numberValue(config.scanMs, 500)));
})();
