window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installAutoAttackFollowClearGuard() {
  if (window.__minibiaAutoAttackFollowClearGuardInstalled) return;
  window.__minibiaAutoAttackFollowClearGuardInstalled = true;

  function getBot() {
    return window.minibiaBot || window.k9xBot || null;
  }

  function getCurrentTarget() {
    return window.gameClient?.player?.__target || null;
  }

  function getCurrentFollowTarget() {
    return window.gameClient?.player?.__followTarget || null;
  }

  function isFollowPacket(packet) {
    if (!packet) return false;
    if (typeof window.FollowPacket === "function" && packet instanceof window.FollowPacket) return true;
    const name = String(packet?.constructor?.name || "").toLowerCase();
    return name.includes("followpacket") || name === "follow";
  }

  function getFollowIdFromPacket(packet) {
    if (!packet) return null;
    if (Object.prototype.hasOwnProperty.call(packet, "__minibiaFollowId")) return packet.__minibiaFollowId;
    const keys = ["id", "targetId", "creatureId", "followId", "_id", "_targetId"];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(packet, key)) {
        const value = Number(packet[key]);
        if (Number.isFinite(value)) return value;
      }
    }
    return null;
  }

  function shouldBlockFollowClear() {
    const bot = getBot();
    const status = bot?.attack?.status?.();
    if (!status?.running || !status?.config?.enabled || !status.config.meleeMode) return false;

    const currentTarget = getCurrentTarget();
    const currentFollowTarget = getCurrentFollowTarget();
    if (!currentTarget || !currentFollowTarget) return false;

    return currentTarget.id === currentFollowTarget.id;
  }

  function wrapFollowPacket() {
    const OriginalFollowPacket = window.FollowPacket;
    if (typeof OriginalFollowPacket !== "function" || OriginalFollowPacket.__minibiaFollowClearGuardWrapped) return;

    function FollowPacketWithGuard(...args) {
      const packet = Reflect.construct(OriginalFollowPacket, args, new.target || FollowPacketWithGuard);
      packet.__minibiaFollowId = Number(args[0]) || 0;
      return packet;
    }

    try {
      Object.setPrototypeOf(FollowPacketWithGuard, OriginalFollowPacket);
      FollowPacketWithGuard.prototype = OriginalFollowPacket.prototype;
      FollowPacketWithGuard.__minibiaFollowClearGuardWrapped = true;
      window.FollowPacket = FollowPacketWithGuard;
    } catch (error) {}
  }

  function wrapSend(client) {
    if (!client || client.__minibiaFollowClearGuardSendWrapped || typeof client.send !== "function") return;

    const originalSend = client.send.bind(client);
    client.send = function sendWithFollowClearGuard(packet, ...rest) {
      if (isFollowPacket(packet) && getFollowIdFromPacket(packet) === 0 && shouldBlockFollowClear()) {
        getBot()?.logDebug?.("blocked follow clear while attacking same target");
        return false;
      }

      return originalSend(packet, ...rest);
    };

    client.__minibiaFollowClearGuardSendWrapped = true;
  }

  function patch() {
    wrapFollowPacket();
    wrapSend(window.gameClient);
  }

  patch();
  const timerId = window.setInterval(patch, 500);
  window.__minibiaAutoAttackFollowClearGuardTimerId = timerId;
})();
