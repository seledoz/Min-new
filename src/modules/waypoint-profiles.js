window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installWaypointProfilesModule = function installWaypointProfilesModule(bot) {
  if (!bot || bot.waypointProfiles?.destroy) return bot?.waypointProfiles;

  const repository = "seledoz/min-new";
  const ref = "main";
  const rawBaseUrl = `https://raw.githubusercontent.com/${repository}/${ref}`;
  const manifestPath = "waypoint-profiles/manifest.json";

  const state = {
    profiles: [],
    lastLoadedAt: 0,
    lastError: null,
    uiTimerId: null,
  };

  function normalizeName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function normalizeRoute(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        const x = Number(entry?.x);
        const y = Number(entry?.y);
        const z = Number(entry?.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
      })
      .filter(Boolean);
  }

  function normalizeTransitions(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        const from = normalizeRoute([entry?.from])[0];
        const to = normalizeRoute([entry?.to])[0];
        if (!from || !to) return null;
        return {
          from,
          to,
          count: Math.max(1, Math.trunc(Number(entry?.count) || 1)),
          lastSeenAt: Number(entry?.lastSeenAt) || Date.now(),
        };
      })
      .filter(Boolean);
  }

  function normalizeManifest(value) {
    const profiles = Array.isArray(value?.profiles) ? value.profiles : [];
    return profiles
      .map((profile) => ({
        name: normalizeName(profile?.name),
        file: String(profile?.file || "").trim(),
        description: String(profile?.description || "").trim(),
      }))
      .filter((profile) => profile.name && profile.file && !profile.file.includes(".."));
  }

  async function fetchJson(path) {
    const response = await fetch(`${rawBaseUrl}/${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${path}`);
    return response.json();
  }

  async function refreshManifest() {
    try {
      const manifest = await fetchJson(manifestPath);
      state.profiles = normalizeManifest(manifest);
      state.lastLoadedAt = Date.now();
      state.lastError = null;
      renderProfiles();
      refreshUiValues();
      bot.log("waypoint profile manifest loaded", { profiles: state.profiles.length });
      return [...state.profiles];
    } catch (error) {
      state.lastError = error?.message || String(error);
      refreshUiValues();
      bot.log("waypoint profile manifest failed", { error: state.lastError });
      return [];
    }
  }

  async function loadProfile(nameOrFile) {
    const requested = String(nameOrFile || "").trim();
    const profile = state.profiles.find((entry) =>
      entry.name.toLowerCase() === requested.toLowerCase() || entry.file.toLowerCase() === requested.toLowerCase()
    );

    if (!profile) throw new Error(`Waypoint profile not found: ${requested}`);

    const data = await fetchJson(`waypoint-profiles/${profile.file}`);
    const route = normalizeRoute(data.route || data.waypoints);
    const transitions = normalizeTransitions(data.transitions);
    const profileName = normalizeName(data.name || profile.name);

    if (!route.length) throw new Error(`Waypoint profile has no valid waypoints: ${profile.name}`);

    bot.cave?.stop?.();
    bot.cave?.createPreset?.(profileName);
    bot.storage.set("minibiaBot.cave.presets", mergePresetIntoStorage(profileName, route, transitions));
    bot.storage.set("minibiaBot.cave.route", route);
    bot.storage.set("minibiaBot.cave.transitions", transitions);
    bot.cave?.updateConfig?.({ activePresetName: profileName });

    bot.log("waypoint profile loaded from GitHub", {
      name: profileName,
      waypoints: route.length,
      transitions: transitions.length,
    });

    window.setTimeout(() => window.minibiaBotReload?.(), 100);
    return { name: profileName, route, transitions };
  }

  function mergePresetIntoStorage(name, route, transitions) {
    const existing = Array.isArray(bot.storage.get("minibiaBot.cave.presets", []))
      ? bot.storage.get("minibiaBot.cave.presets", [])
      : [];
    const preset = { name, route, transitions };
    const filtered = existing.filter((entry) => String(entry?.name || "").toLowerCase() !== name.toLowerCase());
    filtered.push(preset);
    return filtered;
  }

  function exportCurrentRoute() {
    const status = bot.cave?.status?.();
    const route = normalizeRoute(status?.route || []);
    const transitions = normalizeTransitions(status?.transitions || []);
    const name = normalizeName(status?.activePresetName || "Waypoint Profile");
    return {
      name,
      route,
      transitions,
      exportedAt: new Date().toISOString(),
    };
  }

  function getMount(panel) {
    return panel.querySelector(".mb-side-column") ||
      panel.querySelector(".mb-main-column") ||
      panel.querySelector(".mb-body") ||
      panel;
  }

  function moveSectionToTop(section, panel) {
    const mount = getMount(panel);
    const excludeSection = document.getElementById("minibia-bot-auto-attack-exclude-section");
    const redTextSection = document.getElementById("k9x-red-text-alert-section");

    if (excludeSection && excludeSection.parentElement === mount) {
      excludeSection.insertAdjacentElement("afterend", section);
      return;
    }

    if (redTextSection && redTextSection.parentElement === mount) {
      redTextSection.insertAdjacentElement("afterend", section);
      return;
    }

    mount.insertBefore(section, mount.firstElementChild || null);
  }

  function ensureUi() {
    const panel = document.getElementById("minibia-bot-panel") || document.getElementById("k9x-panel");
    if (!panel) return;

    const existing = document.getElementById("minibia-bot-waypoint-profiles-section");
    if (existing) {
      moveSectionToTop(existing, panel);
      return;
    }

    const section = document.createElement("div");
    section.className = "mb-section mb-column-section";
    section.id = "minibia-bot-waypoint-profiles-section";
    section.innerHTML = `
      <div class="mb-label">GitHub Waypoints</div>
      <div class="mb-stack">
        <button type="button" class="mb-small-button" id="minibia-bot-waypoint-profiles-refresh">Refresh GitHub List</button>
        <select id="minibia-bot-waypoint-profiles-select"></select>
        <button type="button" class="mb-small-button" id="minibia-bot-waypoint-profiles-load">Load Selected Route</button>
        <button type="button" class="mb-small-button" id="minibia-bot-waypoint-profiles-export">Copy Current Route JSON</button>
        <div class="mb-small-note" id="minibia-bot-waypoint-profiles-status">GitHub routes: not loaded</div>
      </div>`;

    moveSectionToTop(section, panel);

    section.querySelector("#minibia-bot-waypoint-profiles-refresh")?.addEventListener("click", () => refreshManifest());
    section.querySelector("#minibia-bot-waypoint-profiles-load")?.addEventListener("click", async () => {
      const select = document.getElementById("minibia-bot-waypoint-profiles-select");
      const value = select?.value || "";
      try {
        await loadProfile(value);
      } catch (error) {
        state.lastError = error?.message || String(error);
        refreshUiValues();
      }
    });
    section.querySelector("#minibia-bot-waypoint-profiles-export")?.addEventListener("click", async () => {
      const json = JSON.stringify(exportCurrentRoute(), null, 2);
      try {
        await navigator.clipboard.writeText(json);
        state.lastError = null;
        setStatusText("Current route JSON copied. Paste it into a new file in waypoint-profiles/ on GitHub.");
      } catch (error) {
        state.lastError = "Clipboard copy failed. Open console and run minibiaBot.waypointProfiles.exportCurrentRoute().";
        refreshUiValues();
      }
    });

    renderProfiles();
    refreshUiValues();
  }

  function renderProfiles() {
    const select = document.getElementById("minibia-bot-waypoint-profiles-select");
    if (!select) return;

    const previous = select.value;
    select.innerHTML = "";

    if (!state.profiles.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No GitHub waypoint profiles";
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    state.profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.file;
      option.textContent = profile.name;
      select.appendChild(option);
    });

    select.disabled = false;
    if (previous && Array.from(select.options).some((option) => option.value === previous)) select.value = previous;
  }

  function setStatusText(text) {
    const label = document.getElementById("minibia-bot-waypoint-profiles-status");
    if (label) label.textContent = text;
  }

  function refreshUiValues() {
    if (state.lastError) {
      setStatusText(`GitHub routes error: ${state.lastError}`);
      return;
    }

    setStatusText(state.profiles.length
      ? `GitHub routes: ${state.profiles.length} loaded`
      : "GitHub routes: none saved yet");
  }

  function status() {
    return {
      repository,
      manifestPath,
      profiles: [...state.profiles],
      lastLoadedAt: state.lastLoadedAt,
      lastError: state.lastError,
    };
  }

  function destroy() {
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    state.uiTimerId = null;
    document.getElementById("minibia-bot-waypoint-profiles-section")?.remove();
  }

  bot.waypointProfiles = {
    refreshManifest,
    loadProfile,
    exportCurrentRoute,
    status,
    destroy,
  };

  state.uiTimerId = window.setInterval(() => { ensureUi(); refreshUiValues(); }, 1000);
  bot.addCleanup(destroy);
  ensureUi();
  refreshManifest();

  return bot.waypointProfiles;
};
