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
  number: "2.1.0",
  branch: "%%BRANCH%%",
  commit: "%%COMMIT%%",
  date: "%%DATE%%"
};
