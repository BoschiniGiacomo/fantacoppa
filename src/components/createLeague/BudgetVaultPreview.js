import React, { useMemo } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

const MAX_BUDGET = 1000;
const MAX_BILLS = 22;
const FELT_W = 280;
const FELT_H = 132;
const MIN_GAP = 38;

const BILL_COLORS = [
  { body: '#dcfce7', edge: '#16a34a', band: '#4ade80' },
  { body: '#bbf7d0', edge: '#15803d', band: '#22c55e' },
  { body: '#fef3c7', edge: '#ca8a04', band: '#fbbf24' },
  { body: '#ffedd5', edge: '#c2410c', band: '#fb923c' },
  { body: '#dbeafe', edge: '#1d4ed8', band: '#60a5fa' },
  { body: '#ede9fe', edge: '#6d28d9', band: '#a78bfa' },
];

function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function billCount(amount) {
  if (amount < 20) return 0;
  const t = amount / MAX_BUDGET;
  const base = Math.round(2 + t * (MAX_BILLS - 2));
  const jitter = Math.floor(hash(amount * 11) * 3) - 1;
  return Math.min(MAX_BILLS, Math.max(1, base + jitter));
}

/**
 * Posizioni sparse su tutto il feltro (griglia fine + jitter), niente torri.
 */
function buildBills(amount) {
  const count = billCount(amount);
  if (count <= 0) return [];

  const seed = amount * 2654435761;
  const cols = Math.ceil(Math.sqrt(count * (FELT_W / FELT_H)));
  const rows = Math.ceil(count / cols);
  const cellW = FELT_W / cols;
  const cellH = FELT_H / rows;

  // Ordine celle mescolato ma una cella → una banconota (copertura omogenea)
  const cells = Array.from({ length: cols * rows }, (_, i) => i);
  cells.sort((a, b) => hash(seed + a * 17) - hash(seed + b * 19));

  const bills = [];
  for (let i = 0; i < count; i += 1) {
    const cell = cells[i % cells.length];
    const c = cell % cols;
    const r = Math.floor(cell / cols);
    const h1 = hash(seed + i * 97);
    const h2 = hash(seed + i * 193);
    const h3 = hash(seed + i * 389);
    const h4 = hash(seed + i * 557);

    const pad = 6;
    const bw = 44 + Math.floor(h1 * 12);
    const bh = 22 + Math.floor(h2 * 6);
    let left = c * cellW + pad + h3 * Math.max(4, cellW - bw - pad * 2);
    let top = r * cellH + pad + h4 * Math.max(4, cellH - bh - pad * 2);
    left = Math.max(4, Math.min(left, FELT_W - bw - 4));
    top = Math.max(4, Math.min(top, FELT_H - bh - 4));

    // Leggero allontanamento se troppo vicino al precedente
    if (bills.length > 0) {
      const prev = bills[bills.length - 1];
      const dx = left - prev.left;
      const dy = top - prev.top;
      if (dx * dx + dy * dy < MIN_GAP * MIN_GAP) {
        left = Math.min(FELT_W - bw - 4, left + MIN_GAP * 0.6);
        top = Math.min(FELT_H - bh - 4, top + (h2 > 0.5 ? MIN_GAP * 0.4 : -MIN_GAP * 0.3));
        top = Math.max(4, top);
      }
    }

    bills.push({
      left,
      top,
      w: bw,
      h: bh,
      rot: (h1 - 0.5) * 50,
      color: BILL_COLORS[Math.floor(h2 * BILL_COLORS.length)],
      z: Math.floor(h3 * 100),
    });
  }

  return bills;
}

function Bill({ bill, small }) {
  const s = small ? 0.5 : 1;
  const { color, w, h, rot, left, top, z } = bill;
  return (
    <View
      style={[
        styles.bill,
        {
          width: w * s,
          height: h * s,
          left: left * s,
          top: top * s,
          backgroundColor: color.body,
          borderColor: color.edge,
          transform: [{ rotate: `${rot}deg` }],
          zIndex: z,
        },
      ]}
    >
      <View style={[styles.stripeL, { backgroundColor: color.band, width: 5 * s }]} />
      <View style={[styles.stripeR, { backgroundColor: color.band, width: 5 * s }]} />
      <View style={[styles.band, { backgroundColor: color.band, left: 8 * s, right: 8 * s }]} />
      <View
        style={[
          styles.seal,
          {
            borderColor: color.edge,
            width: 11 * s,
            height: 11 * s,
            borderRadius: 6 * s,
            right: 8 * s,
            top: 4 * s,
          },
        ]}
      />
    </View>
  );
}

/**
 * Valigia top-down: banconote sparse (non in torri).
 */
