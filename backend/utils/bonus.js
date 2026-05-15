function computeBonusTotal(vote, bonusSettings) {
  if (Number(bonusSettings.enable_bonus_malus || 0) !== 1) return 0;
  let bonus = 0;
  if (Number(bonusSettings.enable_goal || 0) === 1) {
    bonus += Number(vote.goals || 0) * Number(bonusSettings.bonus_goal || 0);
  }
  if (Number(bonusSettings.enable_assist || 0) === 1) {
    bonus += Number(vote.assists || 0) * Number(bonusSettings.bonus_assist || 0);
  }
  if (Number(bonusSettings.enable_yellow_card || 0) === 1) {
    bonus += Number(vote.yellow_cards || 0) * Number(bonusSettings.malus_yellow_card || 0);
  }
  if (Number(bonusSettings.enable_red_card || 0) === 1) {
    bonus += Number(vote.red_cards || 0) * Number(bonusSettings.malus_red_card || 0);
  }
  if (Number(bonusSettings.enable_goals_conceded || 0) === 1) {
    bonus += Number(vote.goals_conceded || 0) * Number(bonusSettings.malus_goals_conceded || 0);
  }
  if (Number(bonusSettings.enable_own_goal || 0) === 1) {
    bonus += Number(vote.own_goals || 0) * Number(bonusSettings.malus_own_goal || 0);
  }
  if (Number(bonusSettings.enable_penalty_missed || 0) === 1) {
    bonus += Number(vote.penalty_missed || 0) * Number(bonusSettings.malus_penalty_missed || 0);
  }
  if (Number(bonusSettings.enable_penalty_saved || 0) === 1) {
    bonus += Number(vote.penalty_saved || 0) * Number(bonusSettings.bonus_penalty_saved || 0);
  }
  if (Number(bonusSettings.enable_clean_sheet || 0) === 1) {
    bonus += Number(vote.clean_sheet || 0) * Number(bonusSettings.bonus_clean_sheet || 0);
  }
  if (Number(bonusSettings.enable_pallone_fuori || 0) === 1) {
    bonus += Number(vote.pallone_fuori || 0) * Number(bonusSettings.malus_pallone_fuori || 0);
  }
  if (Number(bonusSettings.enable_briso || 0) === 1) {
    bonus += Number(vote.briso || 0) * Number(bonusSettings.bonus_briso || 0);
  }
  if (Number(bonusSettings.enable_no_divisa || 0) === 1) {
    bonus += Number(vote.no_divisa || 0) * Number(bonusSettings.malus_no_divisa || 0);
  }
  return bonus;
}

module.exports = { computeBonusTotal };
