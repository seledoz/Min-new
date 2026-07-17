(() => {
  function install() {
    const bot = window.minibiaBot;
    const toggle = document.getElementById("minibia-bot-anti-paralyze-enabled");
    const spellInput = document.getElementById("minibia-bot-anti-paralyze-spell");
    if (!bot?.antiParalyze || !toggle || !spellInput) return false;
    if (toggle.dataset.antiParalyzeToggleFix === "true") return true;

    toggle.dataset.antiParalyzeToggleFix = "true";

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const shouldEnable = !bot.antiParalyze.status().running;
      const spellWords = String(spellInput.value || "").trim();

      if (shouldEnable) {
        bot.antiParalyze.start({ spellWords });
      } else {
        bot.antiParalyze.stop();
      }

      toggle.checked = !!bot.antiParalyze.status().running;
    }, true);

    return true;
  }

  let attempts = 0;
  const timerId = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 80) window.clearInterval(timerId);
  }, 100);
})();