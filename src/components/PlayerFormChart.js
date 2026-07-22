import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Circle, Polyline, Text as SvgText } from 'react-native-svg';

const CHART_HEIGHT = 168;
const PADDING = { top: 12, right: 12, bottom: 28, left: 28 };
const ACCENT = '#667eea';

function formatRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

export default function PlayerFormChart({ series = [], width = 320 }) {
  const scoredPoints = useMemo(
    () => (Array.isArray(series) ? series : [])
      .map((point, index) => ({
        index,
        giornata: Number(point?.giornata),
        rating: Number(point?.rating),
        ratingWithBonus: Number(point?.rating_with_bonus),
        isScored: Number(point?.rating) > 0,
      }))
      .filter((point) => point.isScored),
    [series],
  );

  const chartWidth = Math.max(240, Number(width) || 320);
  const innerWidth = chartWidth - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const layout = useMemo(() => {
    if (!scoredPoints.length) return null;

    const ratings = scoredPoints.map((p) => p.rating);
    const bonusRatings = scoredPoints.map((p) => p.ratingWithBonus);
    const allValues = [...ratings, ...bonusRatings].filter((v) => Number.isFinite(v) && v > 0);
    const minY = Math.max(4, Math.min(...allValues) - 0.5);
    const maxY = Math.min(10, Math.max(...allValues) + 0.5);
    const spanY = Math.max(0.5, maxY - minY);

    const xForIndex = (index) => {
      if (scoredPoints.length === 1) return PADDING.left + innerWidth / 2;
      return PADDING.left + (index / (scoredPoints.length - 1)) * innerWidth;
    };
    const yForValue = (value) => PADDING.top + innerHeight - ((value - minY) / spanY) * innerHeight;

    const voteCoords = scoredPoints.map((point, index) => ({
      x: xForIndex(index),
      y: yForValue(point.rating),
      giornata: point.giornata,
      rating: point.rating,
    }));

    const bonusCoords = scoredPoints.map((point, index) => ({
      x: xForIndex(index),
      y: yForValue(point.ratingWithBonus),
    }));

    let best = scoredPoints[0];
    let worst = scoredPoints[0];
    for (const point of scoredPoints) {
      if (point.rating > best.rating) best = point;
      if (point.rating < worst.rating) worst = point;
    }

    return {
      minY,
      maxY,
      voteCoords,
      bonusCoords,
      best,
      worst,
      votePolyline: voteCoords.map((p) => `${p.x},${p.y}`).join(' '),
      bonusPolyline: bonusCoords.map((p) => `${p.x},${p.y}`).join(' '),
    };
  }, [scoredPoints, innerWidth, innerHeight]);

  if (!layout) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>Nessun voto disponibile per il grafico.</Text>
      </View>
    );
  }

  const bestIndex = scoredPoints.findIndex((p) => p.giornata === layout.best.giornata);
  const worstIndex = scoredPoints.findIndex((p) => p.giornata === layout.worst.giornata);
  const bestPoint = layout.voteCoords[bestIndex];
  const worstPoint = layout.voteCoords[worstIndex];

  return (
    <View>
      <Svg width={chartWidth} height={CHART_HEIGHT}>
        {[0, 0.5, 1].map((ratio) => {
          const y = PADDING.top + innerHeight * ratio;
          const value = layout.maxY - ratio * (layout.maxY - layout.minY);
          return (
            <React.Fragment key={ratio}>
              <Line
                x1={PADDING.left}
                y1={y}
                x2={PADDING.left + innerWidth}
                y2={y}
                stroke="#f0f0f0"
                strokeWidth={1}
              />
              <SvgText
                x={PADDING.left - 6}
                y={y + 4}
                fontSize={10}
                fill="#94a3b8"
                textAnchor="end"
              >
                {value.toFixed(1)}
              </SvgText>
            </React.Fragment>
          );
        })}

        <Polyline
          points={layout.bonusPolyline}
          fill="none"
          stroke="#c7d2fe"
          strokeWidth={2}
          strokeDasharray="4 4"
        />
        <Polyline
          points={layout.votePolyline}
          fill="none"
          stroke={ACCENT}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {layout.voteCoords.map((point, index) => (
          <Circle
            key={`vote-${point.giornata}-${index}`}
            cx={point.x}
            cy={point.y}
            r={3.5}
            fill="#fff"
            stroke={ACCENT}
            strokeWidth={2}
          />
        ))}

        {bestPoint ? (
          <Circle cx={bestPoint.x} cy={bestPoint.y} r={5} fill="#198754" stroke="#fff" strokeWidth={2} />
        ) : null}
        {worstPoint ? (
          <Circle cx={worstPoint.x} cy={worstPoint.y} r={5} fill="#dc3545" stroke="#fff" strokeWidth={2} />
        ) : null}
      </Svg>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: ACCENT }]} />
          <Text style={styles.legendText}>Voto</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, styles.legendLineDashed]} />
          <Text style={styles.legendText}>Con bonus</Text>
        </View>
      </View>

      <View style={styles.highlightRow}>
        <Text style={styles.highlightText}>
          Miglior: <Text style={styles.highlightBest}>{formatRating(layout.best.rating)}</Text>
          {' '}· Peggior: <Text style={styles.highlightWorst}>{formatRating(layout.worst.rating)}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWrap: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendLine: {
    width: 18,
    height: 3,
    borderRadius: 2,
  },
  legendLineDashed: {
    backgroundColor: '#c7d2fe',
  },
  legendText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  highlightRow: {
    marginTop: 8,
    alignItems: 'center',
  },
  highlightText: {
    fontSize: 12,
    color: '#64748b',
  },
  highlightBest: {
    color: '#198754',
    fontWeight: '700',
  },
  highlightWorst: {
    color: '#dc3545',
    fontWeight: '700',
  },
});
