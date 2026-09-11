import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const AUTO_MS = 6500;
const RESUME_AFTER_TOUCH_MS = 9000;

/**
 * Carosello CTA estendibile: auto-rotate + swipe orizzontale in loop.
 *
 * Ogni slide:
 * {
 *   id: string,
 *   title: string,
 *   subtitle?: string,
 *   icon?: string (Ionicons name),
 *   renderIcon?: () => ReactNode,
 *   onPress: () => void,
 * }
 */
export default function PromoActionCarousel({
  slides = [],
  autoIntervalMs = AUTO_MS,
  style,
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [trackWidth, setTrackWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);
  const indexRef = useRef(0);
  const pausedUntilRef = useRef(0);
  const userTouchingRef = useRef(false);
  const jumpLockRef = useRef(false);

  const items = useMemo(
    () => (Array.isArray(slides) ? slides.filter((s) => s && s.id && s.title && typeof s.onPress === 'function') : []),
    [slides],
  );

  const loopEnabled = items.length > 1;

  // [clone ultima, ...reali, clone prima] → swipe infinito
  const loopData = useMemo(() => {
    if (!loopEnabled) return items;
    const first = items[0];
    const last = items[items.length - 1];
    return [
      { ...last, _loopKey: `clone-start-${last.id}` },
      ...items.map((item) => ({ ...item, _loopKey: `real-${item.id}` })),
      { ...first, _loopKey: `clone-end-${first.id}` },
    ];
  }, [items, loopEnabled]);

  const pageWidth = trackWidth > 0 ? trackWidth : Math.max(0, windowWidth - 24);

  const scrollToListIndex = useCallback((listIndex, animated = true) => {
    if (pageWidth <= 0) return;
    try {
      listRef.current?.scrollToOffset({
        offset: Math.max(0, listIndex) * pageWidth,
        animated,
      });
    } catch (_) {}
  }, [pageWidth]);

  const goTo = useCallback((nextIndex, animated = true) => {
    if (!items.length || pageWidth <= 0) return;
    const n = items.length;
    const target = ((nextIndex % n) + n) % n;
    const current = indexRef.current;

    if (!loopEnabled) {
      indexRef.current = target;
      setIndex(target);
      scrollToListIndex(target, animated);
      return;
    }

    // Loop animato oltre i bordi (usa le slide clone)
    if (animated && current === n - 1 && target === 0) {
      scrollToListIndex(n + 1, true);
      return;
    }
    if (animated && current === 0 && target === n - 1) {
      scrollToListIndex(0, true);
      return;
    }

    indexRef.current = target;
    setIndex(target);
    scrollToListIndex(target + 1, animated);
  }, [items.length, pageWidth, loopEnabled, scrollToListIndex]);

  const pauseAuto = useCallback(() => {
    pausedUntilRef.current = Date.now() + RESUME_AFTER_TOUCH_MS;
  }, []);

  useEffect(() => {
    indexRef.current = 0;
    setIndex(0);
    if (pageWidth <= 0 || !items.length) return;
    // Parti sulla prima slide reale (indice 1 se loop)
    requestAnimationFrame(() => {
      scrollToListIndex(loopEnabled ? 1 : 0, false);
    });
  }, [items.length, pageWidth, loopEnabled, scrollToListIndex]);

  useEffect(() => {
    if (!loopEnabled) return undefined;
    const timer = setInterval(() => {
      if (userTouchingRef.current) return;
      if (Date.now() < pausedUntilRef.current) return;
      goTo(indexRef.current + 1, true);
    }, Math.max(4000, Number(autoIntervalMs) || AUTO_MS));
    return () => clearInterval(timer);
  }, [loopEnabled, autoIntervalMs, goTo]);

  const syncFromListIndex = useCallback((listIndex) => {
    if (!loopEnabled) {
      const clamped = Math.max(0, Math.min(items.length - 1, listIndex));
      indexRef.current = clamped;
      setIndex(clamped);
      return;
    }

    const n = items.length;
    if (listIndex <= 0) {
      jumpLockRef.current = true;
      indexRef.current = n - 1;
      setIndex(n - 1);
      scrollToListIndex(n, false);
      requestAnimationFrame(() => { jumpLockRef.current = false; });
      return;
    }
    if (listIndex >= n + 1) {
      jumpLockRef.current = true;
      indexRef.current = 0;
      setIndex(0);
      scrollToListIndex(1, false);
      requestAnimationFrame(() => { jumpLockRef.current = false; });
      return;
    }

    const real = listIndex - 1;
    indexRef.current = real;
    setIndex(real);
  }, [loopEnabled, items.length, scrollToListIndex]);

  const onMomentumEnd = useCallback((e) => {
    if (pageWidth <= 0 || jumpLockRef.current) return;
    const x = e?.nativeEvent?.contentOffset?.x || 0;
    const listIndex = Math.round(x / pageWidth);
    syncFromListIndex(listIndex);
  }, [pageWidth, syncFromListIndex]);

  if (!items.length) return null;

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.slide, { width: Math.max(pageWidth, 1) }]}
      activeOpacity={0.88}
      onPress={item.onPress}
    >
      <View style={[styles.iconWrap, item.plainIcon && styles.iconWrapPlain]}>
        {typeof item.renderIcon === 'function' ? (
          item.renderIcon()
        ) : (
          <Ionicons name={item.icon || 'sparkles-outline'} size={22} color="#667eea" />
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        {item.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>{item.subtitle}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  return (
    <View
      style={[styles.wrap, style]}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 0 && w !== trackWidth) setTrackWidth(w);
      }}
    >
      {loopEnabled && pageWidth > 0 ? (
        <View style={styles.dots}>
          {items.map((item, i) => (
            <TouchableOpacity
              key={`dot-${item.id}`}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={() => {
                pauseAuto();
                goTo(i, true);
              }}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>
      ) : null}

      {pageWidth > 0 ? (
        <FlatList
          ref={listRef}
          data={loopData}
          keyExtractor={(item) => String(item._loopKey || item.id)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          renderItem={renderItem}
          onMomentumScrollEnd={onMomentumEnd}
          onScrollBeginDrag={() => {
            userTouchingRef.current = true;
            pauseAuto();
          }}
          onScrollEndDrag={() => {
            userTouchingRef.current = false;
            pauseAuto();
          }}
          getItemLayout={(_, i) => ({
            length: pageWidth,
            offset: pageWidth * i,
            index: i,
          })}
          initialScrollIndex={loopEnabled ? 1 : 0}
          decelerationRate="fast"
          scrollEnabled={loopEnabled}
          bounces={false}
          overScrollMode="never"
        />
      ) : (
        <View style={styles.slidePlaceholder} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginBottom: 8,
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 3,
  },
  slide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    paddingTop: 16,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapPlain: {
    backgroundColor: 'transparent',
  },
  body: { flex: 1, minWidth: 0, paddingRight: 8 },
  title: { fontSize: 13, fontWeight: '800', color: '#111827' },
  subtitle: { marginTop: 2, fontSize: 11, color: '#64748b', fontWeight: '400', lineHeight: 16 },
  slidePlaceholder: { height: 64 },
  dots: {
    position: 'absolute',
    top: 8,
    right: 12,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#c7d2fe',
  },
  dotActive: {
    backgroundColor: '#667eea',
    width: 14,
  },
});
