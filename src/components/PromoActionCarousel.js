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
 * Carosello CTA estendibile: auto-rotate + swipe orizzontale.
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

  const items = useMemo(
    () => (Array.isArray(slides) ? slides.filter((s) => s && s.id && s.title && typeof s.onPress === 'function') : []),
    [slides],
  );

  const pageWidth = trackWidth > 0 ? trackWidth : Math.max(0, windowWidth - 24);

  const goTo = useCallback((nextIndex, animated = true) => {
    if (!items.length || pageWidth <= 0) return;
    const clamped = ((nextIndex % items.length) + items.length) % items.length;
    indexRef.current = clamped;
    setIndex(clamped);
    try {
      listRef.current?.scrollToOffset({ offset: clamped * pageWidth, animated });
    } catch (_) {}
  }, [items.length, pageWidth]);

  const pauseAuto = useCallback(() => {
    pausedUntilRef.current = Date.now() + RESUME_AFTER_TOUCH_MS;
  }, []);

  useEffect(() => {
    indexRef.current = 0;
    setIndex(0);
    if (pageWidth > 0 && items.length) {
      try {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      } catch (_) {}
    }
  }, [items.length, pageWidth]);

  useEffect(() => {
    if (items.length < 2) return undefined;
    const timer = setInterval(() => {
      if (userTouchingRef.current) return;
      if (Date.now() < pausedUntilRef.current) return;
      goTo(indexRef.current + 1, true);
    }, Math.max(4000, Number(autoIntervalMs) || AUTO_MS));
    return () => clearInterval(timer);
  }, [items.length, autoIntervalMs, goTo]);

  const onMomentumEnd = useCallback((e) => {
    if (pageWidth <= 0) return;
    const x = e?.nativeEvent?.contentOffset?.x || 0;
    const next = Math.round(x / pageWidth);
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    indexRef.current = clamped;
    setIndex(clamped);
  }, [pageWidth, items.length]);

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
      {items.length > 1 && pageWidth > 0 ? (
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
          data={items}
          keyExtractor={(item) => String(item.id)}
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
          decelerationRate="fast"
          scrollEnabled={items.length > 1}
          bounces={items.length > 1}
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
