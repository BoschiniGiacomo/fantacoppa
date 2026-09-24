import React, { useEffect, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Line } from 'react-native-svg';

/**
 * Ingresso lega: due porte (Aperta / Con codice).
 * Pattern Pubblico–Privato (fantasy + radio/segmented), non switch ambiguo.
 */
export function AccessKeycard({
  enabled,
  onToggle,
  code,
  onChangeCode,
  onFocus,
  onSubmitEditing,
  inputRef,
  error,
}) {
  return (
    <View style={styles.gate}>
      <View style={styles.segment}>
        <TouchableOpacity
          style={[styles.segBtn, !enabled && styles.segBtnOn]}
          onPress={() => onToggle(false)}
          activeOpacity={0.85}
        >
          <View style={[styles.iconBubble, !enabled && styles.iconBubbleOpen]}>
            <Ionicons name="lock-open-outline" size={20} color={!enabled ? '#166534' : '#94a3b8'} />
          </View>
          <Text style={[styles.segTitle, !enabled && styles.segTitleOn]}>Aperta</Text>
          <Text style={[styles.segSub, !enabled && styles.segSubOn]}>Chiunque entra</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segBtn, enabled && styles.segBtnOnLocked]}
          onPress={() => onToggle(true)}
          activeOpacity={0.85}
        >
          <View style={[styles.iconBubble, enabled && styles.iconBubbleLocked]}>
            <Ionicons name="lock-closed" size={20} color={enabled ? '#1e3a8a' : '#94a3b8'} />
          </View>
          <Text style={[styles.segTitle, enabled && styles.segTitleOnLocked]}>Con codice</Text>
          <Text style={[styles.segSub, enabled && styles.segSubOnLocked]}>Solo chi lo sa</Text>
        </TouchableOpacity>
      </View>

      {enabled ? (
        <View style={[styles.codeSlot, error && styles.codeSlotError]}>
          <Ionicons name="key-outline" size={18} color="#667eea" />
          <TextInput
            ref={inputRef}
            style={styles.codeInput}
            placeholder="Scrivi il codice"
            placeholderTextColor="#94a3b8"
            value={code}
            onChangeText={onChangeCode}
            onFocus={onFocus}
            onSubmitEditing={onSubmitEditing}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            selectionColor="#667eea"
          />
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/**
 * Tornello stadio: senza steward vs con steward (approvazione).
 */
export function ApprovalClipboard({ enabled, onToggle }) {
  const mode = useRef(new Animated.Value(enabled ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(mode, {
      toValue: enabled ? 1 : 0,
      friction: 8,
      tension: 110,
      useNativeDriver: true,
    }).start();
  }, [enabled, mode]);

  const armRotate = mode.interpolate({
    inputRange: [0, 1],
    outputRange: ['35deg', '0deg'],
  });
  const emptyFade = mode.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const guardFade = mode;
  const armColor = '#334155';

  const renderTurnstile = (size = 64) => (
    <Animated.View style={{ transform: [{ rotate: armRotate }] }}>
      <Svg width={size} height={size} viewBox="0 0 96 96">
        <Line
          x1="48" y1="48" x2="48" y2="10"
          stroke={armColor} strokeWidth="9" strokeLinecap="round"
        />
        <Line
          x1="48" y1="48" x2="81" y2="67"
          stroke={armColor} strokeWidth="9" strokeLinecap="round"
        />
        <Line
          x1="48" y1="48" x2="15" y2="67"
          stroke={armColor} strokeWidth="9" strokeLinecap="round"
        />
        <Circle cx="48" cy="48" r="11" fill="#1e293b" stroke="#64748b" strokeWidth="2" />
        <Circle cx="48" cy="48" r="4.5" fill="#e2e8f0" />
      </Svg>
    </Animated.View>
  );

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => onToggle(!enabled)}
      style={styles.tsWrap}
    >
      <View
        style={[
          styles.tsCard,
          enabled ? styles.tsCardWait : styles.tsCardOpen,
        ]}
      >
        <View style={styles.tsStage}>
          <View style={[styles.tsFloor, enabled ? styles.tsFloorWait : styles.tsFloorOpen]} />

          {/* Solo i tornelli animano; nessuna barra sotto la persona */}
          <View style={styles.tsLane}>
            <View style={styles.tsRail} />
            {renderTurnstile(64)}
            <View style={styles.tsRail} />
            {renderTurnstile(64)}
            <View style={styles.tsRail} />
            {renderTurnstile(64)}
          </View>

          <View style={styles.tsControlSlot}>
            <View style={[styles.tsEmptyBooth, { opacity: enabled ? 0 : 1 }]} pointerEvents="none">
              <View style={styles.tsEmptyOutline}>
                <Ionicons name="person-outline" size={26} color="#dbe3ec" />
              </View>
            </View>

            <View style={[styles.tsGuard, { opacity: enabled ? 1 : 0 }]} pointerEvents="none">
              <View style={styles.tsGuardBody}>
                <Ionicons name="person" size={22} color="#9a3412" />
                <View style={styles.tsGuardBadge}>
                  <Ionicons name="shield-checkmark" size={11} color="#fff" />
                </View>
              </View>
              <View style={styles.tsClipboard}>
                <View style={styles.tsClipMetal} />
                <View style={styles.tsClipPaper}>
                  <View style={styles.tsClipLine} />
                  <View style={[styles.tsClipLine, styles.tsClipLineShort]} />
                  <View style={styles.tsClipLine} />
                </View>
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.tsPlaque, enabled ? styles.tsPlaqueWait : styles.tsPlaqueOpen]}>
          <Text style={[styles.tsTitle, enabled && styles.tsTitleWait]}>
            {enabled ? 'Con approvazione' : 'Senza approvazione'}
          </Text>
          <Text style={[styles.tsSub, enabled && styles.tsSubWait]}>
            {enabled ? 'Un admin decide chi entra' : 'Chiunque entra subito'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  gate: {
    marginBottom: 14,
  },
  segment: {
    flexDirection: 'row',
    gap: 10,
  },
  segBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  segBtnOn: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  segBtnOnLocked: {
    borderColor: '#a5b4fc',
    backgroundColor: '#eef2ff',
  },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  iconBubbleOpen: {
    backgroundColor: '#dcfce7',
  },
  iconBubbleLocked: {
    backgroundColor: '#e0e7ff',
  },
  segTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#94a3b8',
    marginBottom: 2,
  },
  segTitleOn: {
    color: '#166534',
  },
  segTitleOnLocked: {
    color: '#312e81',
  },
  segSub: {
    fontSize: 11,
    fontWeight: '500',
    color: '#cbd5e1',
    textAlign: 'center',
  },
  segSubOn: {
    color: '#4ade80',
  },
  segSubOnLocked: {
    color: '#818cf8',
  },
  tsWrap: {
    marginBottom: 14,
  },
  tsCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
    shadowColor: '#64748b',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  tsCardOpen: {
    borderColor: '#86efac',
  },
  tsCardWait: {
    borderColor: '#fdba74',
  },
  tsStage: {
    height: 118,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  tsFloor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 16,
    opacity: 0.3,
  },
  tsFloorOpen: {
    backgroundColor: '#86efac',
  },
  tsFloorWait: {
    backgroundColor: '#fdba74',
  },
  tsLane: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    height: '100%',
    marginRight: 8,
  },
  tsRail: {
    width: 5,
    height: '78%',
    borderRadius: 2.5,
    backgroundColor: '#94a3b8',
    borderWidth: 1,
    borderColor: '#64748b',
  },
  tsControlSlot: {
    width: 56,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  tsEmptyBooth: {
    position: 'absolute',
    alignItems: 'center',
  },
  tsEmptyOutline: {
    width: 48,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248,250,252,0.7)',
  },
  tsGuard: {
    position: 'absolute',
    alignItems: 'center',
    width: 56,
  },
  tsGuardBody: {
    width: 48,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#ffedd5',
    borderWidth: 1.5,
    borderColor: '#fdba74',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tsGuardBadge: {
    position: 'absolute',
    right: -5,
    top: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ea580c',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  tsClipboard: {
    position: 'absolute',
    right: -6,
    top: 22,
    alignItems: 'center',
  },
  tsClipMetal: {
    width: 14,
    height: 5,
    borderRadius: 1,
    backgroundColor: '#94a3b8',
    marginBottom: -2,
    zIndex: 1,
  },
  tsClipPaper: {
    width: 20,
    height: 26,
    borderRadius: 2,
    backgroundColor: '#fffef8',
    borderWidth: 1,
    borderColor: '#d6d3d1',
    padding: 3,
    gap: 3,
    justifyContent: 'center',
  },
  tsClipLine: {
    height: 2,
    backgroundColor: '#a8a29e',
    borderRadius: 1,
  },
  tsClipLineShort: {
    width: '55%',
  },
  tsPlaque: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 12,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  tsPlaqueOpen: {
    backgroundColor: '#f0fdf4',
  },
  tsPlaqueWait: {
    backgroundColor: '#fff7ed',
  },
  tsTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#166534',
    marginBottom: 2,
  },
  tsTitleWait: {
    color: '#9a3412',
  },
  tsSub: {
    fontSize: 12,
    fontWeight: '500',
    color: '#16a34a',
  },
  tsSubWait: {
    color: '#ea580c',
  },
  codeSlot: {
    marginTop: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#c7d2fe',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  codeSlotError: {
    borderColor: '#f87171',
  },
  codeInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: 1,
    paddingVertical: 2,
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
});
