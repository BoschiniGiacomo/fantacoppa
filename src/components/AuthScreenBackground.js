import React, { useState } from 'react';
import { View, ImageBackground, StyleSheet } from 'react-native';
import { useAuthBranding } from '../context/AuthBrandingContext';

export default function AuthScreenBackground({ children, style }) {
  const { background } = useAuthBranding();
  const [uriFailed, setUriFailed] = useState(null);

  const uri = background?.uri && background.uri !== uriFailed ? background.uri : null;

  if (uri) {
    return (
      <ImageBackground
        source={{ uri }}
        style={[styles.container, style]}
        resizeMode="cover"
        onError={() => setUriFailed(uri)}
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
