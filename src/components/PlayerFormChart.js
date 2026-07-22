import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Svg, { Line, Circle, Polyline, Text as SvgText } from 'react-native-svg';

const CHART_HEIGHT = 196;
const PADDING = { top: 12, right: 16, bottom: 40, left: 28 };
const ACCENT = '#667eea';
const POINT_SPACING = 34;

function formatRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function formatYearLabel(referenceYear) {
  const year = Number(referenceYear);
  if (Number.isFinite(year) && year > 0) return String(Math.trunc(year));
  return '–';
}

function buildYearSegments(points) {
  if (!points.length) return [];

  const segments = [];
  let currentYear = points[0].referenceYear;
  let startIndex = 0;

  for (let index = 1; index < points.length; index += 1) {
    const year = points[index].referenceYear;
    if (year !== currentYear) {
      segments.push({ year: currentYear, startIndex, endIndex: index - 1 });
      currentYear = year;
      startIndex = index;
    }
  }

  segments.push({ year: currentYear, startIndex, endIndex: points.length - 1 });
  return segments;
}

export default function PlayerFormChart({ series = [], width = 320, mode = 'league' }) {
  const isTotalMode = mode === 'total';
  const viewportWidth = Math.max(240, Number(width) || 320);

  const scoredPoints = useMemo(
    () => (Array.isArray(series) ? series : [])
      .map((point, index) => ({
        index,
        giornata: Number(point?.giornata),
        referenceYear: point?.reference_year != null ? Number(point.reference_year) : null,
        rating: Number(point?.rating),
        ratingWithBonus: Number(point?.rating_with_bonus),
        isScored: Number(point?.rating) > 0,
      }))
      .filter((point) => point.isScored),
    [series],
  );

  const chartContentWidth = useMemo(() => {
    if (!scoredPoints.length) return viewportWidth;
    if (!isTotalMode) return viewportWidth;
    const minWidth = scoredPoints.length * POINT_SPACING + PADDING.left + PADDING.right;
    return Math.max(viewportWidth, minWidth);
  }, [isTotalMode, scoredPoints.length, viewportWidth]);

  const innerWidth = chartContentWidth - PADDING.left - PADDING.right;
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
      if (isTotalMode) {
        if (scoredPoints.length === 1) return PADDING.left + innerWidth / 2;
        return PADDING.left + index * POINT_SPACING;
      }
      if (scoredPoints.length === 1) return PADDING.left + innerWidth / 2;
      return PADDING.left + (index / (scoredPoints.length - 1)) * innerWidth;
    };

    const yForValue = (value) => PADDING.top + innerHeight - ((value - minY) / spanY) * innerHeight;

    const voteCoords = scoredPoints.map((point, index) => ({
      x: xForIndex(index),
      y: yForValue(point.rating),
      giornata: point.giornata,
      referenceYear: point.referenceYear,
      index,
      rating: point.rating,
    }));

    const bonusCoords = scoredPoints.map((point, index) => ({
      x: xForIndex(index),
      y: yForValue(point.ratingWithBonus),
    }));

    let bestIndex = 0;
    let worstIndex = 0;
    for (let index = 0; index < scoredPoints.length; index += 1) {
      if (scoredPoints[index].rating > scoredPoints[bestIndex].rating) bestIndex = index;
      if (scoredPoints[index].rating < scoredPoints[worstIndex].rating) worstIndex = index;
    }

    const yearSegments = isTotalMode
      ? buildYearSegments(scoredPoints).map((segment) => {
        const startX = xForIndex(segment.startIndex);
        const endX = xForIndex(segment.endIndex);
        return {
          ...segment,
          centerX: (startX + endX) / 2,
          label: formatYearLabel(segment.year),
        };
      })
      : [];

    return {
      minY,
      maxY,
      voteCoords,
      bonusCoords,
      best: scoredPoints[bestIndex],
      worst: scoredPoints[worstIndex],
      bestIndex,
      worstIndex,
      yearSegments,
      votePolyline: voteCoords.map((p) => `${p.x},${p.y}`).join(' '),
      bonusPolyline: bonusCoords.map((p) => `${p.x},${p.y}`).join(' '),
    };
  }, [scoredPoints, innerWidth, innerHeight, isTotalMode]);

  if (!layout) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>Nessun voto disponibile per il grafico.</Text>
      </View>
    );
  }

  const bestPoint = layout.voteCoords[layout.bestIndex];
  const worstPoint = layout.voteCoords[layout.worstIndex];

  const chartSvg = (
    <Svg width={chartContentWidth} height={CHART_HEIGHT}>
      {[0, 0.5, 1].map((ratio) => {
        const y = PADDING.top + innerHeight * ratio;
        const value = layout.maxY - ratio * (layout.maxY - layout.minY);
        return (
          <React.Fragment key={ratio}>
            <Line
              x1={PADDING.left}
              y1={y}
              x2={chartContentWidth - PADDING.right}
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

      {layout.voteCoords.map((point) => (
        <Circle
          key={`vote-${point.index}`}
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

      {isTotalMode ? (
        layout.yearSegments.map((segment) => (
          <SvgText
            key={`year-${segment.startIndex}-${segment.endIndex}`}
            x={segment.centerX}
            y={CHART_HEIGHT - 10}
            fontSize={10}
            fill="#64748b"
            fontWeight="600"
            textAnchor="middle"
          >
            {segment.label}
          </SvgText>
        ))
      ) : (
        layout.voteCoords.map((point) => (
          <SvgText
            key={`giornata-${point.index}`}
            x={point.x}
            y={CHART_HEIGHT - 10}
            fontSize={9}
            fill="#94a3b8"
            fontWeight="600"
            textAnchor="middle"
          >
            {Number.isFinite(point.giornata) ? String(point.giornata) : '–'}
          </SvgText>
        ))
      )}
    </Svg>
  );

  return (
    <View>
      {isTotalMode && chartContentWidth > viewportWidth ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          contentContainerStyle={styles.scrollContent}
        >
          {chartSvg}
        </ScrollView>
      ) : (
        chartSvg
      )}

      {isTotalMode && chartContentWidth > viewportWidth ? (
        <Text style={styles.scrollHint}>Scorri orizzontalmente per esplorare la carriera</Text>
      ) : null}

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
  scrollContent: {
    minWidth: '100%',
  },
  scrollHint: {
    marginTop: 4,
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    fontWeight: '500',
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
