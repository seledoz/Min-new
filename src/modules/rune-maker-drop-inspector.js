(() => {
  function getSlotItem(container, index) {
    try {
      return container?.peekItem?.(index) ||
        container?.getSlotItem?.(index) ||
        container?.slots?.[index]?.item ||
        container?.slots?.[index]?.thing ||
        container?.slots?.[index] ||
        null;
    } catch (error) {
      return null;
    }
  }

  function sameItem(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    const leftId = Number(left?.id ?? left?.itemId ?? left?.itemID ?? left?.type?.id ?? left?.data?.id ?? left?.getId?.());
    const rightId = Number(right?.id ?? right?.itemId ?? right?.itemID ?? right?.type?.id ?? right?.data?.id ?? right?.getId?.());
    return Number.isFinite(leftId) && Number.isFinite(rightId) && leftId === rightId;
  }

  function resolveRealContainer(container, slotIndex) {
    if (!container) return null;
    if (Number.isFinite(Number(container.__containerId))) return container;

    const player = window.gameClient?.player;
    if (!player || typeof player.getContainer !== "function") return container;
    const sourceItem = getSlotItem(container, slotIndex);

    for (let index = 0; index < 256; index += 1) {
      let candidate = null;
      try { candidate = player.getContainer(index); } catch (error) {}
      if (!candidate) continue;
      if (candidate === container) return candidate;
      if (sameItem(sourceItem, getSlotItem(candidate, slotIndex))) return candidate;
    }

    return container;
  }

  function getFreshTile(tile) {
    try {
      const position = tile?.getPosition?.();
      if (!position) return tile;
      return window.gameClient?.world?.getTileFromWorldPosition?.(
        new Position(position.x, position.y, position.z)
      ) || tile;
    } catch (error) {
      return tile;
    }
  }

  function sendDirectRuneMove(fromObject, toObject, count) {
    const game = window.gameClient;
    if (!game || typeof game.send !== "function") {
      console.warn("[minibia-bot] rune drop: game client send unavailable");
      return false;
    }
    if (typeof ItemMovePacket !== "function") {
      console.warn("[minibia-bot] rune drop: ItemMovePacket unavailable");
      return false;
    }
    if (!fromObject?.which || !toObject?.which) {
      console.warn("[minibia-bot] rune drop: missing source or destination");
      return false;
    }

    const resolvedContainer = resolveRealContainer(fromObject.which, fromObject.index);
    const destinationTile = getFreshTile(toObject.which);
    const slot = Math.max(0, Math.trunc(Number(fromObject.index) || 0));
    const amount = Math.max(1, Math.min(255, Math.trunc(Number(count) || 1)));
    const containerId = Number(resolvedContainer?.__containerId);

    if (!Number.isFinite(containerId)) {
      console.warn("[minibia-bot] rune drop: invalid container id", {
        slot,
        constructor: resolvedContainer?.constructor?.name || null,
        keys: Object.keys(resolvedContainer || {}).slice(0, 30),
      });
      return false;
    }
    if (!destinationTile || destinationTile?.constructor?.name !== "Tile") {
      console.warn("[minibia-bot] rune drop: invalid destination tile", {
        constructor: destinationTile?.constructor?.name || null,
        position: destinationTile?.getPosition?.() || null,
      });
      return false;
    }

    const source = { which: resolvedContainer, index: slot };
    const destination = { which: destinationTile, index: 0xFF };

    try {
      const packet = new ItemMovePacket(source, destination, amount);
      game.send(packet);
      console.log("[minibia-bot] rune drop packet sent", {
        containerId,
        slot,
        destination: destinationTile.getPosition?.() || null,
        count: amount,
      });
      return true;
    } catch (error) {
      console.error("[minibia-bot] rune drop packet failed", error);
      return false;
    }
  }

  function installRuneDropMoveAdapter() {
    const mouse = window.gameClient?.mouse;
    if (!mouse) return false;

    mouse.__handleItemMove = function runeDropItemMove(fromObject, toObject, count) {
      return sendDirectRuneMove(fromObject, toObject, count);
    };
    mouse.handleItemMove = mouse.__handleItemMove;
    mouse.__minNewRuneDropMoveFixed = true;
    return true;
  }

  function getOpenContainers() {
    const player = window.gameClient?.player;
    const candidates = [
      player?.__openedContainers,
      player?.openedContainers,
      window.gameClient?.interface?.containerManager?.containers,
      window.gameClient?.interface?.containers,
    ];

    for (const opened of candidates) {
      if (!opened) continue;
      if (Array.isArray(opened)) return opened.filter(Boolean);
      if (typeof opened.values === "function") return Array.from(opened.values()).filter(Boolean);
      if (typeof opened[Symbol.iterator] === "function") return Array.from(opened).filter(Boolean);
      if (typeof opened === "object") {
        const values = Object.values(opened).filter(Boolean);
        if (values.length) return values;
      }
    }
    return [];
  }

  function getSlotCount(container) {
    if (Array.isArray(container?.slots)) return container.slots.length;
    const candidates = [container?.size, container?.capacity, container?.slotCount, container?.getSize?.()];
    for (const value of candidates) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return Math.trunc(number);
    }
    return 40;
  }

  function safeCall(fn) {
    try { return typeof fn === "function" ? fn() : null; } catch (error) { return null; }
  }

  function summarizeItem(item, containerIndex, slotIndex) {
    const own = {};
    try {
      Object.keys(item || {}).slice(0, 60).forEach((key) => {
        const value = item[key];
        if (typeof value !== "function") own[key] = value;
      });
    } catch (error) {}

    return {
      containerIndex,
      slotIndex,
      constructor: item?.constructor?.name || null,
      candidates: {
        getName: safeCall(() => item?.getName?.()),
        getId: safeCall(() => item?.getId?.()),
        getID: safeCall(() => item?.getID?.()),
        getCount: safeCall(() => item?.getCount?.()),
        name: item?.name ?? item?.__name ?? null,
        id: item?.id ?? item?.__id ?? null,
        itemId: item?.itemId ?? null,
        itemID: item?.itemID ?? null,
        count: item?.count ?? item?.__count ?? null,
        amount: item?.amount ?? null,
        quantity: item?.quantity ?? null,
        stackCount: item?.stackCount ?? null,
        typeId: item?.type?.id ?? item?.itemType?.id ?? item?.data?.id ?? item?.__type?.id ?? null,
        typeName: item?.type?.name ?? item?.itemType?.name ?? item?.data?.name ?? item?.__type?.name ?? null,
      },
      own,
    };
  }

  function inspectMinibiaContainers() {
    const containers = getOpenContainers();
    const result = containers.map((container, containerIndex) => {
      const items = [];
      const slotCount = getSlotCount(container);
      for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
        const item = getSlotItem(container, slotIndex);
        if (item) items.push(summarizeItem(item, containerIndex, slotIndex));
      }
      return {
        containerIndex,
        containerId: container?.__containerId ?? null,
        constructor: container?.constructor?.name || null,
        slotCount,
        ownKeys: Object.keys(container || {}).slice(0, 60),
        items,
      };
    });

    console.log("[minibia-bot] OPEN CONTAINERS", containers.length, result);
    if (!containers.length) {
      console.warn("[minibia-bot] No open containers were found. Keep the rune backpack visibly open and run the command again.");
    }
    return result;
  }

  window.inspectMinibiaContainers = inspectMinibiaContainers;
  window.testMinibiaRuneDropMove = sendDirectRuneMove;

  const attach = () => {
    installRuneDropMoveAdapter();
    if (!window.minibiaBot?.runeMakerDrop) return false;
    window.minibiaBot.runeMakerDrop.inspectOpenContainers = inspectMinibiaContainers;
    return true;
  };

  attach();
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (attach() || attempts >= 40) window.clearInterval(timer);
  }, 250);

  console.log("[minibia-bot] direct rune drop packet adapter ready");
})();