(() => {
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
        const item = container?.getSlotItem?.(slotIndex) ||
          container?.slots?.[slotIndex]?.item ||
          container?.slots?.[slotIndex]?.thing ||
          container?.slots?.[slotIndex] ||
          null;
        if (item) items.push(summarizeItem(item, containerIndex, slotIndex));
      }
      return {
        containerIndex,
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

  const attach = () => {
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

  console.log("[minibia-bot] container inspector ready: inspectMinibiaContainers()");
})();