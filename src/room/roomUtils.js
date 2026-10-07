const ROOM_STORAGE_PREFIX = "math-team-battle-active-room:";
export const ROOM_STATUSES = ["waiting", "locked", "starting", "playing", "finished"];
export const DURATION_OPTIONS = [3, 5, 7, 10, 15];
export const EVENT_HISTORY = 30;

export function roomStorageKey(uid) {
  return `${ROOM_STORAGE_PREFIX}${uid}`;
}

export function makeRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function publicBaseUrl() {
  const configured = String(import.meta.env.VITE_PUBLIC_APP_URL || "").trim();
  return configured || window.location.href;
}

export function buildJoinUrl(roomCode) {
  const url = new URL(publicBaseUrl(), window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("join", roomCode);
  return url.toString();
}

export function getParticipants(room) {
  if (!room?.participants) return [];
  return Object.entries(room.participants)
    .map(([id, participant]) => ({ id, ...participant }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

export function groupByTeam(participants, teams) {
  return Object.fromEntries(teams.map((team) => [team, participants.filter((participant) => participant.team === team)]));
}

// Per-player contribution ranking inside a team. Equal damage shares a rank (1, 1, 3).
export function rankMembers(participants = [], states = {}) {
  const sorted = participants
    .map((person) => ({ ...person, damage: Number(states[person.id]?.damage || 0), correct: Number(states[person.id]?.correctCount || 0) }))
    .sort((a, b) => b.damage - a.damage || b.correct - a.correct || String(a.name || "").localeCompare(String(b.name || ""), "ko"));
  let rank = 0;
  return sorted.map((person, index) => {
    if (index === 0 || person.damage !== sorted[index - 1].damage) rank = index + 1;
    return { ...person, rank, tied: sorted.filter((other) => other.damage === person.damage).length > 1 };
  });
}
