import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TeamLogoImage } from './StableCachedImage';

const ROLE_OPTIONS = ['P', 'D', 'C', 'A'];
const ROLE_COLORS = { P: '#0d6efd', D: '#198754', C: '#e6a817', A: '#dc3545' };

export default function RankingFiltersBar({
  accentColor = '#667eea',
  officialTeams = [],
  selectedRoles = [],
  selectedTeamIds = [],
  onToggleRole,
  onToggleTeam,
  onClearFilters,
}) {
  const hasFilters = selectedRoles.length > 0 || selectedTeamIds.length > 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowLabel}>Ruolo</Text>
        {hasFilters ? (
          <TouchableOpacity onPress={onClearFilters} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.clearText, { color: accentColor }]}>Reset</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.roleRow}>
        {ROLE_OPTIONS.map((role) => {
          const active = selectedRoles.includes(role);
          const color = ROLE_COLORS[role] || '#6c757d';
          return (
            <TouchableOpacity
              key={role}
              style={[
                styles.roleChip,
                active && { backgroundColor: `${color}22`, borderColor: color },
              ]}
              onPress={() => onToggleRole(role)}
              activeOpacity={0.75}
            >
              <Text style={[styles.roleChipText, active && { color, fontWeight: '800' }]}>
                {role}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {officialTeams.length > 0 ? (
        <>
          <Text style={[styles.rowLabel, styles.teamsLabel]}>Squadra</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.teamsScroll}
          >
            {officialTeams.map((team) => {
              const teamId = Number(team.id);
              const active = selectedTeamIds.includes(teamId);
              const jersey = team.jersey_color || '#667eea';
              return (
                <TouchableOpacity
                  key={teamId}
                  style={[
                    styles.teamChip,
                    active && { borderColor: accentColor, backgroundColor: `${accentColor}12` },
                  ]}
                  onPress={() => onToggleTeam(teamId)}
                  activeOpacity={0.8}
                  accessibilityLabel={team.name || `Squadra ${teamId}`}
                >
                  <View style={[styles.teamLogoRing, active && { borderColor: accentColor }]}>
                    <TeamLogoImage
                      logoPath={team.logo_path}
                      style={styles.teamLogo}
                      fallbackStyle={[styles.teamLogoFallback, { backgroundColor: jersey }]}
                      fallbackIcon="shield"
                      fallbackIconSize={18}
                      fallbackColor="#fff"
                    />
                  </View>
                  {active ? (
                    <View style={[styles.teamCheck, { backgroundColor: accentColor }]}>
                      <Ionicons name="checkmark" size={10} color="#fff" />
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
    marginBottom: 4,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  teamsLabel: {
    marginTop: 2,
  },
  clearText: {
    fontSize: 12,
    fontWeight: '700',
  },
  roleRow: {
    flexDirection: 'row',
    gap: 6,
  },
  roleChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    backgroundColor: '#fafafa',
    alignItems: 'center',
  },
  roleChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
  },
  teamsScroll: {
    gap: 8,
    paddingRight: 4,
  },
  teamChip: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ececec',
    backgroundColor: '#fafafa',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  teamLogoRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamLogo: {
    width: 36,
    height: 36,
  },
  teamLogoFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamCheck: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
});
