/**
 * Tema centralizzato FantaCoppa
 * Usa queste costanti invece di hardcodare colori/dimensioni negli screen.
 */

export const colors = {
  // Brand
  primary: '#667eea',
  primaryLight: '#8b9cf7',
  primaryDark: '#4a5ecc',

  // Semantici
  success: '#198754',
  successLight: '#d1e7dd',
  error: '#dc3545',
  errorLight: '#f8d7da',
  warning: '#ffc107',
  warningLight: '#fff3cd',
  info: '#0dcaf0',
  infoLight: '#e3f2fd',

  // Neutri
  background: '#f5f5f5',
  surface: '#ffffff',
  border: '#e0e0e0',
  borderLight: '#f0f0f0',
  divider: '#ddd',

  // Testo
  text: '#333333',
  textSecondary: '#666666',
  textMuted: '#999999',
  textPlaceholder: '#999999',
  textInverse: '#ffffff',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.5)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const borderRadius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 20,
  full: 28,
};

export const fontSize = {
  xs: 11,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 20,
  title: 24,
};

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: 'bold',
};

export const shadow = {
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
};

export default {
  colors,
  spacing,
  borderRadius,
  fontSize,
  fontWeight,
  shadow,
};
