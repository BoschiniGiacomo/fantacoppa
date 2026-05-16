import React, { useEffect, useState } from 'react';
import { View, ImageBackground, StyleSheet } from 'react-native';
import { getLoginBackgroundSettings } from '../utils/loginBackgroundSettings';

export default function AuthScreenBackground({ children, style }) {
  const [loginBackground, setLoginBackground] = useState(null);

  useEffect(() => {
    getLoginBackgroundSettings().then(setLoginBackground);
  }, []);

  if (loginBackground?.uri) {
    return (
      <ImageBackground
        source={{ uri: loginBackground.uri }}
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
