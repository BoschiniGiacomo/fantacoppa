/**
 * Dati visivi per uno slot formazione in classifica/live.
 * Con sostituzione: nome, foto, squadra e voto reale del panchinaro entrato (API allinea rating).
 */
export function getFormationSlotVisual(player) {
  if (!player) {
    return {
      first_name: '',
      last_name: '',
      photo_path: '',
      team_name: '',
      role: '',
      wasSubstituted: false,
    };
  }
  return {
    first_name: player.first_name || '',
    last_name: player.last_name || '',
    photo_path: player.photo_path || '',
    team_name: player.team_name || '',
    role: player.role || '',
    wasSubstituted: !!player.substitute_id,
    titolare_last_name: player.titolare_last_name || null,
    same_surname_in_league: player.same_surname_in_league === true,
  };
}
