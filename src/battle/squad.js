import { activeUnits } from "../game/rules.js";

// Snapshots own the roster; events only animate it. IDs preserve animation state
// without duplicating a summon already received in the same database snapshot.
export function syncArenaSquad(previous, squad, now) {
  const known = new Map(previous.map((unit) => [unit.id, unit]));
  return activeUnits(squad, now).map((unit) => ({ ...known.get(unit.id), ...unit }));
}

export function eventSquad(event) {
  const source = event.actingUnits || [event.unit];
  return activeUnits(source, Number(event.at)).filter((unit) => unit.ownerUid === event.attackerUid);
}

export function ownerGroups(units) {
  const groups = new Map();
  for (const unit of units) {
    if (!groups.has(unit.ownerUid)) groups.set(unit.ownerUid, []);
    groups.get(unit.ownerUid).push(unit);
  }
  return [...groups.values()];
}
