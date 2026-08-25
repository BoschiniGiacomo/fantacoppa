import React, {
  useMemo, useState, useEffect, useCallback,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import Svg, { Line, Circle, Polyline, Text as SvgText, TSpan } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

const CHART_HEIGHT = 196;
const PADDING = { top: 10, right: 16, bottom: 40, left: 28 };
const PLOT_LEFT_ZOOMED = 10;
const ACCENT = '#667eea';
const MARKET_ACCENT = '#b8860b';
const LENS_COLOR = '#94a3b8';
const POINT_SPACING = 34;
const MARKET_MIN_SEASONS_FOR_ZOOM = 8;

function ZoomLensToggle({ zoomed, onPress }) {
  return (
    <TouchableOpacity
      style={styles.zoomToggleButton}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={zoomed ? 'Riduci zoom grafico' : 'Ingrandisci grafico'}
    >
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Circle cx={9.2} cy={9.2} r={6.4} stroke={LENS_COLOR} strokeWidth={1.7} fill="none" />
        <Line x1={13.8} y1={13.8} x2={19.2} y2={19.2} stroke={LENS_COLOR} strokeWidth={1.9} strokeLinecap="round" />
        {zoomed ? (
          <Line x1={6.4} y1={9.2} x2={12} y2={9.2} stroke={LENS_COLOR} strokeWidth={1.7} strokeLinecap="round" />
        ) : (
          <>
            <Line x1={9.2} y1={6.4} x2={9.2} y2={12} stroke={LENS_COLOR} strokeWidth={1.7} strokeLinecap="round" />
            <Line x1={6.4} y1={9.2} x2={12} y2={9.2} stroke={LENS_COLOR} strokeWidth={1.7} strokeLinecap="round" />
          </>
        )}
      </Svg>
    </TouchableOpacity>
  );
}

function formatRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function formatGiornataLabel(giornata) {
  const n = Number(giornata);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function clampZoom(value, maxZoom) {
  return Math.min(maxZoom, Math.max(1, value));
}

function pickYStep(span) {
  if (span <= 1) return 0.25;
  if (span <= 2.5) return 0.5;
  if (span <= 5) return 1;
  if (span <= 10) return 2;
  return 4;
}

function computeYAxisScale(values, domainMinOverride = null) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) {
    return { minY: 5, maxY: 7, ticks: [5, 6, 7] };
  }

  const dataMax = Math.max(...finite);
  const rawMin = Math.min(...finite);
  const dataMin = Number.isFinite(domainMinOverride) ? domainMinOverride : rawMin;
  const range = Math.max(0.01, dataMax - dataMin);

  // Fondo: padding stretto (già apprezzato). Cima: solo spazio per i marker, senza un'intera tacca vuota.
  const padBottom = Math.max(0.08, range * 0.03);
  const padTop = Math.max(0.2, range * 0.025);

  let domainMin = dataMin - padBottom;
  let domainMax = dataMax + padTop;

  if (domainMax - domainMin < 0.8) {
    const mid = (dataMin + dataMax) / 2;
    domainMin = mid - 0.4;
    domainMax = mid + 0.4;
  }

  let step = pickYStep(domainMax - domainMin);
  let axisMin = Math.floor(domainMin / step) * step;
  // Massimo: arrotonda in alto solo se non crea troppo vuoto sopra il picco
  let axisMax = Math.ceil(domainMax / step) * step;
  if (axisMax - dataMax > step * 0.45) {
    axisMax = domainMax;
  }

  while (axisMin > dataMin - padBottom) axisMin -= step;

  let ticks = [];
  for (let tick = axisMin; tick <= axisMax + step * 0.0001; tick += step) {
    if (tick <= axisMax + 0.001) ticks.push(Math.round(tick * 1000) / 1000);
    if (ticks.length >= 8) break;
  }

  // Se troppe tacche, allarga lo step ma tieni il max agganciato ai dati (no salto a 20 su un picco 15.5)
  while (ticks.length > 6) {
    step *= 2;
    axisMin = Math.floor(domainMin / step) * step;
    while (axisMin > dataMin - padBottom) axisMin -= step;
    axisMax = Math.ceil(domainMax / step) * step;
    if (axisMax - dataMax > step * 0.45) {
      axisMax = domainMax;
    }
    ticks = [];
    for (let tick = axisMin; tick <= axisMax + step * 0.0001; tick += step) {
      if (tick <= axisMax + 0.001) ticks.push(Math.round(tick * 1000) / 1000);
      if (ticks.length >= 8) break;
    }
  }

  if (ticks.length < 2) {
    ticks = [axisMin, axisMax];
  }

  // Assicura che il massimo reale dei dati stia dentro la scala
  const scaleMax = Math.max(axisMax, dataMax + padTop * 0.5);
  const scaleMin = Math.min(axisMin, dataMin - padBottom * 0.5);

  return { minY: scaleMin, maxY: scaleMax, ticks };
}

