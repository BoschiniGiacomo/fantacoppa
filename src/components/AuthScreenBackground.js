import React from 'react';
import { View, ImageBackground, StyleSheet } from 'react-native';
import { useAuthBranding } from '../context/AuthBrandingContext';

export default function AuthScreenBackground({ children, style }) {
  const { background } = useAuthBranding();

  if (background?.uri) {
    return (
      <ImageBackground
        source={{ uri: background.uri }}
        style={[styles.container, style]}
        resizeMode="cover"
      >
        {children}
      </ImageBackground>
    );
  }

  return <View style={[styles.container, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
});
