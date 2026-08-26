import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_LEAGUE_INVITE_KEY = 'pending_league_invite_token';

export async function savePendingLeagueInviteToken(token) {
  const clean = String(token || '').trim();
  if (!clean) return;
  await AsyncStorage.setItem(PENDING_LEAGUE_INVITE_KEY, clean);
}

export async function peekPendingLeagueInviteToken() {
  const raw = await AsyncStorage.getItem(PENDING_LEAGUE_INVITE_KEY);
  const clean = String(raw || '').trim();
  return clean || null;
}

export async function clearPendingLeagueInviteToken() {
  await AsyncStorage.removeItem(PENDING_LEAGUE_INVITE_KEY);
}

export async function consumePendingLeagueInviteToken() {
  const token = await peekPendingLeagueInviteToken();
  if (token) await clearPendingLeagueInviteToken();
  return token;
}
