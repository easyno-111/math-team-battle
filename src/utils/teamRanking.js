// Competition ranking: equal contribution gets the same rank (1, 1, 3).
export function rankTeam(participants = [], states = {}) {
  const sorted = participants.map(person => ({ ...person, contribution: Number(states[person.id]?.attackPower || 0) }))
    .sort((a, b) => b.contribution - a.contribution || String(a.name || '').localeCompare(String(b.name || ''), 'ko') || a.id.localeCompare(b.id));
  let rank = 0;
  return sorted.map((person, index) => {
    if (index === 0 || person.contribution !== sorted[index - 1].contribution) rank = index + 1;
    return { ...person, rank, tied: sorted.filter(other => other.contribution === person.contribution).length > 1 };
  });
}
