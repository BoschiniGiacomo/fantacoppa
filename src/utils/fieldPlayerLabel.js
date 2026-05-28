function normalizeSurname(value) {
  return String(value || '').trim().toLocaleLowerCase('it-IT');
}

export function buildFieldSurnameCountMap(rows, getPlayersFromRow) {
  const map = new Map();
  const rowsList = Array.isArray(rows) ? rows : [];
  for (const row of rowsList) {
    const players = getPlayersFromRow(row) || [];
    for (const p of players) {
      if (!p) continue;
      const key = normalizeSurname(p.last_name);
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return map;
}

export function getFieldPlayerLabel(player, surnameCountMap, truncateFn) {
  const lastName = String(player?.last_name || '').trim();
  if (!lastName) return '';
  const key = normalizeSurname(lastName);
  const sameSurnameInField = Number(surnameCountMap?.get(key) || 0) > 1;
  const sameSurnameInLeague = player?.same_surname_in_league === true;

  if (!sameSurnameInField && !sameSurnameInLeague) {
    return truncateFn(lastName, 10);
  }

  const firstInitial = String(player?.first_name || '').trim().charAt(0).toUpperCase();
  const composed = firstInitial ? `${firstInitial}. ${lastName}` : lastName;
  return truncateFn(composed, 12);
}
