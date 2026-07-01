import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { OfficialGroupLogoImage } from './StableCachedImage';
import { getMenuOfficialGroup } from '../utils/menuOfficialGroupSettings';

const ACTIVE = '#667eea';
const INACTIVE = '#9aa3b2';

export default function MainTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const [menuGroup, setMenuGroup] = useState(null);

  const loadMenuGroup = useCallback(() => {
    getMenuOfficialGroup().then(setMenuGroup);
  }, []);

  useEffect(() => {
    loadMenuGroup();
    const parent = navigation.getParent?.();
    if (!parent) return undefined;
    const unsub = parent.addListener('focus', loadMenuGroup);
    return unsub;
  }, [navigation, loadMenuGroup]);

  const goToOfficialGroup = () => {
    if (!menuGroup?.id) return;
    navigation.getParent()?.navigate('OfficialGroupDetail', {
      competitionId: menuGroup.id,
      groupName: menuGroup.name,
    });
  };

  const renderTab = (route, index) => {
    const { options } = descriptors[route.key];
    const isFocused = state.index === index;
    const color = isFocused ? ACTIVE : INACTIVE;
    const label = route.name === 'Dashboard' ? 'Home' : route.name;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.params);
      }
    };

    let icon = null;
    if (route.name === 'Partite') {
      icon = <MaterialCommunityIcons name="soccer-field" size={24} color={color} />;
    } else if (route.name === 'Dashboard') {
      icon = <Ionicons name={isFocused ? 'home' : 'home-outline'} size={24} color={color} />;
    } else if (route.name === 'Leghe') {
      icon = <Ionicons name={isFocused ? 'trophy' : 'trophy-outline'} size={24} color={color} />;
    } else if (route.name === 'Profilo') {
      icon = <Ionicons name={isFocused ? 'person' : 'person-outline'} size={24} color={color} />;
    }

    return (
      <TouchableOpacity
        key={route.key}
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        onPress={onPress}
        activeOpacity={0.7}
        style={styles.tabItem}
      >
        {icon}
        <Text style={[styles.tabLabel, { color }]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 6),
        },
      ]}
    >
      <View style={styles.row}>
        {state.routes.map((route, index) => (
          <React.Fragment key={route.key}>
            {index === 2 && menuGroup ? (
              <View style={styles.centerSlot}>
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={goToOfficialGroup}
                  accessibilityRole="button"
                  accessibilityLabel={`Gruppo ufficiale ${menuGroup.name}`}
                  style={styles.floatingButton}
                >
                  <View style={styles.floatingButtonInner}>
                    <OfficialGroupLogoImage
                      logoPath={menuGroup.logo_path}
                      style={styles.floatingLogo}
                      fallbackStyle={styles.floatingLogoFallback}
                      fallbackIcon="ribbon-outline"
                      fallbackIconSize={22}
                      fallbackColor={ACTIVE}
                    />
                  </View>
                </TouchableOpacity>
              </View>
            ) : null}
            {renderTab(route, index)}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e6eaf2',
    paddingTop: 6,
    shadowColor: '#1a2b4a',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: 50,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: 2,
  },
  tabLabel: {
    fontSize: 10,
    marginTop: 4,
    fontWeight: '500',
  },
  centerSlot: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 2,
  },
  floatingButton: {
    position: 'absolute',
    top: -24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 12,
  },
  floatingButtonInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: '#eef1f8',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#fafbfe',
  },
  floatingLogo: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  floatingLogoFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f0f3fa',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
