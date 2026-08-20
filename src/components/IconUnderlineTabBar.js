import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

export const ICON_TAB_ACTIVE = '#667eea';
export const ICON_TAB_IDLE = '#94a3b8';

/**
 * Tab bar solo icone con underline full-width sul selezionato.
 * tabs: [{ key, label, pack: 'ion'|'mci', icon, iconActive }]
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
            <IconComp name={iconName} size={22} color={color} />
            <View style={[styles.underline, active && styles.underlineActive]} />
          </TouchableOpacity>
        );
      })}
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
});