export default function BudgetVaultPreview({
  budget = 0,
  compact = false,
  inputProps,
  error,
}) {
  const amount = Math.min(MAX_BUDGET, Math.max(0, parseInt(budget, 10) || 0));
  const bills = useMemo(() => buildBills(amount), [amount]);

  const renderBills = (list, small = false) => {
    if (list.length === 0) {
      return <View style={[styles.emptyHint, small && styles.emptyHintSm]} />;
    }
    return list.map((b, i) => <Bill key={`b-${i}`} bill={b} small={small} />);
  };

  if (compact) {
    return (
      <View style={styles.compactCase}>
        <View style={styles.compactInterior}>{renderBills(bills.slice(0, 10), true)}</View>
        <Text style={styles.compactTicker}>{amount}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, error && styles.wrapError]}>
      <View style={styles.caseTop}>
        <View style={styles.caseRim}>
          <View style={styles.caseCornerTL} />
          <View style={styles.caseCornerTR} />
          <View style={styles.caseCornerBL} />
          <View style={styles.caseCornerBR} />
          <View style={styles.caseInterior}>
            <View style={styles.felt}>{renderBills(bills)}</View>
          </View>
        </View>
      </View>

      <View style={styles.metalRail}>
        <Text style={styles.budgetLabel}>Budget</Text>
        <View style={styles.railBody}>
          <View style={styles.sliderSlot}>{inputProps?.slider}</View>
          <View style={[styles.tickerDial, error && styles.tickerDialError]}>
            {inputProps?.textInput ? (
              <TextInput
                ref={inputProps.textInput.ref}
                {...(({ ref: _r, style: _s, ...rest }) => rest)(inputProps.textInput)}
                style={[styles.tickerInput, inputProps.textInput.style]}
                placeholderTextColor="#a8a29e"
                selectionColor="#ca8a04"
              />
            ) : (
              <Text style={styles.tickerText}>{amount}</Text>
            )}
          </View>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 4,
    marginTop: 6,
  },
  wrapError: {
    opacity: 0.98,
  },
  caseTop: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: '#92400e',
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: '#78350f',
    padding: 10,
    paddingBottom: 8,
  },
  caseRim: {
    borderRadius: 12,
    backgroundColor: '#a16207',
    borderWidth: 2,
    borderColor: '#78350f',
    padding: 8,
    position: 'relative',
  },
  caseCornerTL: {
    position: 'absolute', top: 6, left: 6, width: 10, height: 10,
    borderRadius: 5, backgroundColor: '#57534e', borderWidth: 1, borderColor: '#292524', zIndex: 2,
  },
  caseCornerTR: {
    position: 'absolute', top: 6, right: 6, width: 10, height: 10,
    borderRadius: 5, backgroundColor: '#57534e', borderWidth: 1, borderColor: '#292524', zIndex: 2,
  },
  caseCornerBL: {
    position: 'absolute', bottom: 6, left: 6, width: 10, height: 10,
    borderRadius: 5, backgroundColor: '#57534e', borderWidth: 1, borderColor: '#292524', zIndex: 2,
  },
  caseCornerBR: {
    position: 'absolute', bottom: 6, right: 6, width: 10, height: 10,
    borderRadius: 5, backgroundColor: '#57534e', borderWidth: 1, borderColor: '#292524', zIndex: 2,
  },
  caseInterior: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#44403c',
  },
  felt: {
    height: FELT_H,
    backgroundColor: '#14532d',
    position: 'relative',
  },
  emptyHint: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -36,
    marginTop: -16,
    width: 72,
    height: 32,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#166534',
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  emptyHintSm: {
    marginLeft: -24,
    marginTop: -10,
    width: 48,
    height: 20,
  },
  bill: {
    position: 'absolute',
    borderRadius: 4,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  stripeL: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    opacity: 0.75,
  },
  stripeR: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    opacity: 0.75,
  },
  band: {
    position: 'absolute',
    top: '40%',
    height: 3,
    borderRadius: 1,
    opacity: 0.4,
  },
  seal: {
    position: 'absolute',
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  metalRail: {
    backgroundColor: '#57534e',
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    borderWidth: 1.5,
    borderTopWidth: 0,
    borderColor: '#44403c',
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
  },
  budgetLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#a8a29e',
    marginBottom: 4,
    marginLeft: 2,
  },
  railBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sliderSlot: {
    flex: 1,
    justifyContent: 'center',
  },
  tickerDial: {
    width: 56,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#0c0a09',
    borderWidth: 1.5,
    borderColor: '#a8a29e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickerDialError: {
    borderColor: '#f87171',
  },
  tickerInput: {
    width: 50,
    color: '#fef3c7',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    paddingVertical: 0,
  },
  tickerText: {
    color: '#fef3c7',
    fontSize: 16,
    fontWeight: '800',
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
  compactCase: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#92400e',
    backgroundColor: '#92400e',
  },
  compactInterior: {
    height: 72,
    margin: 6,
    borderRadius: 8,
    backgroundColor: '#14532d',
    position: 'relative',
    overflow: 'hidden',
  },
  compactTicker: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: '#fef3c7',
    paddingBottom: 8,
  },
});
