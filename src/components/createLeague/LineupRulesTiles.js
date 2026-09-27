import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Due regole di vestizione: tile tappabili (non Switch nativo).
 */
export default function LineupRulesTiles({
  autoLineupMode,
  hideFormations,
  onToggleAuto,
  onToggleHide,
  deadlineSlot,
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <RuleTile
          active={!!autoLineupMode}
          icon={autoLineupMode ? 'color-wand' : 'color-wand-outline'}
          title="Auto formazione"
          subtitle="la formazione vinene impostata automaticamente"
          onPress={onToggleAuto}
        />
        <RuleTile
          active={!!hideFormations}
          icon={hideFormations ? 'eye-off' : 'eye-outline'}
          title="Nascondi rose"
          subtitle="Le rose degli altri restano privati"
          onPress={onToggleHide}
        />
      </View>
      {deadlineSlot ? <View style={styles.deadlineSlot}>{deadlineSlot}</View> : null}
    </View>
  );
}

function RuleTile({ active, icon, title, subtitle, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.tile, active && styles.tileOn]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.tileTop}>
        <View style={[styles.iconWrap, active && styles.iconWrapOn]}>
          <Ionicons name={icon} size={18} color={active ? '#166534' : '#64748b'} />
        </View>
        <View style={[styles.badge, active ? styles.badgeOn : styles.badgeOff]}>
          <Text style={[styles.badgeText, active ? styles.badgeTextOn : styles.badgeTextOff]}>
            {active ? 'ON' : 'OFF'}
          </Text>
        </View>
      </View>
      <Text style={[styles.title, active && styles.titleOn]}>{title}</Text>
      <Text style={styles.subtitle} numberOfLines={3}>
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  tile: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    padding: 12,
    minHeight: 132,
  },
  tileOn: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  tileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapOn: {
    backgroundColor: '#dcfce7',
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeOn: {
    backgroundColor: '#16a34a',
  },
  badgeOff: {
    backgroundColor: '#e2e8f0',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  badgeTextOn: {
    color: '#fff',
  },
  badgeTextOff: {
    color: '#64748b',
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 4,
  },
  titleOn: {
    color: '#14532d',
  },
  subtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748b',
    lineHeight: 15,
  },
  deadlineSlot: {
    marginTop: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
  },
});
