import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

/**
 * Targa stadio: solo placca grigia con bulloni, senza barra nera sotto.
 */
export default function StadiumPlaque({
  value,
  onChangeText,
  onFocus,
  onSubmitEditing,
  inputRef,
  error,
  returnKeyType = 'next',
}) {
  return (
    <View style={styles.outer}>
      <View style={[styles.plaque, error && styles.plaqueError]}>
        <View style={styles.boltTL} />
        <View style={styles.boltTR} />
        <View style={styles.boltBL} />
        <View style={styles.boltBR} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Nome lega"
          placeholderTextColor="#94a3b8"
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          selectionColor="#667eea"
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const bolt = {
  position: 'absolute',
  width: 9,
  height: 9,
  borderRadius: 5,
  backgroundColor: '#cbd5e1',
  borderWidth: 1,
  borderColor: '#94a3b8',
  zIndex: 2,
};

const styles = StyleSheet.create({
  outer: {
    marginBottom: 14,
  },
  plaque: {
    backgroundColor: '#e8eef5',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#94a3b8',
    overflow: 'hidden',
    paddingVertical: 16,
    shadowColor: '#64748b',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  plaqueError: {
    borderColor: '#f87171',
  },
  boltTL: { ...bolt, top: 8, left: 8 },
  boltTR: { ...bolt, top: 8, right: 8 },
  boltBL: { ...bolt, bottom: 8, left: 8 },
  boltBR: { ...bolt, bottom: 8, right: 8 },
  input: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    paddingHorizontal: 28,
    paddingVertical: 8,
    textAlign: 'center',
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
});
