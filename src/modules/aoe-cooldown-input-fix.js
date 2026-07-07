window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function makeAoeCooldownInputsEditable() {
  const bindings = [
    { id: "minibia-bot-auto-attack-aoe-cooldown", key: "cooldownMs" },
    { id: "minibia-bot-gfb-cooldown", key: "gfbCooldownMs" },
    { id: "minibia-bot-energy-wave-cooldown", key: "energyWaveCooldownMs" },
  ];
  const drafts = new Map();

  function getNumber(value) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function save(input, key) {
    const number = getNumber(input.value);
    if (number === null) return;
    try {
      window.minibiaBot?.attackAoe?.updateConfig?.({ [key]: number }, { silent: true });
    } catch (error) {}
  }

  function bind(binding) {
    const input = document.getElementById(binding.id);
    if (!input || input.dataset.aoeCooldownFixInstalled === "true") return false;
    input.dataset.aoeCooldownFixInstalled = "true";

    input.addEventListener("focus", () => drafts.set(binding.id, input.value));
    input.addEventListener("input", () => {
      drafts.set(binding.id, input.value);
      save(input, binding.key);
    });
    input.addEventListener("change", () => {
      drafts.set(binding.id, input.value);
      save(input, binding.key);
    });
    input.addEventListener("blur", () => {
      save(input, binding.key);
      drafts.delete(binding.id);
    });
    return true;
  }

  function keepFocusedDraftVisible() {
    for (const binding of bindings) {
      const input = document.getElementById(binding.id);
      if (!input || document.activeElement !== input || !drafts.has(binding.id)) continue;
      const draft = drafts.get(binding.id);
      if (input.value !== draft) input.value = draft;
    }
  }

  function tick() {
    bindings.forEach(bind);
    keepFocusedDraftVisible();
  }

  tick();
  window.setInterval(tick, 250);
})();
