import React, { useMemo } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

const MAX_BUDGET = 1000;
const MAX_STACKS = 12;

const STACK_COLORS = [
  { body: '#dcfce7', edge: '#16a34a', band: '#4ade80' },
  { body: '#bbf7d0', edge: '#15803d', band: '#22c55e' },
  { body: '#fef3c7', edge: '#ca8a04', band: '#fbbf24' },
  { body: '#ffedd5', edge: '#c2410c', band: '#fb923c' },
  { body: '#dbeafe', edge: '#1d4ed8', band: '#60a5fa' },
  { body: '#ede9fe', edge: '#6d28d9', band: '#a78bfa' },
];

/** Griglia 4×3 sul feltro — cella larga, mazzette staccate e omogenee. */
const COLS = 4;
const ROWS = 3;
const ORIGIN_X = 8;
const ORIGIN_Y = 10;
const STEP_X = 70;
const STEP_Y = 42;

const STACK_SLOTS = Array.from({ length: COLS * ROWS }, (_, i) => {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  return { x: ORIGIN_X + c * STEP_X, y: ORIGIN_Y + r * STEP_Y };
});

function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** Indici sparsi in modo uniforme sulla griglia (anche con 2–3 pezzi). */
function pickUniformIndices(count, total) {
  if (count <= 0) return [];
  if (count >= total) return Array.from({ length: total }, (_, i) => i);
  const picks = [];
  for (let i = 0; i < count; i += 1) {
    picks.push(Math.min(total - 1, Math.floor(((i + 0.5) * total) / count)));
  }
  // Evita duplicati se arrotondamenti coincidono
  const used = new Set();
  return picks.map((idx) => {
    let j = idx;
    while (used.has(j)) j = (j + 1) % total;
    used.add(j);
    return j;
  });
}

function stackPlan(amount) {
  const t = Math.min(1, Math.max(0, amount / MAX_BUDGET));
  const jitter = Math.floor(hash(amount * 17) * 2);
  const count = Math.min(MAX_STACKS, Math.max(0, Math.round(t * MAX_STACKS) + jitter));
  const baseH = Math.max(1, Math.round(1 + t * 3));
  const overflow = t > 0.88;
  return { count, baseH, overflow, t, seed: amount * 2654435761 };
}

function buildStacks(plan) {
  const { count, baseH, seed } = plan;
  if (count <= 0) return [];

  const slotIdx = pickUniformIndices(count, STACK_SLOTS.length);

  return slotIdx.map((si, i) => {
    const h = hash(seed + i * 97);
    const h2 = hash(seed + i * 193);
    const h3 = hash(seed + i * 389);
    const layers = Math.max(1, Math.min(4, baseH + Math.floor(h * 2) - (h2 > 0.7 ? 1 : 0)));
    return {
      slot: STACK_SLOTS[si],
      color: STACK_COLORS[Math.floor(h2 * STACK_COLORS.length)],
      rot: (h3 - 0.5) * 28,
      // jitter basso: restano nella cella, senza ammucchiarsi
      jitterX: (h - 0.5) * 8,
      jitterY: (h2 - 0.5) * 6,
      layers,
      lean: (h3 - 0.5) * 2,
      wide: h > 0.5,
    };
  });
}

function BillFace({ color, wide, small }) {
  const w = small ? (wide ? 28 : 24) : wide ? 52 : 46;
  const h = small ? (wide ? 15 : 13) : wide ? 28 : 24;
  return (
    <View
      style={[
        styles.bill,
        {
          width: w,
          height: h,
          backgroundColor: color.body,
          borderColor: color.edge,
        },
      ]}
    >
      <View style={[styles.billStripeL, { backgroundColor: color.band }]} />
      <View style={[styles.billStripeR, { backgroundColor: color.band }]} />
      <View style={[styles.billBand, { backgroundColor: color.band }]} />
      <View style={[styles.billSeal, small && styles.billSealSm, { borderColor: color.edge }]} />
      <View style={[styles.billWatermark, { backgroundColor: color.edge }]} />
    </View>
  );
}

/**
 * Valigia top-down + mazzette; sotto solo zip + input Budget.
 */
export default function BudgetVaultPreview({
  budget = 0,
  compact = false,
  inputProps,
  error,
}) {
  const amount = Math.min(MAX_BUDGET, Math.max(0, parseInt(budget, 10) || 0));
  const plan = useMemo(() => stackPlan(amount), [amount]);
  const stacks = useMemo(() => buildStacks(plan), [plan]);

  const renderStacks = (list, overflow, small = false) => {
    if (list.length === 0) {
      return <View style={[styles.emptyHint, small && styles.emptyHintSm]} />;
    }
    const scale = small ? 0.55 : 1;
    return list.map((s, i) => {
      const lift = overflow && i >= list.length - 3 ? -8 : 0;
      return (
        <View
          key={`st-${i}`}
          style={[
            styles.stackWrap,
            {
              left: (s.slot.x + s.jitterX) * scale + (small ? 2 : 0),
              top: (s.slot.y + s.jitterY) * scale + lift + (small ? 2 : 0),
              transform: [{ rotate: `${s.rot}deg` }],
              zIndex: i,
            },
          ]}
        >
          {Array.from({ length: s.layers }).map((_, layer) => (
            <View
              key={`ly-${i}-${layer}`}
              style={{
                marginTop: layer === 0 ? 0 : small ? -9 : -13,
                transform: [{ translateX: layer * s.lean }],
              }}
            >
              <BillFace color={s.color} wide={s.wide} small={small} />
            </View>
          ))}
        </View>
      );
    });
  };

  const visible = compact ? stacks.slice(0, 7) : stacks;

  if (compact) {
    return (
      <View style={styles.compactCase}>
        <View style={styles.compactInterior}>
          {renderStacks(visible, false, true)}
        </View>
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
            <View style={styles.felt}>
              {renderStacks(visible, plan.overflow)}
              {plan.overflow ? (
                <View style={styles.spillRow}>
                  <View style={[styles.spillBill, { backgroundColor: '#86efac', transform: [{ rotate: '-22deg' }] }]}>
                    <View style={[styles.billStripeL, { backgroundColor: '#16a34a', width: 4 }]} />
                  </View>
                  <View style={[styles.spillBill, { backgroundColor: '#fdba74', transform: [{ rotate: '16deg' }] }]}>
                    <View style={[styles.billStripeL, { backgroundColor: '#c2410c', width: 4 }]} />
                  </View>
                  <View style={[styles.spillBill, { backgroundColor: '#93c5fd', transform: [{ rotate: '-8deg' }] }]}>
                    <View style={[styles.billStripeL, { backgroundColor: '#1d4ed8', width: 4 }]} />
                  </View>
                </View>
              ) : null}
            </View>
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
    height: 140,
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
  stackWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  bill: {
    borderRadius: 4,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  billStripeL: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 7,
    opacity: 0.75,
  },
  billStripeR: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 7,
    opacity: 0.75,
  },
  billBand: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: '42%',
    height: 4,
    borderRadius: 1,
    opacity: 0.45,
  },
  billSeal: {
    position: 'absolute',
    right: 12,
    top: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  billSealSm: {
    right: 5,
    top: 3,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  billWatermark: {
    position: 'absolute',
    left: 12,
    bottom: 5,
    width: 10,
    height: 10,
    borderRadius: 5,
    opacity: 0.2,
  },
  spillRow: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    flexDirection: 'row',
    gap: 2,
  },
  spillBill: {
    width: 38,
    height: 20,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
    overflow: 'hidden',
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
