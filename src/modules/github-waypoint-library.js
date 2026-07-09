window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installGithubWaypointLibraryModule = function installGithubWaypointLibraryModule(bot) {
  const repoOwner = "seledoz";
  const repoName = "Min-new";
  const branch = "main";
  const libraryPath = "waypoints/library.json";
  const tokenStorageKey = "minibiaBot.github.token";
  const statusStorageKey = "minibiaBot.githubWaypointLibrary.lastStatus";
  const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${libraryPath}`;
  const rawUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/${libraryPath}`;

  function getToken() {
    return String(bot.storage.get(tokenStorageKey, "") || "").trim();
  }

  function setToken(token) {
    const nextToken = String(token || "").trim();
    if (nextToken) {
      bot.storage.set(tokenStorageKey, nextToken);
    } else {
      bot.storage.remove(tokenStorageKey);
    }
    return nextToken;
  }

  function setStatus(message) {
    const text = String(message || "").trim();
    bot.storage.set(statusStorageKey, text);
    const label = document.getElementById("minibia-bot-github-waypoints-status");
    if (label) label.textContent = text || "GitHub: idle";
  }

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function normalizeRoute(value) {
    return Array.isArray(value) ? value.map(normalizePosition).filter(Boolean) : [];
  }

  function normalizeTransition(value) {
    if (!value) return null;
    const from = normalizePosition(value.from || value);
    const to = normalizePosition(value.to || {
      x: value.targetX,
      y: value.targetY,
      z: value.targetZ,
    });
    if (!from || !to || from.z === to.z) return null;
    return {
      from,
      to,
      count: Math.max(1, Math.trunc(Number(value.count) || 1)),
      lastSeenAt: Math.max(0, Math.trunc(Number(value.lastSeenAt) || Date.now())),
    };
  }

  function normalizeTransitions(value) {
    return Array.isArray(value) ? value.map(normalizeTransition).filter(Boolean) : [];
  }

  function normalizeScript(value) {
    const name = String(value?.name || "").trim().replace(/\s+/g, " ");
    if (!name) return null;
    return {
      name,
      updatedAt: value.updatedAt || null,
      route: normalizeRoute(value.route),
      transitions: normalizeTransitions(value.transitions),
    };
  }

  function normalizeLibrary(value) {
    const scripts = Array.isArray(value?.scripts) ? value.scripts : [];
    const deduped = new Map();
    scripts.map(normalizeScript).filter(Boolean).forEach((script) => {
      deduped.set(script.name.toLowerCase(), script);
    });
    return {
      version: 1,
      updatedAt: value?.updatedAt || null,
      scripts: Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  function encodeBase64Utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function getHeaders(token = getToken()) {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function fetchLibrary() {
    const response = await fetch(`${rawUrl}?t=${Date.now()}`, { cache: "no-store" });
    if (response.status === 404) return normalizeLibrary({ scripts: [] });
    if (!response.ok) throw new Error(`GitHub load failed: HTTP ${response.status}`);
    return normalizeLibrary(await response.json());
  }

  async function fetchLibraryFileForWrite() {
    const token = getToken();
    if (!token) throw new Error("GitHub token missing");

    const response = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
      headers: getHeaders(token),
      cache: "no-store",
    });

    if (response.status === 404) {
      return { sha: null, library: normalizeLibrary({ scripts: [] }) };
    }

    if (!response.ok) throw new Error(`GitHub read failed: HTTP ${response.status}`);
    const file = await response.json();
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content || ""), (char) => char.charCodeAt(0))));
    return { sha: file.sha || null, library: normalizeLibrary(decoded) };
  }

  async function writeLibrary(library, sha) {
    const token = getToken();
    if (!token) throw new Error("GitHub token missing");

    const content = JSON.stringify(normalizeLibrary(library), null, 2) + "\n";
    const body = {
      message: "Update waypoint library",
      content: encodeBase64Utf8(content),
      branch,
    };
    if (sha) body.sha = sha;

    const response = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        ...getHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let details = "";
      try {
        const data = await response.json();
        details = data?.message ? ` - ${data.message}` : "";
      } catch (error) {}
      throw new Error(`GitHub save failed: HTTP ${response.status}${details}`);
    }

    return response.json();
  }

  async function listScripts() {
    const library = await fetchLibrary();
    return library.scripts;
  }

  async function saveCurrentScript(name) {
    const scriptName = String(name || bot.cave?.getActivePresetName?.() || "").trim().replace(/\s+/g, " ");
    if (!scriptName) throw new Error("Script name missing");

    const route = normalizeRoute(bot.cave?.getRoute?.() || []);
    const transitions = normalizeTransitions(bot.cave?.getTransitions?.() || []);
    if (!route.length) throw new Error("No waypoints to save");

    const { sha, library } = await fetchLibraryFileForWrite();
    const nextScript = {
      name: scriptName,
      updatedAt: new Date().toISOString(),
      route,
      transitions,
    };
    const existingIndex = library.scripts.findIndex((script) => script.name.toLowerCase() === scriptName.toLowerCase());
    if (existingIndex >= 0) {
      library.scripts[existingIndex] = nextScript;
    } else {
      library.scripts.push(nextScript);
    }
    library.updatedAt = nextScript.updatedAt;

    await writeLibrary(library, sha);
    bot.cave?.savePreset?.(scriptName);
    bot.log("GitHub waypoint script saved", {
      name: scriptName,
      waypoints: route.length,
      transitions: transitions.length,
      path: libraryPath,
    });
    return nextScript;
  }

  async function loadScript(name) {
    const scriptName = String(name || "").trim();
    if (!scriptName) throw new Error("Choose a script to load");

    const library = await fetchLibrary();
    const script = library.scripts.find((entry) => entry.name.toLowerCase() === scriptName.toLowerCase());
    if (!script) throw new Error(`Script not found: ${scriptName}`);

    const route = normalizeRoute(script.route);
    if (!route.length) throw new Error(`Script has no waypoints: ${scriptName}`);

    bot.cave?.stop?.();
    bot.cave?.clearWaypoints?.();
    bot.cave?.clearTransitions?.();
    route.forEach((waypoint) => bot.cave?.addWaypoint?.(waypoint));
    bot.cave?.savePreset?.(script.name);
    bot.cave?.loadPreset?.(script.name);

    bot.log("GitHub waypoint script loaded", {
      name: script.name,
      waypoints: route.length,
      transitionsSavedInFile: normalizeTransitions(script.transitions).length,
    });

    return script;
  }

  async function refreshUi() {
    const select = document.getElementById("minibia-bot-github-waypoints-select");
    const nameInput = document.getElementById("minibia-bot-github-waypoints-name");
    if (!select) return;

    setStatus("GitHub: loading scripts...");
    const scripts = await listScripts();
    const activeName = bot.cave?.getActivePresetName?.() || "";
    select.innerHTML = "";

    if (!scripts.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No GitHub scripts";
      select.appendChild(option);
      select.disabled = true;
    } else {
      scripts.forEach((script) => {
        const option = document.createElement("option");
        option.value = script.name;
        option.textContent = `${script.name} (${script.route.length})`;
        select.appendChild(option);
      });
      select.disabled = false;
      const match = scripts.find((script) => script.name.toLowerCase() === activeName.toLowerCase());
      select.value = match?.name || scripts[0].name;
    }

    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = activeName || select.value || "";
    }
    setStatus(`GitHub: ${scripts.length} script${scripts.length === 1 ? "" : "s"} found`);
  }

  function injectUi() {
    const panel = document.getElementById("minibia-bot-panel");
    if (!panel || document.getElementById("minibia-bot-github-waypoints-section")) return false;

    const column = panel.querySelector(".mb-cave-column") || panel.querySelector(".mb-main-column") || panel;
    const section = document.createElement("div");
    section.className = "mb-section mb-column-section";
    section.id = "minibia-bot-github-waypoints-section";
    section.innerHTML = `
      <div class="mb-label">GitHub Waypoints</div>
      <div class="mb-stack">
        <input type="password" id="minibia-bot-github-waypoints-token" placeholder="GitHub token for saving" />
        <input type="text" id="minibia-bot-github-waypoints-name" placeholder="Script name" />
        <select id="minibia-bot-github-waypoints-select"></select>
        <div class="mb-actions mb-actions-inline-two">
          <button type="button" class="mb-small-button" id="minibia-bot-github-waypoints-save">Save Current</button>
          <button type="button" class="mb-small-button" id="minibia-bot-github-waypoints-load">Load Selected</button>
        </div>
        <button type="button" class="mb-small-button" id="minibia-bot-github-waypoints-refresh">Refresh List</button>
        <div class="mb-small-note" id="minibia-bot-github-waypoints-status">GitHub: idle</div>
        <div class="mb-small-note">Saves to ${libraryPath}. Token is stored only in this browser.</div>
      </div>
    `;
    column.appendChild(section);

    const tokenInput = section.querySelector("#minibia-bot-github-waypoints-token");
    const nameInput = section.querySelector("#minibia-bot-github-waypoints-name");
    const select = section.querySelector("#minibia-bot-github-waypoints-select");
    const saveButton = section.querySelector("#minibia-bot-github-waypoints-save");
    const loadButton = section.querySelector("#minibia-bot-github-waypoints-load");
    const refreshButton = section.querySelector("#minibia-bot-github-waypoints-refresh");

    if (tokenInput) {
      tokenInput.value = getToken();
      tokenInput.addEventListener("change", () => {
        setToken(tokenInput.value);
        setStatus(getToken() ? "GitHub: token saved locally" : "GitHub: token cleared");
      });
    }

    if (select && nameInput) {
      select.addEventListener("change", () => {
        if (select.value) nameInput.value = select.value;
      });
    }

    if (saveButton) {
      saveButton.addEventListener("click", async () => {
        try {
          saveButton.disabled = true;
          setToken(tokenInput?.value || getToken());
          setStatus("GitHub: saving current script...");
          const saved = await saveCurrentScript(nameInput?.value || select?.value || "");
          if (nameInput) nameInput.value = saved.name;
          await refreshUi();
          setStatus(`GitHub: saved ${saved.name} (${saved.route.length})`);
        } catch (error) {
          setStatus(`GitHub: ${error?.message || error}`);
          bot.log("GitHub waypoint save failed", error?.message || error);
        } finally {
          saveButton.disabled = false;
        }
      });
    }

    if (loadButton) {
      loadButton.addEventListener("click", async () => {
        try {
          loadButton.disabled = true;
          setStatus("GitHub: loading selected script...");
          const loaded = await loadScript(select?.value || nameInput?.value || "");
          if (nameInput) nameInput.value = loaded.name;
          setStatus(`GitHub: loaded ${loaded.name} (${loaded.route.length})`);
        } catch (error) {
          setStatus(`GitHub: ${error?.message || error}`);
          bot.log("GitHub waypoint load failed", error?.message || error);
        } finally {
          loadButton.disabled = false;
        }
      });
    }

    if (refreshButton) {
      refreshButton.addEventListener("click", () => {
        refreshUi().catch((error) => {
          setStatus(`GitHub: ${error?.message || error}`);
        });
      });
    }

    refreshUi().catch((error) => {
      setStatus(`GitHub: ${error?.message || error}`);
    });

    return true;
  }

  function waitForPanelAndInject() {
    if (injectUi()) return;
    let attempts = 0;
    const timerId = window.setInterval(() => {
      attempts += 1;
      if (injectUi() || attempts >= 20) window.clearInterval(timerId);
    }, 250);
    bot.addCleanup?.(() => window.clearInterval(timerId));
  }

  bot.githubWaypointLibrary = {
    getToken,
    setToken,
    listScripts,
    saveCurrentScript,
    loadScript,
    refreshUi,
    path: libraryPath,
  };

  waitForPanelAndInject();
};
