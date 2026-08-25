import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export const ICON_TAB_ACTIVE = '#667eea';
export const ICON_TAB_IDLE = '#94a3b8';

/** Silhouette template (nero su trasparente) — sostituibile in assets/. */
const FANTA_TAB_ICON = require('../../assets/fantacoppa-tab-icon.png');

/**
 * Tab bar solo icone con underline full-width sul selezionato.
 * tabs: [{ key, label, pack?, icon?, iconActive?, renderIcon?(active, color) }]
 */
export default function IconUnderlineTabBar({ tabs, activeKey, onSelect, style }) {
  const list = Array.isArray(tabs) ? tabs : [];
  return (
    <View style={[styles.bar, style]}>
      {list.map((tab) => {
        const active = activeKey === tab.key;
        const color = active ? ICON_TAB_ACTIVE : ICON_TAB_IDLE;
        const iconName = active ? (tab.iconActive || tab.icon) : tab.icon;
        const IconComp = tab.pack === 'mci' ? MaterialCommunityIcons : Ionicons;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.btn}
            onPress={() => onSelect?.(tab.key)}
            activeOpacity={0.75}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
          >
            <View style={styles.iconSlot}>
              {typeof tab.renderIcon === 'function' ? (
                tab.renderIcon(active, color)
              ) : (
                <IconComp name={iconName} size={22} color={color} />
              )}
            </View>
            <View style={[styles.underline, active && styles.underlineActive]} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * Icona tab FantaCoppa da assets/fantacoppa-tab-icon.png
 * (nero su trasparente → tint grigio / indigo).
 */
export function FantaCoppaTabIcon({ active = false }) {
  const tint = active ? ICON_TAB_ACTIVE : ICON_TAB_IDLE;
  return (
    <View style={styles.fcLogoWrap}>
      <Image
        source={FANTA_TAB_ICON}
        style={[styles.fcLogo, { tintColor: tint }]}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#fff',
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 8,
    paddingBottom: 0,
  },
  iconSlot: {
    height: 28,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  underline: {
    marginTop: 6,
    height: 3,
    alignSelf: 'stretch',
    width: '100%',
    backgroundColor: 'transparent',
  },
  underlineActive: {
    backgroundColor: ICON_TAB_ACTIVE,
  },
  fcLogoWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fcLogo: {
    width: 28,
    height: 28,
    transform: [{ scale: 1.08 }],
  },
});
