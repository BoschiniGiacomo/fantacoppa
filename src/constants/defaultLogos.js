// Loghi di default (stemmi) disponibili per le squadre
// Questa costante è condivisa tra tutte le schermate dell'app

export const defaultLogos = [
  { id: 'default_1', emoji: '⚽', color: '#4CAF50' },
  { id: 'default_2', emoji: '⚔️', color: '#F44336' },
  { id: 'default_3', emoji: '🛡️', color: '#2196F3' },
  { id: 'default_4', emoji: '🏴‍☠️', color: '#CCAAEE' },
  { id: 'default_5', emoji: '🐺', color: '#9C27B0' },
  { id: 'default_6', emoji: '🐍', color: '#1976D2' },
  { id: 'default_7', emoji: '🦁', color: '#FF9800' },
  { id: 'default_8', emoji: '🦉', color: '#E91E63' },
  { id: 'default_9', emoji: '🔰', color: '#FFD700' },
  { id: 'default_10', emoji: '💣', color: '#8D6E63' },
  { id: 'default_11', emoji: '💎', color: '#8B4513' },
  { id: 'default_12', emoji: '🛸', color: '#607D8B' },
];

// Mappa loghi di default per accesso rapido tramite ID
export const defaultLogosMap = defaultLogos.reduce((map, logo) => {
  map[logo.id] = { emoji: logo.emoji, color: logo.color };
  return map;
}, {});

