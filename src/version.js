window.__minibiaBotBundle = window.__minibiaBotBundle || {};

/* ============================================================
   Informacoes de versao — preenchidas pelo build.sh

   O script de build (build.sh) substitui os placeholders
   %%BRANCH%%, %%COMMIT%% e %%DATE%% pelos valores reais
   do git no momento da construcao do bundle pz-bot.js.

   Para desenvolvimento local sem build, os placeholders
   permanecem como estao e o codigo usa "unknown" como fallback.
   ============================================================ */
window.__minibiaBotBundle.versionInfo = {
  number: "2.0.0",
  branch: "%%BRANCH%%",
  commit: "%%COMMIT%%",
  date: "%%DATE%%"
};

// Capture the Anti Paralyze toggle before its module-level change handler.
// The module synchronizes the UI while saving the spell, which otherwise
// resets a newly checked box before start() is called.
if (!document.__minNewAntiParalyzeToggleFixInstalled) {
  document.__minNewAntiParalyzeToggleFixInstalled = true;
  document.addEventListener(
    "change",
    (event) => {
      const toggle = event.target;
      if (!(toggle instanceof HTMLInputElement)) return;
      if (toggle.id !== "minibia-bot-anti-paralyze-enabled") return;

      const antiParalyze = window.minibiaBot?.antiParalyze;
      if (!antiParalyze) return;

      const shouldEnable = toggle.checked;
      const spellWords = String(
        document.getElementById("minibia-bot-anti-paralyze-spell")?.value || ""
      ).trim();

      event.stopImmediatePropagation();

      if (shouldEnable) {
        antiParalyze.start({ spellWords });
      } else {
        antiParalyze.stop();
      }

      toggle.checked = !!antiParalyze.status?.().running;
    },
    true
  );
}
