import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { leagueService } from '../services/api';
import {
  clearPendingLeagueInviteToken,
  savePendingLeagueInviteToken,
} from '../utils/pendingLeagueInvite';
import { useAuth } from '../context/AuthContext';

export default function InviteJoinScreen({ route, navigation }) {
  const { token: routeToken } = route.params || {};
  const token = String(routeToken || '').trim();
  const { user } = useAuth();
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('Ingresso in corso…');
  const [leagueId, setLeagueId] = useState(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const run = async () => {
      if (!token) {
        setStatus('error');
        setMessage('Link di invito non valido.');
        return;
      }

      if (!user) {
        try {
          await savePendingLeagueInviteToken(token);
        } catch (_) {}
        setStatus('error');
        setMessage('Accedi o registrati per entrare nella lega.');
        return;
      }

      try {
        const res = await leagueService.redeemInvite(token);
        await clearPendingLeagueInviteToken();
        const id = Number(res?.data?.leagueId || 0);
        setLeagueId(id > 0 ? id : null);
        setStatus('success');
        setMessage(
          res?.data?.already_member
            ? 'Sei già in questa lega.'
            : (res?.data?.message || 'Iscrizione completata.')
        );
        if (id > 0) {
          setTimeout(() => {
            navigation.replace('League', { leagueId: id });
          }, 600);
        }
      } catch (e) {
        setStatus('error');
        setMessage(
          e?.response?.data?.message || e?.message || 'Invito non valido o scaduto.'
        );
      }
    };

    run();
  }, [token, user, navigation]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          {status === 'loading' ? (
            <ActivityIndicator size="large" color="#667eea" />
          ) : (
            <Ionicons
              name={status === 'success' ? 'checkmark-circle' : 'alert-circle'}
              size={40}
              color={status === 'success' ? '#16a34a' : '#dc2626'}
            />
          )}
        </View>
        <Text style={styles.title}>
          {status === 'loading' ? 'Invito lega' : status === 'success' ? 'Fatto' : 'Invito'}
        </Text>
        <Text style={styles.message}>{message}</Text>

        {status === 'error' ? (
          <View style={styles.actions}>
            {!user ? (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => navigation.navigate('Login')}
              >
                <Text style={styles.primaryBtnText}>Accedi</Text>
              </TouchableOpacity>
            ) : null}
            {leagueId ? (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => navigation.replace('League', { leagueId })}
              >
                <Text style={styles.primaryBtnText}>Apri lega</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                if (navigation.canGoBack()) navigation.goBack();
                else navigation.navigate(user ? 'MainTabs' : 'Login');
              }}
            >
              <Text style={styles.secondaryBtnText}>Chiudi</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f4f6fb',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8eaf1',
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  message: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    width: '100%',
    gap: 8,
    marginTop: 10,
  },
  primaryBtn: {
    backgroundColor: '#667eea',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
  },
  secondaryBtnText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 14,
  },
});
