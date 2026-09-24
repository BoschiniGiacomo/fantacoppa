import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/** Atmosfere chiare: l’oggetto racconta, non il testo. */
const SCENE = {
  1: {
    title: 'La tua lega',
    subtitle: 'Nome, accesso e budget.',
    bg: '#f3f6fb',
    accent: '#667eea',
  },
  2: {
    title: 'La rosa',
    subtitle: 'Chi vestirà la maglia.',
    bg: '#f7f4ef',
    accent: '#0d9488',
  },
  3: {
    title: 'Le regole',
    subtitle: 'Come si assegnano i punti.',
    bg: '#faf7f0',
    accent: '#ca8a04',
  },
  4: {
    title: 'Tutto pronto',
    subtitle: 'Un’occhiata prima del fischio.',
    bg: '#f1f7f3',
    accent: '#16a34a',
  },
};

export function SceneChapter({ step }) {
  const s = SCENE[step] || SCENE[1];
  return (
    <View style={styles.chapter}>
      <Text style={styles.chapterTitle}>{s.title}</Text>
      <Text style={styles.chapterSub}>{s.subtitle}</Text>
      <View style={[styles.chapterRule, { backgroundColor: s.accent }]} />
    </View>
  );
}

export function getSceneMeta(step) {
  return SCENE[step] || SCENE[1];
}

const styles = StyleSheet.create({
  chapter: {
    marginBottom: 16,
  },
  chapterTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  chapterSub: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 10,
  },
  chapterRule: {
    height: 3,
    width: 40,
    borderRadius: 2,
  },
});
