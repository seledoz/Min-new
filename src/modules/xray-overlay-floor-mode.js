(() => {
  const storageKey = "minibiaBot.xray.overlayFloorMode";
  const controlId = "minibia-bot-xray-floor-mode-control";
  const selectId = "minibia-bot-xray-floor-mode-select";
  const legacySelectId = "minibia-bot-xray-floor-select";
  const overlayId = "minibia-bot-xray-overlay";
  const statusId = "minibia-bot-xray-overlay-status";
  const validModes = new Set(["all", "current-plus-minus-one"]);

  function readMode() {
    try {
      const value = window.localStorage.getItem(storageKey);
      return validModes.has(value) ? value : "all";
    } catch (error) {
      return "all";
    }
  }

  let mode = readMode();
  let overlayObserver = null;
  let observedOverlay = null;

  function saveMode(nextMode) {
    mode = validModes.has(nextMode) ? nextMode : "all";
    try {
      window.localStorage.setItem(storageKey, mode);
    } catch (error) {}
  }

  function markerFloorOffset(marker) {
    const text = String(marker?.textContent || "");
    const match = text.match(/\(([+-]?\d+)\)/);
    if (!match) return 0;
    const offset = Number(match[1]);
    return Number.isFinite(offset) ? offset : 0;
  }

  function applyMarkerFilter() {
    const overlay = document.getElementById(overlayId);
    if (!overlay) return false;

    overlay.querySelectorAll(".mb-xray-marker").forEach((marker) => {
      const offset = markerFloorOffset(marker);
      marker.style.display = mode === "all" || Math.abs(offset) <= 1 ? "" : "none";
    });
    return true;
  }

  function watchOverlay() {
    const overlay = document.getElementById(overlayId);
    if (!overlay || overlay === observedOverlay) return;

    overlayObserver?.disconnect?.();
    observedOverlay = overlay;
    overlayObserver = new MutationObserver(applyMarkerFilter);
    overlayObserver.observe(overlay, { childList: true, subtree: true, characterData: true });
    applyMarkerFilter();
  }

  function updateStatusText() {
    const label = document.getElementById(statusId);
    if (!label) return;
    const enabled = !!window.minibiaBot?.xray?.status?.().config?.overlayEnabled;
    const modeLabel = mode === "all" ? "all floors" : "current floor ±1";
    label.textContent = `${enabled ? "Overlay: on" : "Overlay: off"} • ${modeLabel}`;
  }

  function installControl() {
    const status = document.getElementById(statusId);
    const xraySection = status?.closest?.(".mb-section");
    if (!status || !xraySection) return false;

    const legacySelect = document.getElementById(legacySelectId);
    const legacyField = legacySelect?.closest?.(".mb-field");
    if (legacyField) legacyField.style.display = "none";

    let control = document.getElementById(controlId);
    if (!control) {
      control = document.createElement("label");
      control.id = controlId;
      control.className = "mb-field";
      control.innerHTML = `
        <span class="mb-field-label">Overlay Floor Mode</span>
        <select id="${selectId}">
          <option value="all">All Floors</option>
          <option value="current-plus-minus-one">Current Floor ±1</option>
        </select>`;
      status.insertAdjacentElement("afterend", control);

      const select = control.querySelector(`#${selectId}`);
      select?.addEventListener("change", () => {
        saveMode(select.value);
        window.minibiaBot?.xray?.setSelectedFloor?.(null);
        applyMarkerFilter();
        updateStatusText();
      });
    }

    const select = document.getElementById(selectId);
    if (select && select.value !== mode) select.value = mode;
    window.minibiaBot?.xray?.setSelectedFloor?.(null);
    updateStatusText();
    return true;
  }

  const timerId = window.setInterval(() => {
    installControl();
    watchOverlay();
    applyMarkerFilter();
    updateStatusText();
  }, 250);

  window.addEventListener("beforeunload", () => {
    window.clearInterval(timerId);
    overlayObserver?.disconnect?.();
  }, { once: true });
})();