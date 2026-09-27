import React, { useMemo } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { buildStartersSlots } from './startersLayout';

/** Quote verticali delle linee (attacco → portiere), dal bordo alto. */
const ROW_TOP = ['11%', '34%', '57%', '80%'];

/**
 * Lavagna tattica: pallini sul campo.
 * Ruoli e moduli si decidono dopo, in lega.
 */
export default function StartersPitchPreview({
  starters = 11,
  compact = false,
  inputProps,
}) {
  const count = Math.min(11, Math.max(4, parseInt(starters, 10) || 11));
  const slots = useMemo(() => buildStartersSlots(count), [count]);
  const rows = [0, 1, 2, 3].map((rowIndex) => slots.filter((s) => s.row === rowIndex));
  const rowTops = compact ? ['12%', '36%', '58%', '80%'] : ROW_TOP;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {!compact ? (
        <View style={styles.boardFrame}>
          <View style={styles.pitch}>
            {/* Solo laterali: niente riga full-width in alto */}
            <View style={styles.boxTop} pointerEvents="none" />
            <View style={styles.boxBottom} pointerEvents="none" />
            <View style={styles.sidelineLeft} pointerEvents="none" />
            <View style={styles.sidelineRight} pointerEvents="none" />
            {/* Metà campo: linea e cerchio sullo stesso asse (top 50%) */}
            <View style={styles.halfway} pointerEvents="none" />
            <View style={styles.circle} pointerEvents="none" />

            {rows.map((rowSlots, rowIndex) =>
              rowSlots.length === 0 ? null : (
                <View
                  key={`row-${rowIndex}`}
                  style={[styles.line, { top: rowTops[rowIndex] }]}
                >
                  {rowSlots.map((slot) => (
                    <View key={`${slot.row}-${slot.indexInRow}`} style={styles.magnet} />
                  ))}
                </View>
              )
            )}
          </View>

          {inputProps ? (
            <View style={styles.controls}>
              <View style={styles.controlsMainRow}>
                <View style={styles.sliderCol}>
                  <View style={styles.sliderLabels}>
                    <Text style={styles.sliderLabel}>4</Text>
                    <Text style={styles.sliderLabel}>11</Text>
                  </View>
                  <View style={styles.sliderSlot}>{inputProps.slider}</View>
                </View>
                <View style={styles.titolariField}>
                  <Text style={styles.titolariLabel}>Titolari</Text>
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
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.compactWrap}>
          <View style={[styles.pitch, styles.pitchCompact]}>
            <View style={styles.halfway} pointerEvents="none" />
            {rows.map((rowSlots, rowIndex) =>
              rowSlots.length === 0 ? null : (
                <View
                  key={`cr-${rowIndex}`}
                  style={[styles.line, styles.lineCompact, { top: rowTops[rowIndex] }]}
                >
                  {rowSlots.map((slot) => (
                    <View
                      key={`c-${slot.row}-${slot.indexInRow}`}
                      style={styles.magnetCompact}
                    />
                  ))}
                </View>
              )
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const LINE = 'rgba(255,255,255,0.38)';

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
    height: 200,
    backgroundColor: '#1a6b3c',
    overflow: 'hidden',
    position: 'relative',
  },
  pitchCompact: {
    height: 100,
    borderRadius: 12,
  },
  sidelineLeft: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    left: 8,
    width: 1.5,
    backgroundColor: LINE,
  },
  sidelineRight: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    right: 8,
    width: 1.5,
    backgroundColor: LINE,
  },
  halfway: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: '50%',
    height: 2,
    backgroundColor: LINE,
    transform: [{ translateY: -1 }],
    zIndex: 1,
  },
  circle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: LINE,
    transform: [{ translateX: -28 }, { translateY: -28 }],
    zIndex: 1,
  },
  boxTop: {
    position: 'absolute',
    top: 0,
    left: '26%',
    right: '26%',
    height: 36,
    borderBottomWidth: 1.5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: LINE,
  },
  boxBottom: {
    position: 'absolute',
    bottom: 0,
    left: '26%',
    right: '26%',
    height: 36,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: LINE,
  },
  line: {
    position: 'absolute',
    left: 16,
    right: 16,
    marginTop: -12,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    zIndex: 2,
  },
  lineCompact: {
    marginTop: -6,
    left: 10,
    right: 10,
  },
  magnet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#dc2626',
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.35,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  magnetCompact: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#dc2626',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  controls: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#f8fafc',
  },
  controlsMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  sliderCol: {
    flex: 1,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sliderLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  sliderSlot: {
    height: 42,
    justifyContent: 'center',
  },
  titolariField: {
    alignItems: 'center',
    gap: 4,
  },
  titolariLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  titolariInput: {
    width: 56,
    height: 42,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    color: '#166534',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    paddingVertical: 0,
  },
  compactWrap: {
    flex: 1,
  },
});
