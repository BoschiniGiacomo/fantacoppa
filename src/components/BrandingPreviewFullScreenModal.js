import React from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  ImageBackground,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MatchHeroBackgroundOverlay from './MatchHeroBackgroundOverlay';

/**
 * Anteprima a tutto schermo per branding Super User.
 * - login: pagina login con sfondo (+ logo opzionale)
 * - match: hero partita con proporzioni reali + zona contenuto sotto
 */
export default function BrandingPreviewFullScreenModal({
  visible,
  mode = 'login', // 'login' | 'match'
  backgroundUri = null,
  logoUri = null,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  const hasBg = Boolean(backgroundUri);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined}
      onRequestClose={onClose}
    >
      <View style={styles.wrap}>
        {mode === 'login' ? (
          <LoginPreview
            backgroundUri={backgroundUri}
            logoUri={logoUri}
            insets={insets}
          />
        ) : (
          <MatchPreview backgroundUri={backgroundUri} insets={insets} hasBg={hasBg} />
        )}

        <TouchableOpacity
          accessibilityLabel="Chiudi anteprima"
          onPress={onClose}
          style={[styles.closeBtn, { top: Math.max(insets.top, 10) + 6, right: 14 }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.closeInner}>
            <Ionicons name="close" size={26} color="#fff" />
          </View>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function LoginPreview({ backgroundUri, logoUri, insets }) {
  const Shell = backgroundUri ? ImageBackground : View;
  const shellProps = backgroundUri
    ? {
        source: { uri: backgroundUri },
        resizeMode: 'cover',
      }
    : {};

  return (
    <Shell style={[styles.loginRoot, !backgroundUri && styles.loginRootDefault]} {...shellProps}>
      <View
        style={[
          styles.loginContent,
          { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={styles.loginHeader}>
          {logoUri ? (
            <Image source={{ uri: logoUri }} style={styles.loginLogo} resizeMode="contain" />
          ) : (
            <View style={styles.loginLogoFallback}>
              <Ionicons name="football" size={36} color="#2c3e50" />
              <Text style={styles.loginLogoBig}>FANTA</Text>
              <View style={styles.loginCoppaRow}>
                <Text style={styles.loginLogoBig}>CO</Text>
                <Text style={[styles.loginLogoBig, { transform: [{ scaleX: -1 }] }]}>P</Text>
                <Text style={styles.loginLogoBig}>PA</Text>
              </View>
              <Text style={styles.loginLogoMonte}>MONTECAVOLO</Text>
            </View>
          )}
        </View>

        <View style={styles.loginForm}>
          <View style={styles.loginInput}>
            <Ionicons name="person-outline" size={20} color="#666" />
            <Text style={styles.loginInputPlaceholder}>Username o email</Text>
          </View>
          <View style={styles.loginInput}>
            <Ionicons name="lock-closed-outline" size={20} color="#666" />
            <Text style={styles.loginInputPlaceholder}>Password</Text>
          </View>
          <View style={styles.loginButton}>
            <Text style={styles.loginButtonText}>Accedi</Text>
          </View>
          <Text style={styles.loginForgot}>Password dimenticata?</Text>
        </View>

        <Text style={styles.previewBadge}>Anteprima login</Text>
      </View>
    </Shell>
  );
}

function MatchPreview({ backgroundUri, insets, hasBg }) {
  const TopShell = hasBg ? ImageBackground : View;
  const topShellProps = hasBg
    ? {
        source: { uri: backgroundUri },
        resizeMode: 'cover',
        imageStyle: styles.matchHeroBgImage,
      }
    : {};

  return (
    <View style={styles.matchRoot}>
      <TopShell
        style={[styles.matchHeroColumn, hasBg ? styles.matchHeroColumnWithBg : null]}
        {...topShellProps}
      >
        {hasBg ? <MatchHeroBackgroundOverlay /> : null}
        <View style={styles.matchHeroForeground}>
          <View style={[styles.matchHeader, { paddingTop: Math.max(insets.top + 6, 12) }]}>
            <View style={[styles.matchIconBtn, hasBg && styles.matchIconBtnOnBg]}>
              <Ionicons name="arrow-back" size={20} color={hasBg ? '#fff' : '#333'} />
            </View>
            <View style={styles.matchHeaderRight}>
              <View style={[styles.matchIconBtn, hasBg && styles.matchIconBtnOnBg]}>
                <Ionicons name="star" size={20} color="#ffc107" />
              </View>
              <View style={[styles.matchIconBtn, hasBg && styles.matchIconBtnOnBg]}>
                <Ionicons
                  name="notifications-outline"
                  size={20}
                  color={hasBg ? '#fff' : '#667eea'}
                />
              </View>
            </View>
          </View>

          <View style={styles.matchHeroTopRow}>
            <View style={styles.matchTeamSlot}>
              <View style={styles.matchTeamLogo} />
              <Text style={[styles.matchTeamName, hasBg && styles.matchTeamNameOnBg]} numberOfLines={2}>
                Casa
              </Text>
            </View>
            <View style={styles.matchScoreWrap}>
              <Text style={[styles.matchScore, hasBg && styles.matchScoreOnBg]}>1 – 0</Text>
              <Text style={[styles.matchMinute, hasBg && styles.matchMinuteOnBg]}>FT</Text>
            </View>
            <View style={styles.matchTeamSlot}>
              <View style={styles.matchTeamLogo} />
              <Text style={[styles.matchTeamName, hasBg && styles.matchTeamNameOnBg]} numberOfLines={2}>
                Trasferta
              </Text>
            </View>
          </View>
        </View>
        {hasBg ? (
          <View style={styles.matchTabRowOnBg}>
            {['Formazioni', 'Statistiche', 'Eventi'].map((label, idx) => (
              <View
                key={label}
                style={[styles.matchTab, idx === 0 && styles.matchTabActive]}
              >
                <Text style={[styles.matchTabText, idx === 0 && styles.matchTabTextActive]}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </TopShell>

      <View style={styles.matchBody}>
        {hasBg ? null : (
          <View style={styles.matchTabRow}>
            {['Formazioni', 'Statistiche', 'Eventi'].map((label, idx) => (
              <View
                key={label}
                style={[styles.matchTab, idx === 0 && styles.matchTabActive]}
              >
                <Text style={[styles.matchTabText, idx === 0 && styles.matchTabTextActive]}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        )}
        <View style={styles.matchSkeletonCard} />
        <View style={[styles.matchSkeletonCard, { height: 88 }]} />
        <View style={[styles.matchSkeletonCard, { height: 120 }]} />
        <Text style={styles.previewBadgeDark}>Anteprima sfondo partita</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#000',
  },
  closeBtn: {
    position: 'absolute',
    zIndex: 50,
  },
  closeInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },

  // Login
  loginRoot: {
    flex: 1,
  },
  loginRootDefault: {
    backgroundColor: '#f5f5f5',
  },
  loginContent: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  loginHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },
  loginLogo: {
    width: 200,
    height: 120,
  },
  loginLogoFallback: {
    alignItems: 'center',
  },
  loginLogoBig: {
    fontSize: 34,
    fontWeight: '900',
    color: '#2c3e50',
    letterSpacing: 1,
  },
  loginCoppaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loginLogoMonte: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 2,
  },
  loginForm: {
    gap: 12,
  },
  loginInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  loginInputPlaceholder: {
    fontSize: 15,
    color: '#94a3b8',
  },
  loginButton: {
    marginTop: 4,
    backgroundColor: '#667eea',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  loginForgot: {
    marginTop: 8,
    textAlign: 'center',
    color: '#667eea',
    fontWeight: '600',
    fontSize: 14,
  },
  previewBadge: {
    marginTop: 28,
    alignSelf: 'center',
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(15,23,42,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  // Match
  matchRoot: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  matchHeroColumn: {
    width: '100%',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  matchHeroColumnWithBg: {
    backgroundColor: '#0b1220',
  },
  matchHeroBgImage: {
    width: '100%',
    height: '100%',
  },
  matchHeroForeground: {
    zIndex: 1,
  },
  matchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  matchHeaderRight: {
    flexDirection: 'row',
    gap: 8,
  },
  matchIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  matchIconBtnOnBg: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.32)',
  },
  matchHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 22,
    minHeight: 168,
  },
  matchTeamSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minWidth: 0,
  },
  matchTeamLogo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  matchTeamName: {
    fontWeight: '700',
    color: '#222',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 17,
  },
  matchTeamNameOnBg: {
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  matchScoreWrap: {
    alignItems: 'center',
    minWidth: 88,
  },
  matchScore: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
  },
  matchScoreOnBg: {
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  matchMinute: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  matchMinuteOnBg: {
    color: '#fff',
  },
  matchBody: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  matchTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  matchTabRowOnBg: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  matchTab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  matchTabActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  matchTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  matchTabTextActive: {
    color: '#4f46e5',
    fontWeight: '700',
  },
  matchSkeletonCard: {
    height: 64,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ececec',
    marginBottom: 10,
  },
  previewBadgeDark: {
    marginTop: 8,
    alignSelf: 'center',
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
