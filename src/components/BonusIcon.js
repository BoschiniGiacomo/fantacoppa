import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

// Mappa centralizzata di tutte le icone bonus/malus
// Usare sempre questo componente per coerenza in tutta l'app
const BONUS_ICONS = {
  goal: {
    icon: 'soccer',
    lib: 'mci',
    color: '#222',
    badge: { icon: 'checkmark-circle', lib: 'ion', color: '#198754' },
  },
  assist: {
    icon: 'shoe-cleat',
    lib: 'mci',
    color: '#0d6efd',
    badge: null,
  },
  yellow_card: {
    type: 'card',
    color: '#ffc107',
  },
  red_card: {
    type: 'card',
    color: '#dc3545',
  },
  goals_conceded: {
    icon: 'soccer',
    lib: 'mci',
    color: '#222',
    badge: { icon: 'close-circle', lib: 'ion', color: '#e53935' },
  },
  own_goal: {
    icon: 'soccer',
    lib: 'mci',
    color: '#e53935',
    badge: null,
  },
  penalty_missed: {
    icon: 'soccer-field',
    lib: 'mci',
    color: '#198754',
    badge: { icon: 'close-circle', lib: 'ion', color: '#e53935' },
  },
  penalty_saved: {
    icon: 'soccer-field',
    lib: 'mci',
    color: '#198754',
    badge: { icon: 'hand-front-right', lib: 'mci', color: '#222' },
  },
  clean_sheet: {
    icon: 'hand-front-right',
    lib: 'mci',
    color: '#222',
    badge: null,
  },
};

function renderIcon(name, lib, size, color) {
  if (lib === 'mci') {
    return <MaterialCommunityIcons name={name} size={size} color={color} />;
  }
  return <Ionicons name={name} size={size} color={color} />;
}

export default function BonusIcon({ type, size = 18, inactive = false }) {
  const config = BONUS_ICONS[type];
  if (!config) return null;

  const INACTIVE_COLOR = '#ccc';

  // Cartellini giallo/rosso: rettangolo colorato
  if (config.type === 'card') {
    return (
      <View
        style={[
          styles.cardIcon,
          {
            backgroundColor: inactive ? INACTIVE_COLOR : config.color,
            width: Math.round(size * 0.7),
            height: size,
            borderRadius: Math.round(size * 0.12),
          },
        ]}
      />
    );
  }

  const mainColor = inactive ? INACTIVE_COLOR : config.color;

  // Icona senza badge
  if (!config.badge) {
    return renderIcon(config.icon, config.lib, size, mainColor);
  }

  // Icona con badge overlay
  const badgeSize = Math.round(size * 0.55);
  const badgeColor = inactive ? INACTIVE_COLOR : config.badge.color;
  return (
    <View style={{ width: size + 4, height: size + 2 }}>
      {renderIcon(config.icon, config.lib, size, mainColor)}
      <View
        style={[
          styles.badge,
          {
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            bottom: -2,
            right: -3,
          },
        ]}
      >
        {renderIcon(config.badge.icon, config.badge.lib, badgeSize, badgeColor)}
      </View>
    </View>
  );
}

// Export della mappa per uso esterno (es. colori nei label)
export { BONUS_ICONS };

const styles = StyleSheet.create({
  cardIcon: {
    borderRadius: 2,
  },
  badge: {
    position: 'absolute',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
