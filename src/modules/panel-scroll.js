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
      position: fixed;
      z-index: 2147483647;
      display: none;
      pointer-events: none;
    }

    #minibia-bot-panel-scroll-controls button {
      position: absolute;
      top: 50%;
      width: 38px;
      height: 52px;
      padding: 0;
      transform: translateY(-50%);
      border: 1px solid rgba(255, 255, 255, 0.55);
      border-radius: 7px;
      background: rgba(20, 20, 20, 0.9);
      color: #fff;
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
      pointer-events: auto;
      touch-action: manipulation;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    }

    #minibia-bot-panel-scroll-left {
      left: 4px;
    }

    #minibia-bot-panel-scroll-right {
      right: 4px;
    }

    #minibia-bot-panel-scroll-controls button:disabled {
      opacity: 0.25;
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
    leftButton.id = "minibia-bot-panel-scroll-left";
    leftButton.type = "button";
    leftButton.textContent = "◀";
    leftButton.title = "Scroll panel left";
    leftButton.setAttribute("aria-label", "Scroll panel left");

    const rightButton = document.createElement("button");
    rightButton.id = "minibia-bot-panel-scroll-right";
    rightButton.type = "button";
    rightButton.textContent = "▶";
    rightButton.title = "Scroll panel right";
    rightButton.setAttribute("aria-label", "Scroll panel right");

    controls.append(leftButton, rightButton);
    document.body.appendChild(controls);

    const updateControls = () => {
      if (!document.body.contains(panel)) {
        controls.remove();
        return;
      }

      const rect = panel.getBoundingClientRect();
      const maxScrollLeft = Math.max(0, panel.scrollWidth - panel.clientWidth);
      const hasHorizontalOverflow = maxScrollLeft > 2;
      const visible = rect.width > 0 && rect.height > 0 && hasHorizontalOverflow;

      controls.style.display = visible ? "block" : "none";
      if (!visible) return;

      controls.style.left = `${Math.max(0, rect.left)}px`;
      controls.style.top = `${Math.max(0, rect.top)}px`;
      controls.style.width = `${Math.max(0, Math.min(rect.width, window.innerWidth - Math.max(0, rect.left)))}px`;
      controls.style.height = `${Math.max(0, Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)))}px`;

      leftButton.disabled = panel.scrollLeft <= 1;
      rightButton.disabled = panel.scrollLeft >= maxScrollLeft - 1;
    };

    const scrollPanel = (direction) => {
      const amount = Math.max(140, Math.round(panel.clientWidth * 0.8));
      panel.scrollBy({ left: direction * amount, behavior: "smooth" });
      window.setTimeout(updateControls, 350);
    };

    leftButton.addEventListener("click", () => scrollPanel(-1));
    rightButton.addEventListener("click", () => scrollPanel(1));
    panel.addEventListener("scroll", updateControls, { passive: true });
    window.addEventListener("resize", updateControls, { passive: true });
    window.addEventListener("scroll", updateControls, { passive: true, capture: true });

    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(updateControls)
      : null;
    resizeObserver?.observe(panel);

    const positionTimer = window.setInterval(() => {
      if (!document.body.contains(panel)) {
        window.clearInterval(positionTimer);
        resizeObserver?.disconnect();
        controls.remove();
        return;
      }
      updateControls();
    }, 250);

    updateControls();
    return true;
  }

  if (!installControls()) {
    const observer = new MutationObserver(() => {
      if (installControls()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
