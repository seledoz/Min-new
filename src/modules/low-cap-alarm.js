window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installLowCapAlarm() {
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
    },
    JSON.parse(window.localStorage.getItem(storageKey) || "{}") || {}
  );

  let alarmStartedAt = 0;
  let lastBeepAt = 0;
  let wasBelow = false;
  let audioContext = null;
  let lastCapSource = "unknown";

  function saveConfig() {
    try { window.localStorage.setItem(storageKey, JSON.stringify(config)); } catch (error) {}
  }

  function numberValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function parseCapText(text) {
    const value = String(text || "");
    const patterns = [
      /\bcap(?:acity)?\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
      /\b(\d+(?:\.\d+)?)\s*cap\b/i,
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (!match) continue;
      const number = Number(match[1]);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  function getVisibleTextCap() {
    const elements = Array.from(document.body?.querySelectorAll?.("*") || []);
    for (const element of elements) {
      if (element.closest?.("#minibia-bot-panel, #k9x-panel, script, style")) continue;
      const rect = element.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) <= 0.02) continue;
      const ownText = Array.from(element.childNodes || [])
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
        .trim();
      const parsed = parseCapText(ownText || element.textContent || "");
      if (parsed != null) return parsed;
    }
    return null;
  }

  function getCap() {
    const textCap = getVisibleTextCap();
    if (textCap != null) {
      lastCapSource = "visible text";
      return textCap;
    }

    const player = window.gameClient?.player;
    const candidates = [
      player?.capacity,
      player?.cap,
      player?.freeCapacity,
      player?.freeCap,
      player?.stats?.capacity,
      player?.stats?.cap,
      player?.__capacity,
      player?.__cap,
    ];
    for (const value of candidates) {
      const number = Number(value);
      if (Number.isFinite(number)) {
        lastCapSource = "client value";
        return number;
      }
    }
    lastCapSource = "unknown";
    return null;
  }

  function getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext || audioContext.state === "closed") audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") audioContext.resume?.().catch?.(() => {});
    return audioContext;
  }

  function playChaChing() {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;

    function tone(start, frequency, duration, gainValue) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(gainValue, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + duration + 0.02);
    }

    tone(0.00, 1320, 0.16, 0.22);
    tone(0.16, 1760, 0.18, 0.24);
    tone(0.36, 988, 0.22, 0.18);
    return true;
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
      status.textContent = `Status: watching, cap unknown, threshold ${threshold}`;
    } else if (alarmStartedAt) {
      const remaining = Math.max(0, Math.ceil((config.alertDurationMs - (Date.now() - alarmStartedAt)) / 1000));
      status.textContent = `Status: LOW CAP ${cap} / ${threshold} (${remaining}s)`;
    } else {
      status.textContent = `Status: cap ${cap} / threshold ${threshold} (${lastCapSource})`;
    }
  }

  function tickAlarm() {
    const now = Date.now();
    const cap = getCap();
    const threshold = numberValue(config.threshold, 0);
    const below = cap != null && cap < threshold;

    if (config.enabled && below && !wasBelow) startAlarm();
    wasBelow = below;

    if (!config.enabled || !below) {
      alarmStartedAt = 0;
      lastBeepAt = 0;
      updateStatus();
      return;
    }

    if (alarmStartedAt && now - alarmStartedAt <= config.alertDurationMs) {
      if (!lastBeepAt || now - lastBeepAt >= config.beepIntervalMs) {
        if (playChaChing()) lastBeepAt = now;
      }
    } else {
      alarmStartedAt = 0;
      lastBeepAt = 0;
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

    enabled.addEventListener("change", () => {
      config.enabled = !!enabled.checked;
      if (!config.enabled) {
        alarmStartedAt = 0;
        lastBeepAt = 0;
        wasBelow = false;
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
    ensureUi();
    tickAlarm();
  }

  tick();
  window.setInterval(tick, Math.max(250, numberValue(config.scanMs, 500)));
})();
