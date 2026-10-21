// Pure room transaction: remove a stale device without changing past gourd damage.
export function removeParticipant(room, { uid, hostUid, now }) {
  if (!room || room.hostUid !== hostUid || !uid || uid === hostUid
    || !["waiting", "locked", "playing", "finished"].includes(room.status)
    || !room.participants?.[uid]) return undefined;

  const participants = { ...room.participants };
  const playerStates = { ...room.playerStates };
  delete participants[uid];
  delete playerStates[uid];
  const next = {
    ...room, participants, playerStates,
    // Host-only tombstone prevents presence, queued writes and saved sessions
    // from recreating a removed participant. A new room starts with no blocks.
    removedParticipants: { ...room.removedParticipants, [uid]: { at: now } },
  };
  if (room.teams) next.teams = Object.fromEntries(Object.entries(room.teams).map(([team, state]) => {
    const squad = Array.isArray(state.squad) ? state.squad : Object.values(state.squad || {});
    return [team, { ...state, squad: squad.filter((unit) => unit?.ownerUid !== uid) }];
  }));
  if (room.battleEvents) next.battleEvents = Object.fromEntries(Object.entries(room.battleEvents)
    .filter(([, event]) => event?.attackerUid !== uid));
  return next;
}

export function participantAccess(room, uid) {
  if (!room) return "closed";
  if (room.removedParticipants?.[uid]) return "removed";
  return room.participants?.[uid] ? "member" : "missing";
}

// Recheck the current transaction snapshot, not the room that scheduled a repair.
export function repairParticipants(room, updates, hostUid) {
  if (!room || room.hostUid !== hostUid || room.status !== "playing") return undefined;
  const next = { ...room, participants: { ...room.participants }, playerStates: { ...room.playerStates } };
  let changed = false;
  for (const [path, value] of Object.entries(updates)) {
    const [branch, uid] = path.split("/");
    if (!room.participants?.[uid] || room.removedParticipants?.[uid]) continue;
    if (branch === "playerStates" && !room.playerStates?.[uid]?.currentQuestion) {
      next.playerStates[uid] = value;
      changed = true;
    } else if (branch === "participants" && room.participants[uid].needsSync) {
      next.participants[uid] = { ...room.participants[uid], needsSync: false };
      changed = true;
    }
  }
  return changed ? next : undefined;
}
