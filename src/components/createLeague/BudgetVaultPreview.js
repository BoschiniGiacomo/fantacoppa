import React, { useMemo } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import Svg, { Rect, Ellipse, Defs, LinearGradient, Stop, G } from 'react-native-svg';

const MAX = 1000;
const MAX_PILES = 4;
/** Cap diversi → anche a 1000 le altezze restano diverse. */
const PILE_CAPS = [10, 5, 8, 4];
const MAX_LAYERS = Math.max(...PILE_CAPS);
const MAX_TOTAL_LAYERS = PILE_CAPS.reduce((a, b) => a + b, 0);
const UNIT = MAX / MAX_TOTAL_LAYERS;

const BILL = { w: 58, h: 34, step: 5.2, rx: 8 };

const C = {
  faceTop: '#d8eadc',
  face: '#9fc7a8',
  faceMid: '#7eaf8c',
  edge: '#5a8f6c',
  edgeDark: '#3f6b50',
  ink: '#2d4f3a',
  band: '#eef7f0',
};

/**
 * Mazzetta frontale: spessore a strati + faccia arrotondato soft.
 */
function Mazzetta({ layers, index, scale = 1 }) {
  const n = Math.max(0, Math.min(MAX_LAYERS, layers));
  if (n <= 0) return null;

  const w = BILL.w;
  const h = BILL.h;
  const step = BILL.step;
  const svgW = w + 6;
  const svgH = h + (n - 1) * step + 6;
  const x = 3;
  const topY = 1;

  return (
    <View style={{ transform: [{ scale }], marginBottom: scale < 1 ? -((1 - scale) * svgH) / 2 : 0 }}>
      <Svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
        <Defs>
          <LinearGradient id={`f-${index}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.faceTop} />
            <Stop offset="0.55" stopColor={C.face} />
            <Stop offset="1" stopColor={C.faceMid} />
          </LinearGradient>
        </Defs>

        {Array.from({ length: n - 1 }).map((_, i) => {
          const fromTop = n - 2 - i;
          const y = topY + h - 5 + fromTop * step;
          return (
            <Rect
              key={`e-${i}`}
              x={x + 1.5}
              y={y}
              width={w - 3}
              height={5.6}
              rx={2.4}
              ry={2.4}
              fill={i % 2 === 0 ? C.edge : C.edgeDark}
              opacity={0.92}
            />
          );
        })}

        <G>
          <Rect
            x={x}
            y={topY}
            width={w}
            height={h}
            rx={BILL.rx}
            ry={BILL.rx}
            fill={`url(#f-${index})`}
          />
          <Rect
            x={x + 2.5}
            y={topY + 2.5}
            width={w - 5}
            height={h - 5}
            rx={5.5}
            ry={5.5}
            fill="none"
            stroke={C.band}
            strokeWidth={1.4}
            opacity={0.9}
          />
          <Ellipse
            cx={x + w / 2}
            cy={topY + h / 2}
            rx={8}
            ry={8}
            fill={C.faceTop}
            opacity={0.5}
          />
          <Ellipse
            cx={x + w / 2}
            cy={topY + h / 2}
            rx={4.4}
            ry={4.4}
            fill="none"
            stroke={C.ink}
            strokeWidth={1.2}
            opacity={0.32}
          />
          <Rect
            x={x + 6}
            y={topY + 8}
            width={5}
            height={h - 16}
            rx={2.4}
            fill={C.edge}
            opacity={0.22}
          />
          <Rect
            x={x + w - 11}
            y={topY + 8}
            width={5}
            height={h - 16}
            rx={2.4}
            fill={C.edge}
            opacity={0.22}
          />
        </G>
      </Svg>
    </View>
  );
}

function pilesFromBudget(amount) {
  const totalLayers = Math.min(
    MAX_TOTAL_LAYERS,
    Math.round(amount / UNIT)
  );
  if (totalLayers <= 0) return [];

  const weightSum = MAX_TOTAL_LAYERS;
  const assigned = PILE_CAPS.map((cap) =>
    Math.min(cap, Math.floor((totalLayers * cap) / weightSum))
  );
  let rem = totalLayers - assigned.reduce((a, b) => a + b, 0);
  const order = [0, 2, 1, 3];
  let guard = 0;
  while (rem > 0 && guard < 64) {
    const p = order[guard % MAX_PILES];
    if (assigned[p] < PILE_CAPS[p]) {
      assigned[p] += 1;
      rem -= 1;
    }
    guard += 1;
  }

  return assigned.filter((n) => n > 0);
}

/**
 * Barra budget custom: binario soft + cursore a mini-banconota.
 */
export function BudgetCreditRail({
  value = 0,
  max = MAX,
  trackRef,
  onTrackLayout,
  panHandlers,
}) {
  const amount = Math.min(max, Math.max(0, parseInt(value, 10) || 0));
  const pct = (amount / max) * 100;

  return (
    <View style={railStyles.wrap} {...(panHandlers || {})}>
      <View
        ref={trackRef}
        style={railStyles.track}
        onLayout={onTrackLayout}
      >
        <View style={railStyles.well} />
        <View style={[railStyles.fill, { width: `${pct}%` }]} />
        <View style={[railStyles.thumb, { left: `${pct}%` }]}>
          <Svg width={18} height={28} viewBox="0 0 18 28">
            <Defs>
              <LinearGradient id="thumbFace" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={C.faceTop} />
                <Stop offset="1" stopColor={C.faceMid} />
              </LinearGradient>
            </Defs>
            <Rect x="0.5" y="0.5" width="17" height="27" rx="5" ry="5" fill="url(#thumbFace)" />
            <Rect
              x="2.5"
              y="2.5"
              width="13"
              height="23"
              rx="3.5"
              ry="3.5"
              fill="none"
              stroke={C.band}
              strokeWidth="1.2"
            />
            <Ellipse cx="9" cy="14" rx="3.2" ry="3.2" fill={C.faceTop} opacity={0.65} />
            <Ellipse
              cx="9"
              cy="14"
              rx="1.8"
              ry="1.8"
              fill="none"
              stroke={C.ink}
              strokeWidth="0.9"
              opacity={0.35}
            />
          </Svg>
        </View>
      </View>
      <View style={railStyles.labels}>
        <Text style={railStyles.label}>0</Text>
        <Text style={railStyles.label}>{max}</Text>
      </View>
    </View>
  );
}

const railStyles = StyleSheet.create({
  wrap: {
    height: 42,
    justifyContent: 'center',
  },
  track: {
    height: 14,
    borderRadius: 8,
    position: 'relative',
    justifyContent: 'center',
  },
  well: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#e6efe8',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfdcd3',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#7eaf8c',
    borderRadius: 8,
  },
  thumb: {
    position: 'absolute',
    top: -7,
    marginLeft: -9,
    width: 18,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labels: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
});

export default function BudgetVaultPreview({
  budget = 0,
  compact = false,
  inputProps,
  error,
}) {
  const amount = Math.min(MAX, Math.max(0, parseInt(budget, 10) || 0));
  const piles = useMemo(() => pilesFromBudget(amount), [amount]);
  const scale = compact ? 0.62 : 1;

  const stage = (
    <View style={[styles.stage, compact && styles.stageCompact]}>
      <View style={[styles.shelf, compact && styles.shelfCompact]}>
        {piles.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyPad} />
            {!compact ? <Text style={styles.hint}>Trascina per riempire</Text> : null}
          </View>
        ) : (
          <View style={styles.pilesRow}>
            {piles.map((layers, i) => (
              <Mazzetta key={`p-${i}`} layers={layers} index={i} scale={scale} />
            ))}
          </View>
        )}
        <View style={styles.shelfLip} />
      </View>
    </View>
  );

  if (compact) {
    return (
      <View style={styles.compact}>
        <Text style={styles.compactAmount}>{amount}</Text>
        {stage}
      </View>
    );
  }

  return (
    <View style={[styles.card, error && styles.cardError]}>
      {stage}

      {inputProps ? (
        <View style={styles.controls}>
          <View style={styles.sliderCol}>
            <View style={styles.labelSpacer} />
            <View style={styles.sliderSlot}>{inputProps.slider}</View>
          </View>
          <View style={styles.inputCol}>
            <Text style={styles.label}>Budget</Text>
            <TextInput
              ref={inputProps.textInput?.ref}
              {...(inputProps.textInput
                ? (({ ref: _r, style: _s, ...rest }) => rest)(inputProps.textInput)
                : {})}
              style={[styles.input, inputProps.textInput?.style, error && styles.inputError]}
              placeholderTextColor="#94a3b8"
              selectionColor="#7eaf8c"
            />
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 4,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  cardError: {
    borderColor: '#f87171',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
    color: '#64748b',
    marginBottom: 4,
    textAlign: 'center',
  },
  stage: {
    marginBottom: 12,
  },
  stageCompact: {
    marginBottom: 0,
  },
  shelf: {
    backgroundColor: '#f3f7f4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e8e2',
    paddingTop: 14,
    paddingBottom: 8,
    paddingHorizontal: 8,
    minHeight: 148,
    justifyContent: 'flex-end',
  },
  shelfCompact: {
    minHeight: 72,
    paddingTop: 6,
    paddingBottom: 4,
    paddingHorizontal: 4,
  },
  shelfLip: {
    height: 3,
    borderRadius: 2,
    backgroundColor: '#d2ddd5',
    marginTop: 4,
    marginHorizontal: 2,
  },
  pilesRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
    minHeight: 110,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 110,
    paddingBottom: 6,
  },
  emptyPad: {
    width: 36,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#d5e0d8',
  },
  hint: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '500',
    color: '#94a3b8',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 4,
    paddingBottom: 12,
  },
  sliderCol: {
    flex: 1,
  },
  labelSpacer: {
    height: 15,
    marginBottom: 4,
  },
  sliderSlot: {
    height: 42,
    justifyContent: 'center',
  },
  inputCol: {
    width: 72,
    alignItems: 'stretch',
  },
  input: {
    width: '100%',
    height: 42,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 0,
    paddingHorizontal: 4,
  },
  inputError: {
    borderColor: '#f87171',
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
  compact: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
  },
  compactAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
  },
});
