import React, { useMemo } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { buildStartersSlots, ROLE_COLORS } from './startersLayout';

/**
 * Campetto: solo maglie e campo. Il numero compare piccolo in angolo.
 */
export default function StartersPitchPreview({
  starters = 11,
  compact = false,
  inputProps,
}) {
  const count = Math.min(11, Math.max(4, parseInt(starters, 10) || 11));
  const slots = useMemo(() => buildStartersSlots(count), [count]);
  const rows = [0, 1, 2, 3].map((rowIndex) => slots.filter((s) => s.row === rowIndex));

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {!compact ? (
        <View style={styles.boardFrame}>
          <View style={styles.pitch}>
            <View style={styles.halfway} />
            <View style={styles.circle} />
            <View style={styles.boxTop} />
            <View style={styles.boxBottom} />
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{count}</Text>
            </View>
            {rows.map((rowSlots, rowIndex) => (
              <View
                key={`row-${rowIndex}`}
                style={[
                  styles.line,
                  rowIndex === 0 && styles.lineAttack,
                  rowIndex === 3 && styles.lineGk,
                ]}
              >
                {rowSlots.map((slot, i) => (
                  <View
                    key={`${slot.role}-${slot.indexInRow}`}
                    style={[styles.jersey, { backgroundColor: ROLE_COLORS[slot.role] }]}
                  >
                    <Text style={styles.jerseyNum}>
                      {i + 1 + rows.slice(0, rowIndex).reduce((a, r) => a + r.length, 0)}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
          {inputProps ? (
            <View style={styles.controls}>
              <View style={styles.sliderSlot}>{inputProps.slider}</View>
              <TextInput
                ref={inputProps.textInput?.ref}
                {...(inputProps.textInput
                  ? (({ ref: _r, style: _s, ...rest }) => rest)(inputProps.textInput)
                  : {})}
                style={[styles.titolariInput, inputProps.textInput?.style]}
                placeholderTextColor="#94a3b8"
                selectionColor="#166534"
              />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.compactWrap}>
          <View style={[styles.pitch, styles.pitchCompact]}>
            <View style={styles.halfway} />
            <View style={styles.countBadgeCompact}>
              <Text style={styles.countBadgeTextCompact}>{count}</Text>
            </View>
            {rows.map((rowSlots, rowIndex) => (
              <View key={`cr-${rowIndex}`} style={styles.line}>
                {rowSlots.map((slot) => (
                  <View
                    key={`c-${slot.role}-${slot.indexInRow}`}
                    style={[styles.dotCompact, { backgroundColor: ROLE_COLORS[slot.role] }]}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 16,
  },
  wrapCompact: {
    marginBottom: 0,
    flex: 1,
  },
  boardFrame: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    shadowColor: '#166534',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pitch: {
    height: 188,
    backgroundColor: '#22a55a',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  pitchCompact: {
    height: 100,
    borderRadius: 12,
    paddingVertical: 8,
  },
  countBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    zIndex: 3,
  },
  countBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },
  countBadgeCompact: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(15,23,42,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  countBadgeTextCompact: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  halfway: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  circle: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    top: '50%',
    left: '50%',
    marginTop: -26,
    marginLeft: -26,
  },
  boxTop: {
    position: 'absolute',
    top: 0,
    left: '28%',
    right: '28%',
    height: 30,
    borderBottomWidth: 1.5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  boxBottom: {
    position: 'absolute',
    bottom: 0,
    left: '28%',
    right: '28%',
    height: 30,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    zIndex: 2,
  },
  lineAttack: { paddingTop: 2 },
  lineGk: { paddingBottom: 2 },
  jersey: {
    width: 26,
    height: 30,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  jerseyNum: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 12,
    backgroundColor: '#f8fafc',
  },
  sliderSlot: { flex: 1 },
  titolariInput: {
    width: 56,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    color: '#166534',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    paddingVertical: 10,
  },
  compactWrap: {
    flex: 1,
  },
  dotCompact: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
  },
});
