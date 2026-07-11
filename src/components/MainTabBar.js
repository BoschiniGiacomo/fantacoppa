import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { OfficialGroupLogoImage } from './StableCachedImage';
import { getMenuOfficialGroup } from '../utils/menuOfficialGroupSettings';

const ACTIVE = '#667eea';
const INACTIVE = 'gray';

export default function MainTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const [menuGroup, setMenuGroup] = useState(null);
  const bottomInset = insets.bottom;

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
    const activeColor = options.tabBarActiveTintColor ?? ACTIVE;
    const inactiveColor = options.tabBarInactiveTintColor ?? INACTIVE;
    const color = isFocused ? activeColor : inactiveColor;
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
    <View style={styles.wrapper} pointerEvents="box-none">
      {menuGroup ? (
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={goToOfficialGroup}
          accessibilityRole="button"
          accessibilityLabel={`Gruppo ufficiale ${menuGroup.name}`}
          style={[
            styles.floatingButton,
            { bottom: bottomInset + 5 },
          ]}
        >
          <View style={styles.floatingButtonInner}>
            <OfficialGroupLogoImage
              logoPath={menuGroup.logo_path}
              style={styles.floatingLogo}
              fallbackStyle={styles.floatingLogoFallback}
              fallbackIcon="ribbon-outline"
              fallbackIconSize={26}
              fallbackColor={ACTIVE}
            />
          </View>
        </TouchableOpacity>
      ) : null}

      <View
        style={[
          styles.container,
          { paddingBottom: bottomInset },
        ]}
      >
        <View style={styles.row}>
          {state.routes.map((route, index) => (
            <React.Fragment key={route.key}>
              {index === 2 && menuGroup ? <View style={styles.centerSpacer} /> : null}
              {renderTab(route, index)}
            </React.Fragment>
          ))}
        </View>
      </View>
    </View>
  );
}

const FLOATING_SIZE = 70;

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    overflow: 'visible',
  },
  container: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 8,
    minHeight: 60,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10,
    marginTop: 4,
  },
  centerSpacer: {
    width: 76,
  },
  floatingButton: {
    position: 'absolute',
    alignSelf: 'center',
    width: FLOATING_SIZE,
    height: FLOATING_SIZE,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 12,
  },
  floatingButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 0,
    borderWidth: 2,
    borderColor: '#eef1f8',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#fafbfe',
  },
  floatingLogo: {
    width: 54,
    height: 54,
    borderRadius: 0,
  },
  floatingLogoFallback: {
    width: 48,
    height: 48,
    borderRadius: 0,
    backgroundColor: '#f0f3fa',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
