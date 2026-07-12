window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(() => {
  const styleId = "minibia-bot-panel-scroll-style";
  const controlsId = "minibia-bot-panel-scroll-controls";

  document.getElementById(styleId)?.remove();
  document.getElementById(controlsId)?.remove();

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    #minibia-bot-panel {
      box-sizing: border-box;
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - 32px);
      overflow-x: scroll !important;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable both-edges;
      touch-action: pan-x pan-y;
    }

    #minibia-bot-panel-scroll-controls {
      position: sticky;
      left: 0;
      bottom: 0;
      z-index: 10000;
      box-sizing: border-box;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      min-width: 150px;
      padding: 6px 8px;
      background: rgba(20, 20, 20, 0.94);
      border-top: 1px solid rgba(255, 255, 255, 0.2);
    }

    #minibia-bot-panel-scroll-controls button {
      flex: 1 1 0;
      min-height: 34px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      touch-action: manipulation;
    }

    #minibia-bot-panel-scroll-controls button:disabled {
      opacity: 0.35;
      cursor: default;
    }
  `;

  (document.head || document.documentElement).appendChild(style);

  function installControls() {
    const panel = document.getElementById("minibia-bot-panel");
    if (!panel || document.getElementById(controlsId)) return false;

    const controls = document.createElement("div");
    controls.id = controlsId;

    const leftButton = document.createElement("button");
    leftButton.type = "button";
    leftButton.textContent = "◀";
    leftButton.title = "Scroll panel left";
    leftButton.setAttribute("aria-label", "Scroll panel left");

    const rightButton = document.createElement("button");
    rightButton.type = "button";
    rightButton.textContent = "▶";
    rightButton.title = "Scroll panel right";
    rightButton.setAttribute("aria-label", "Scroll panel right");

    const updateButtons = () => {
      const maxScrollLeft = Math.max(0, panel.scrollWidth - panel.clientWidth);
      leftButton.disabled = panel.scrollLeft <= 1;
      rightButton.disabled = panel.scrollLeft >= maxScrollLeft - 1;
    };

    const scrollPanel = (direction) => {
      const amount = Math.max(120, Math.round(panel.clientWidth * 0.75));
      panel.scrollBy({ left: direction * amount, behavior: "smooth" });
      window.setTimeout(updateButtons, 350);
    };

    leftButton.addEventListener("click", () => scrollPanel(-1));
    rightButton.addEventListener("click", () => scrollPanel(1));
    panel.addEventListener("scroll", updateButtons, { passive: true });
    window.addEventListener("resize", updateButtons, { passive: true });

    controls.append(leftButton, rightButton);
    panel.appendChild(controls);
    updateButtons();

    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(updateButtons)
      : null;
    resizeObserver?.observe(panel);

    return true;
  }

  if (!installControls()) {
    const observer = new MutationObserver(() => {
      if (installControls()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
