window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installAutoAttackBlockFollowWhileTargeted() {
  if (window.__minibiaBlockFollowWhileTargetedInstalled) return;
  window.__minibiaBlockFollowWhileTargetedInstalled = true;

  function getBot() {
    return window.minibiaBot || window.k9xBot || null;
  }

  function getCurrentTarget() {
    return window.gameClient?.player?.__target || null;
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

  function shouldBlockFollowPacket(packet) {
    const bot = getBot();
    const status = bot?.attack?.status?.();
    const currentTarget = getCurrentTarget();
    if (!status?.running || !status?.config?.enabled || !currentTarget) return false;

    const followId = getFollowIdFromPacket(packet);
    if (followId == null) return false;

    // Test fix: while auto attack has a real attack target, don't let follow/pathfinding send follow packets.
    // Follow can fight with attack target selection and cause the red square to flash on/off.
    return true;
  }

  function wrapFollowPacket() {
    const OriginalFollowPacket = window.FollowPacket;
    if (typeof OriginalFollowPacket !== "function" || OriginalFollowPacket.__minibiaBlockFollowWrapped) return;

    function FollowPacketWithId(...args) {
      const packet = Reflect.construct(OriginalFollowPacket, args, new.target || FollowPacketWithId);
      packet.__minibiaFollowId = Number(args[0]) || 0;
      return packet;
    }

    try {
      Object.setPrototypeOf(FollowPacketWithId, OriginalFollowPacket);
      FollowPacketWithId.prototype = OriginalFollowPacket.prototype;
      FollowPacketWithId.__minibiaBlockFollowWrapped = true;
      window.FollowPacket = FollowPacketWithId;
    } catch (error) {}
  }

  function wrapSend(client) {
    if (!client || client.__minibiaBlockFollowSendWrapped || typeof client.send !== "function") return;

    const originalSend = client.send.bind(client);
    client.send = function sendWithFollowBlockedWhileTargeted(packet, ...rest) {
      if (isFollowPacket(packet) && shouldBlockFollowPacket(packet)) {
        getBot()?.logDebug?.("blocked follow packet while auto attack target is active", {
          currentTargetId: getCurrentTarget()?.id || null,
          followId: getFollowIdFromPacket(packet),
        });
        return false;
      }

      return originalSend(packet, ...rest);
    };

    client.__minibiaBlockFollowSendWrapped = true;
  }

  function patch() {
    wrapFollowPacket();
    wrapSend(window.gameClient);
  }

  patch();
  const timerId = window.setInterval(patch, 500);
  window.__minibiaBlockFollowWhileTargetedTimerId = timerId;
})();
