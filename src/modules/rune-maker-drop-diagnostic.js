(() => {
  const TEST_BUTTON_ID = "minibia-bot-rune-maker-drop-test";
  const STATUS_ID = "minibia-bot-rune-maker-drop-test-status";
  const SECTION_ID = "minibia-bot-rune-maker-drop-section";
  const BLANK_RUNE_ID = 2260;

  function getItemId(item) {
    const values = [
      item?.getId?.(), item?.getID?.(), item?.id, item?.itemId, item?.itemID,
      item?.type?.id, item?.data?.id, item?.itemType?.id, item?.__id,
      item?.getType?.()?.id, item?.getItemType?.()?.id,
    ];
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return Math.trunc(number);
    }
    return null;
  }

  function getItemName(item) {
    const values = [
      item?.getName?.(), item?.name, item?.type?.name, item?.data?.name,
      item?.itemType?.name, item?.__name, item?.__type?.name,
      item?.getType?.()?.name, item?.getItemType?.()?.name,
    ];
    return String(values.find((value) => value != null && String(value).trim()) || "").trim();
  }

  function getItemCount(item) {
    const values = [item?.getCount?.(), item?.count, item?.amount, item?.quantity, item?.stackCount, item?.__count];
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return Math.min(255, Math.trunc(number));
    }
    return 1;
  }

  function isRune(item) {
    const id = getItemId(item);
    const name = getItemName(item);
    if (id === BLANK_RUNE_ID || /\bblank rune\b/i.test(name)) return false;
    return /\brune\b/i.test(name) || (id != null && id >= 2261 && id <= 2400);
  }

  function getSlotItem(container, index) {
    try {
      return container?.peekItem?.(index) || container?.getSlotItem?.(index) ||
        container?.slots?.[index]?.item || container?.slots?.[index]?.thing || container?.slots?.[index] || null;
    } catch (_) {
      return null;
    }
  }

  function getSlotCount(container) {
    const values = [container?.slots?.length, container?.size, container?.capacity, container?.slotCount, container?.getSize?.()];
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return Math.trunc(number);
    }
    return 40;
  }

  function getContainers() {
    const player = window.gameClient?.player;
    const found = [];
    const seen = new Set();
    const add = (container, index = null) => {
      if (!container || seen.has(container)) return;
      seen.add(container);
      found.push({ container, index });
    };

    if (typeof player?.getContainer === "function") {
      for (let index = 0; index < 256; index += 1) {
        try { add(player.getContainer(index), index); } catch (_) {}
      }
    }

    const opened = player?.__openedContainers || player?.openedContainers;
    if (opened) {
      const values = Array.isArray(opened) ? opened :
        typeof opened.values === "function" ? Array.from(opened.values()) : Object.values(opened);
      values.forEach((container, index) => add(container, index));
    }
    return found;
  }

  function scanItems() {
    const items = [];
    for (const record of getContainers()) {
      for (let slot = 0; slot < getSlotCount(record.container); slot += 1) {
        const item = getSlotItem(record.container, slot);
        if (!item) continue;
        items.push({ ...record, slot, item });
      }
    }
    return items;
  }

  function findRune() {
    return scanItems().find((entry) => isRune(entry.item)) || null;
  }

  function describeVisibleItems() {
    const items = scanItems();
    if (!items.length) return "no items visible in scanned containers";
    return items.slice(0, 10).map((entry) => {
      const id = getItemId(entry.item) ?? "?";
      const name = getItemName(entry.item) || "unnamed";
      const count = getItemCount(entry.item);
      const containerId = entry.container?.__containerId ?? entry.index ?? "?";
      return `${name} [id ${id}, count ${count}, c${containerId}/s${entry.slot}]`;
    }).join(" | ");
  }

  function setStatus(text) {
    const label = document.getElementById(STATUS_ID);
    if (label) label.textContent = text;
    console.log(`[minibia-bot] rune drop diagnostic: ${text}`);
  }

  function runTest() {
    const bot = window.minibiaBot;
    const runeDrop = bot?.runeMakerDrop;
    const dropPosition = runeDrop?.status?.()?.config?.dropPosition || runeDrop?.config?.dropPosition;
    if (!runeDrop) return setStatus("FAIL: rune-drop module unavailable");
    if (!dropPosition) return setStatus("FAIL: drop position not set");

    const rune = findRune();
    if (!rune) return setStatus(`FAIL: no rune matched. Visible: ${describeVisibleItems()}`);

    const containerId = Number(rune.container?.__containerId);
    if (!Number.isFinite(containerId)) {
      return setStatus(`FAIL: rune found (id ${getItemId(rune.item) ?? "?"}) but container ID is missing`);
    }

    let tile = null;
    try {
      tile = window.gameClient?.world?.getTileFromWorldPosition?.(
        new Position(dropPosition.x, dropPosition.y, dropPosition.z)
      );
    } catch (error) {
      return setStatus(`FAIL: could not resolve drop tile (${error?.message || error})`);
    }
    if (!tile) return setStatus("FAIL: drop tile not loaded");
    if (typeof ItemMovePacket !== "function") return setStatus("FAIL: ItemMovePacket unavailable");
    if (typeof window.gameClient?.send !== "function") return setStatus("FAIL: gameClient.send unavailable");

    const itemId = getItemId(rune.item);
    const itemName = getItemName(rune.item) || "rune";
    const count = getItemCount(rune.item);
    const before = getSlotItem(rune.container, rune.slot);

    try {
      const from = { which: rune.container, index: rune.slot };
      const to = { which: tile, index: 0xFF };
      window.gameClient.send(new ItemMovePacket(from, to, count));
      setStatus(`SENT: ${itemName} id ${itemId ?? "?"}, container ${containerId}, slot ${rune.slot}, count ${count}`);
    } catch (error) {
      return setStatus(`FAIL: packet threw ${error?.message || error}`);
    }

    window.setTimeout(() => {
      const after = getSlotItem(rune.container, rune.slot);
      if (!after || after !== before || getItemCount(after) < count) {
        setStatus(`SUCCESS: rune moved from slot ${rune.slot}`);
      } else {
        setStatus(`NO CHANGE: packet sent for rune id ${itemId ?? "?"}; server/client rejected the move`);
      }
    }, 1800);
  }

  function installButton() {
    const section = document.getElementById(SECTION_ID);
    if (!section || document.getElementById(TEST_BUTTON_ID)) return false;
    const stack = section.querySelector(".mb-stack") || section;
    const button = document.createElement("button");
    button.type = "button";
    button.id = TEST_BUTTON_ID;
    button.textContent = "Test Drop One Rune";
    button.addEventListener("click", runTest);
    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.className = "mb-small-note";
    status.textContent = "Diagnostic: ready";
    stack.appendChild(button);
    stack.appendChild(status);
    return true;
  }

  installButton();
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (installButton() || attempts >= 80) window.clearInterval(timer);
  }, 250);
})();