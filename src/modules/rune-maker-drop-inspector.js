(() => {
  function getOpenContainers() {
    const opened = window.gameClient?.player?.__openedContainers;
    if (!opened) return [];
    if (Array.isArray(opened)) return opened.filter(Boolean);
    if (typeof opened.values === "function") return Array.from(opened.values()).filter(Boolean);
    if (typeof opened[Symbol.iterator] === "function") return Array.from(opened).filter(Boolean);
    return Object.values(opened).filter(Boolean);
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

  function summarizeItem(item, containerIndex, slotIndex) {
    const own = {};
    try {
      Object.keys(item || {}).slice(0, 40).forEach((key) => {
        const value = item[key];
        if (typeof value !== "function") own[key] = value;
      });
    } catch (error) {}

    const candidates = {
      getName: (() => { try { return item?.getName?.(); } catch (error) { return null; } })(),
      name: item?.name ?? null,
      id: item?.id ?? null,
      itemId: item?.itemId ?? null,
      itemID: item?.itemID ?? null,
      count: item?.count ?? null,
      amount: item?.amount ?? null,
      quantity: item?.quantity ?? null,
      stackCount: item?.stackCount ?? null,
      typeId: item?.type?.id ?? item?.itemType?.id ?? item?.data?.id ?? null,
      typeName: item?.type?.name ?? item?.itemType?.name ?? item?.data?.name ?? null,
    };

    return {
      containerIndex,
      slotIndex,
      constructor: item?.constructor?.name || null,
      candidates,
      own,
    };
  }

  function inspectOpenContainers() {
    const containers = getOpenContainers();
    const result = containers.map((container, containerIndex) => {
      const items = [];
      const slotCount = getSlotCount(container);
      for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
        const item = container?.getSlotItem?.(slotIndex) || container?.slots?.[slotIndex]?.item || container?.slots?.[slotIndex] || null;
        if (!item) continue;
        items.push(summarizeItem(item, containerIndex, slotIndex));
      }
      return {
        containerIndex,
        constructor: container?.constructor?.name || null,
        slotCount,
        ownKeys: Object.keys(container || {}).slice(0, 40),
        items,
      };
    });

    console.log("[minibia-bot] rune maker open container inspection", result);
    return result;
  }

  function install() {
    const bot = window.minibiaBot;
    if (!bot?.runeMakerDrop) return false;
    bot.runeMakerDrop.inspectOpenContainers = inspectOpenContainers;
    return true;
  }

  if (!install()) {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 20) window.clearInterval(timer);
    }, 250);
  }
})();
