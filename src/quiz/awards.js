export const AWARD_MOTION_MS = 3800;
export function roundAwardGroups(room) {
  if (room?.phase !== 'reveal' || !room.roundId) return [];
  const rows = Object.entries(room.players || {}).flatMap(([uid, player]) => {
    const result = room.results?.[uid];
    return result?.correct === true && result.submitted === true && result.roundId === room.roundId
      && typeof result.elapsedMs === 'number' && Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0
      ? [{ uid, name: String(player.name || '이름 없음'), elapsedMs: result.elapsedMs, points: Number(result.points) || 0 }] : [];
  }).sort((a,b) => a.elapsedMs - b.elapsedMs || a.name.localeCompare(b.name,'ko') || a.uid.localeCompare(b.uid));
  const groups=[];
  for (const [index,row] of rows.entries()) {
    const previous=groups.at(-1);
    if(previous?.elapsedMs===row.elapsedMs)previous.students.push(row);
    else if(index<3)groups.push({rank:index+1,elapsedMs:row.elapsedMs,students:[row]});
    else break;
  }
  return groups;
}
export function finalAwardGroups(rows) {
  const groups=[];
  for(const row of rows.filter(row=>row.rank<=3 && row.total>0 && row.correct>0)) {
    const existing=groups.find(group=>group.rank===row.rank);
    const student={uid:row.id,name:String(row.name),points:row.total};
    if(existing)existing.students.push(student);
    else groups.push({rank:row.rank,students:[student]});
  }
  return groups;
}
export function awardElapsed(room, now) {
  const start=room?.phase==='finished'?room.finishedAt:room?.revealedAt;
  if(!Number.isFinite(start)||!Number.isFinite(now)||now<=0||now<start)return AWARD_MOTION_MS;
  return Math.min(AWARD_MOTION_MS,now-start);
}
