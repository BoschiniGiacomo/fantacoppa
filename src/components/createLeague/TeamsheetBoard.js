import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import RoleLimitsBars from './RoleLimitsBars';
import { ROLE_COLORS } from './startersLayout';

const ROLES = [
  { key: 'P', field: 'maxPortieri', next: 'maxDifensori' },
  { key: 'D', field: 'maxDifensori', next: 'maxCentrocampisti' },
  { key: 'C', field: 'maxCentrocampisti', next: 'maxAttaccanti' },
  { key: 'A', field: 'maxAttaccanti', next: 'numeroTitolari' },
];

/**
 * Foglio distinta: carta + fascia verde. Solo lettere ruolo, niente titoli.
 */
export default function TeamsheetBoard({
  formData,
  setFormData,
  inputRefs,
  onFocus,
  onSubmitToTitolari,
}) {
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead} />
      <View style={styles.sheetBody}>
        {ROLES.map((role, idx) => (
          <View key={role.key} style={[styles.row, idx === ROLES.length - 1 && styles.rowLast]}>
            <View style={[styles.roleBadge, { backgroundColor: ROLE_COLORS[role.key] }]}>
              <Text style={styles.roleBadgeText}>{role.key}</Text>
            </View>
            <View style={styles.lineGrow} />
            <TextInput
              ref={inputRefs.step2[role.field]}
              style={styles.qty}
              keyboardType="numeric"
              value={formData[role.field]}
              onChangeText={(text) => setFormData({ ...formData, [role.field]: text })}
              returnKeyType="next"
              onSubmitEditing={() => {
                if (role.next === 'numeroTitolari') {
                  onSubmitToTitolari?.();
                } else {
                  inputRefs.step2[role.next]?.current?.focus();
                }
              }}
              onFocus={() => onFocus(`step2.${role.field}`, inputRefs.step2[role.field])}
              selectionColor="#166534"
            />
          </View>
        ))}
        <RoleLimitsBars
          maxPortieri={formData.maxPortieri}
          maxDifensori={formData.maxDifensori}
          maxCentrocampisti={formData.maxCentrocampisti}
          maxAttaccanti={formData.maxAttaccanti}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fffef7',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e7e5e4',
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#78716c',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sheetHead: {
    height: 10,
    backgroundColor: '#166534',
  },
  sheetBody: {
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e7e5e4',
    gap: 10,
  },
  rowLast: {
    borderBottomWidth: 0,
    marginBottom: 4,
  },
  roleBadge: {
    width: 30,
    height: 30,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },
  lineGrow: {
    flex: 1,
    height: 1,
    backgroundColor: '#e7e5e4',
  },
  qty: {
    width: 52,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d6d3d1',
    borderRadius: 4,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: '#14532d',
    paddingVertical: 6,
  },
});