function GiornataAxisLabel({ x, y, giornata }) {
  const value = formatGiornataLabel(giornata);
  if (value == null) {
    return (
      <SvgText x={x} y={y} fontSize={9} fill="#94a3b8" fontWeight="600" textAnchor="middle">
        –
      </SvgText>
    );
  }

  return (
    <SvgText x={x} y={y} fontSize={9} fill="#94a3b8" fontWeight="600" textAnchor="middle">
      <TSpan>{value}</TSpan>
      <TSpan fontSize={6} baselineShift="super">a</TSpan>
    </SvgText>
  );
}

function formatYearLabel(referenceYear, compact = false) {
  const year = Number(referenceYear);
  if (!Number.isFinite(year) || year <= 0) return '–';
  if (compact) {
    const short = String(Math.trunc(year) % 100).padStart(2, '0');
    return `${short}'`;
  }
  return String(Math.trunc(year));
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

export default function PlayerFormChart({
  series = [],
  width = 320,
  mode = 'league',
  variant = 'form',
}) {
  const isMarket = variant === 'market';
  const isTotalMode = mode === 'total' || isMarket;
  const lineColor = isMarket ? MARKET_ACCENT : ACCENT;
  const viewportWidth = Math.max(240, Number(width) || 320);
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomShared = useSharedValue(1);
  const maxZoomShared = useSharedValue(1);
  const basePinchZoom = useSharedValue(1);

  const scoredPoints = useMemo(
    () => (Array.isArray(series) ? series : [])
      .map((point, index) => {
        if (isMarket) {
          const marketValue = Number(point?.market_value ?? point?.rating);
          return {
            index,
            giornata: Number(point?.reference_year ?? point?.giornata),
            referenceYear: point?.reference_year != null ? Number(point.reference_year) : null,
            rating: marketValue,
            ratingWithBonus: marketValue,
            isScored: Number.isFinite(marketValue),
          };
        }
        return {
          index,
          giornata: Number(point?.giornata),
          referenceYear: point?.reference_year != null ? Number(point.reference_year) : null,
          rating: Number(point?.rating),
          ratingWithBonus: Number(point?.rating_with_bonus),
          isScored: Number(point?.rating) > 0,
        };
      })
      .filter((point) => point.isScored),
    [series, isMarket],
  );

  const maxZoom = useMemo(() => {
    if (!isTotalMode || scoredPoints.length <= 1) return 1;
    const fullPlotWidth = (scoredPoints.length - 1) * POINT_SPACING + PLOT_LEFT_ZOOMED + PADDING.right;
    const zoomViewport = Math.max(160, viewportWidth - PADDING.left);
    return Math.max(1, fullPlotWidth / zoomViewport);
  }, [isTotalMode, scoredPoints.length, viewportWidth]);

  const canZoom = isTotalMode
    && maxZoom > 1.01
    && (!isMarket || scoredPoints.length >= MARKET_MIN_SEASONS_FOR_ZOOM);
  const isZoomedIn = canZoom && zoomLevel > 1.01;
  const yAxisWidth = isZoomedIn ? PADDING.left : 0;
  const plotLeft = isZoomedIn ? PLOT_LEFT_ZOOMED : PADDING.left;
  const scrollViewportWidth = Math.max(160, viewportWidth - yAxisWidth);

  const expandedWidth = useMemo(() => {
    if (!isTotalMode || scoredPoints.length <= 1) {
      return isZoomedIn ? scrollViewportWidth : viewportWidth;
    }
    return Math.max(
      scrollViewportWidth,
      (scoredPoints.length - 1) * POINT_SPACING + plotLeft + PADDING.right,
    );
  }, [isTotalMode, scoredPoints.length, viewportWidth, scrollViewportWidth, isZoomedIn, plotLeft]);

  const displayWidth = useMemo(() => {
    if (!isTotalMode) return viewportWidth;
    if (!isZoomedIn) return viewportWidth;
    return Math.min(expandedWidth, Math.max(scrollViewportWidth, scrollViewportWidth * zoomLevel));
  }, [isTotalMode, isZoomedIn, viewportWidth, expandedWidth, scrollViewportWidth, zoomLevel]);

  const canScroll = isZoomedIn && displayWidth > scrollViewportWidth + 1;

  const innerWidth = displayWidth - plotLeft - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const isFittedTotal = isTotalMode && !isZoomedIn;

  const applyZoom = useCallback((next) => {
    const clamped = clampZoom(next, maxZoom);
    zoomShared.value = clamped;
    basePinchZoom.value = clamped;
    setZoomLevel(clamped);
  }, [maxZoom, zoomShared, basePinchZoom]);

  useEffect(() => {
    maxZoomShared.value = maxZoom;
  }, [maxZoom]);

  useEffect(() => {
    zoomShared.value = 1;
    basePinchZoom.value = 1;
    setZoomLevel(1);
  }, [series, mode, variant]);

  const pinchGesture = useMemo(() => Gesture.Pinch()
    .enabled(canZoom)
    .onBegin(() => {
      basePinchZoom.value = zoomShared.value;
    })
    .onUpdate((event) => {
      const next = Math.min(
        maxZoomShared.value,
        Math.max(1, basePinchZoom.value * event.scale),
      );
      zoomShared.value = next;
      runOnJS(setZoomLevel)(next);
    })
    .onEnd(() => {
      runOnJS(setZoomLevel)(zoomShared.value);
    }), [canZoom, zoomShared, maxZoomShared, basePinchZoom]);

  const layout = useMemo(() => {
    if (!scoredPoints.length) return null;

    const ratings = scoredPoints.map((p) => p.rating);
    const bonusRatings = isMarket
      ? []
      : scoredPoints.map((p) => p.ratingWithBonus);
    const allValues = [...ratings, ...bonusRatings].filter((v) => Number.isFinite(v));
    const baseMin = ratings.filter((v) => Number.isFinite(v));
    const domainMin = baseMin.length ? Math.min(...baseMin) : null;
    const { minY, maxY, ticks } = computeYAxisScale(allValues, domainMin);
    const spanY = Math.max(0.1, maxY - minY);

    const xForIndex = (index) => {
      if (isTotalMode) {
        if (scoredPoints.length === 1) return plotLeft + innerWidth / 2;
        if (isFittedTotal) {
          return plotLeft + (index / (scoredPoints.length - 1)) * innerWidth;
        }
        return plotLeft + index * POINT_SPACING;
      }
      if (scoredPoints.length === 1) return plotLeft + innerWidth / 2;
      return plotLeft + (index / (scoredPoints.length - 1)) * innerWidth;
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

    const bonusCoords = isMarket
      ? []
      : scoredPoints.map((point, index) => ({
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
          label: formatYearLabel(segment.year, isFittedTotal),
        };
      })
      : [];

    return {
      minY,
      maxY,
      yTicks: ticks.map((value) => ({
        value,
        y: yForValue(value),
      })),
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
  }, [scoredPoints, innerWidth, innerHeight, isTotalMode, isFittedTotal, plotLeft, isMarket]);

  const handleZoomToggle = () => {
    applyZoom(isZoomedIn ? 1 : maxZoom);
  };

  if (!layout) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>
          {isMarket
            ? 'Nessun valore di mercato disponibile per il grafico.'
            : 'Nessun voto disponibile per il grafico.'}
        </Text>
      </View>
    );
  }

  const bestPoint = layout.voteCoords[layout.bestIndex];
  const worstPoint = layout.voteCoords[layout.worstIndex];

  const formatTickLabel = (value) => (
    Number.isInteger(value) ? String(value) : value.toFixed(1)
  );

  const gridAndPlot = (
    <>
      {(layout.yTicks || []).map((tick) => (
        <Line
          key={`grid-${tick.value}`}
          x1={plotLeft}
          y1={tick.y}
          x2={displayWidth - PADDING.right}
          y2={tick.y}
          stroke="#f0f0f0"
          strokeWidth={1}
        />
      ))}

      {!isMarket && layout.bonusPolyline ? (
        <Polyline
          points={layout.bonusPolyline}
          fill="none"
          stroke="#c7d2fe"
          strokeWidth={2}
          strokeDasharray="4 4"
        />
      ) : null}
      <Polyline
        points={layout.votePolyline}
        fill="none"
        stroke={lineColor}
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
          stroke={lineColor}
          strokeWidth={2}
        />
      ))}

      {bestPoint ? (
        <Circle cx={bestPoint.x} cy={bestPoint.y} r={5} fill="#198754" stroke="#fff" strokeWidth={2} />
      ) : null}
      {worstPoint && layout.worstIndex !== layout.bestIndex ? (
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
        <>
          {layout.voteCoords.map((point) => (
            <GiornataAxisLabel
              key={`giornata-${point.index}`}
              x={point.x}
              y={CHART_HEIGHT - 22}
              giornata={point.giornata}
            />
          ))}
          <SvgText
            x={displayWidth / 2}
            y={CHART_HEIGHT - 8}
            fontSize={10}
            fill="#64748b"
            fontWeight="600"
            textAnchor="middle"
          >
            Giornata
          </SvgText>
        </>
      )}
    </>
  );

  const yAxisLabels = (layout.yTicks || []).map((tick) => (
    <SvgText
      key={`ylabel-${tick.value}`}
      x={PADDING.left - 6}
      y={tick.y + 4}
      fontSize={10}
      fill="#94a3b8"
      textAnchor="end"
    >
      {formatTickLabel(tick.value)}
    </SvgText>
  ));

  const stickyYAxis = (
    <View pointerEvents="none" style={[styles.stickyYAxis, { width: yAxisWidth || PADDING.left }]}>
      <Svg width={yAxisWidth || PADDING.left} height={CHART_HEIGHT}>
        {yAxisLabels}
      </Svg>
    </View>
  );

  const chartSvg = (
    <Svg width={displayWidth} height={CHART_HEIGHT}>
      {gridAndPlot}
      {!canScroll ? yAxisLabels : null}
    </Svg>
  );

  const chartBody = canScroll ? (
    <View style={[styles.chartRow, { width: viewportWidth, height: CHART_HEIGHT }]}>
      {stickyYAxis}
      <ScrollView
        horizontal
        scrollEnabled
        showsHorizontalScrollIndicator
        nestedScrollEnabled
        style={{ width: scrollViewportWidth }}
        contentContainerStyle={styles.scrollContent}
      >
        {chartSvg}
      </ScrollView>
    </View>
  ) : (
    <View style={[styles.chartViewport, { width: viewportWidth }]}>
      {chartSvg}
    </View>
  );

  return (
    <View>
      {canZoom ? (
        <View style={styles.zoomToolbar}>
          <ZoomLensToggle zoomed={isZoomedIn} onPress={handleZoomToggle} />
        </View>
      ) : null}

      <GestureDetector gesture={pinchGesture}>
        <View style={[styles.chartGestureWrap, { width: viewportWidth }]}>
          {chartBody}
        </View>
      </GestureDetector>

      <View style={styles.legendRow}>
        {isMarket ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: MARKET_ACCENT }]} />
            <Text style={styles.legendText}>Valore di mercato</Text>
          </View>
        ) : (
          <>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: ACCENT }]} />
              <Text style={styles.legendText}>Voto</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, styles.legendLineDashed]} />
              <Text style={styles.legendText}>Con bonus</Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.highlightRow}>
        <Text style={styles.highlightText}>
          {isMarket ? 'Più alto' : 'Migliore'}:{' '}
          <Text style={styles.highlightBest}>{formatRating(layout.best.rating)}</Text>
          {' '}· {isMarket ? 'Più basso' : 'Peggiore'}:{' '}
          <Text style={styles.highlightWorst}>{formatRating(layout.worst.rating)}</Text>
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
  zoomToolbar: {
    alignItems: 'flex-end',
    marginBottom: 4,
  },
  zoomToggleButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartGestureWrap: {
    overflow: 'hidden',
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  chartViewport: {
    overflow: 'hidden',
    position: 'relative',
  },
  stickyYAxis: {
    backgroundColor: '#fff',
    zIndex: 2,
  },
  scrollContent: {
    minWidth: '100%',
  },
  scrollHint: {
    marginTop: 6,
    fontSize: 11,
    color: '#667eea',
    textAlign: 'center',
    fontWeight: '600',
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
