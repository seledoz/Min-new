window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installAutoAttackTargetLockGuard() {
  if (window.__minibiaAutoAttackTargetLockInstalled) return;
  window.__minibiaAutoAttackTargetLockInstalled = true;

  const lock = {
    target: null,
    targetId: null,
    setAt: 0,
    lastBlockedClearAt: 0,
  };

  function isSameCreature(left, right) {
    if (!left || !right) return false;
    return left === right || left.id === right.id;
  }

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function getTileDistance(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(Number(from.x) - Number(to.x)), Math.abs(Number(from.y) - Number(to.y)));
  }

  function getBot() {
    return window.minibiaBot || window.k9xBot || null;
  }

  function getTargetIdFromPacket(packet) {
    if (!packet) return null;
    if (Object.prototype.hasOwnProperty.call(packet, "__minibiaTargetId")) return packet.__minibiaTargetId;
    const keys = ["id", "targetId", "creatureId", "attackedCreatureId", "_id", "_targetId"];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(packet, key)) {
        const value = Number(packet[key]);
        if (Number.isFinite(value)) return value;
      }
    }
    return null;
  }

  function isTargetPacket(packet) {
    if (!packet) return false;
    if (typeof window.TargetPacket === "function" && packet instanceof window.TargetPacket) return true;
    const name = String(packet?.constructor?.name || "").toLowerCase();
    return name.includes("targetpacket") || name === "target";
  }

  function shouldKeepCurrentTarget() {
    const bot = getBot();
    const now = Date.now();
    if (!bot?.attack?.status) return false;

    const status = bot.attack.status();
    if (!status?.running || !status?.config?.enabled) return false;
    if (!lock.target || !lock.targetId) return false;
    if (now - lock.setAt > 8000) return false;

    const nearby = bot.attack.getNearbyMonsters?.() || [];
    const stillNearby = nearby.find((monster) => isSameCreature(monster, lock.target) || monster?.id === lock.targetId);
    if (!stillNearby) return false;

    const playerPosition = normalizePosition(bot.getPlayerPosition?.());
    const targetPosition = normalizePosition(stillNearby.getPosition?.() || stillNearby.__position || lock.target.__position);
    const maxDistance = Math.max(1, Number(status.config.maxTargetDistance) || 7);
    return getTileDistance(playerPosition, targetPosition) <= maxDistance;
  }

  function rememberTarget(target) {
    if (!target?.id) return;
    lock.target = target;
    lock.targetId = target.id;
    lock.setAt = Date.now();
  }

  function wrapTargetPacket() {
    const OriginalTargetPacket = window.TargetPacket;
    if (typeof OriginalTargetPacket !== "function" || OriginalTargetPacket.__minibiaTargetLockWrapped) return;

    function TargetPacketWithLock(...args) {
      const packet = Reflect.construct(OriginalTargetPacket, args, new.target || TargetPacketWithLock);
      packet.__minibiaTargetId = Number(args[0]) || 0;
      return packet;
    }

    try {
      Object.setPrototypeOf(TargetPacketWithLock, OriginalTargetPacket);
      TargetPacketWithLock.prototype = OriginalTargetPacket.prototype;
      TargetPacketWithLock.__minibiaTargetLockWrapped = true;
      window.TargetPacket = TargetPacketWithLock;
    } catch (error) {}
  }

  function wrapPlayerSetTarget(player) {
    if (!player || player.__minibiaTargetLockSetTargetWrapped || typeof player.setTarget !== "function") return;

    const originalSetTarget = player.setTarget.bind(player);
    player.setTarget = function setTargetWithLock(target) {
      if (target) {
        rememberTarget(target);
        return originalSetTarget(target);
      }

      if (shouldKeepCurrentTarget()) {
        lock.lastBlockedClearAt = Date.now();
        getBot()?.logDebug?.("blocked rapid target clear", { targetId: lock.targetId, source: "setTarget" });
        return false;
      }

      lock.target = null;
      lock.targetId = null;
      lock.setAt = 0;
      return originalSetTarget(target);
    };

    player.__minibiaTargetLockSetTargetWrapped = true;
  }

  function wrapSend(client) {
    if (!client || client.__minibiaTargetLockSendWrapped || typeof client.send !== "function") return;

    const originalSend = client.send.bind(client);
    client.send = function sendWithTargetLock(packet, ...rest) {
      if (isTargetPacket(packet)) {
        const targetId = getTargetIdFromPacket(packet);
        if (targetId && targetId > 0) {
          const target = window.gameClient?.player?.__target || lock.target;
          if (target?.id === targetId) rememberTarget(target);
        } else if (targetId === 0 && shouldKeepCurrentTarget()) {
          lock.lastBlockedClearAt = Date.now();
          getBot()?.logDebug?.("blocked rapid target clear", { targetId: lock.targetId, source: "TargetPacket(0)" });
          return false;
        }
      }

      return originalSend(packet, ...rest);
    };

    client.__minibiaTargetLockSendWrapped = true;
  }

  function patch() {
    wrapTargetPacket();
    const client = window.gameClient;
    if (!client) return;
    wrapSend(client);
    wrapPlayerSetTarget(client.player);
  }

  patch();
  const timerId = window.setInterval(patch, 500);
  window.__minibiaAutoAttackTargetLockTimerId = timerId;
})();
