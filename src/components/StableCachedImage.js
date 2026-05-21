import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveDisplayMediaUri } from '../utils/resolveDisplayMediaUri';

/**
 * Logo squadra / foto giocatore con cache disco (path Supabase stabile).
 */
export default function StableCachedImage({
  logoUrl,
  logoPath,
  photoPath,
  teamLogo,
  asset = 'team_logo',
  style,
  fallbackStyle,
  fallbackIcon = 'shield-outline',
  fallbackIconSize = 17,
  fallbackColor = '#667eea',
  resizeMode = 'contain',
  onError,
}) {
  const [uri, setUri] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      const { uri: resolved } = await resolveDisplayMediaUri({
        logoUrl,
        logoPath,
        photoPath,
        teamLogo,
        asset,
      });
      if (!cancelled) setUri(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [logoUrl, logoPath, photoPath, teamLogo, asset]);

  if (!uri || failed) {
    if (fallbackStyle) {
      return (
        <View style={fallbackStyle}>
          <Ionicons name={fallbackIcon} size={fallbackIconSize} color={fallbackColor} />
        </View>
      );
    }
    return null;
  }

  return (
    <Image
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      onError={(e) => {
        setFailed(true);
        onError?.(e);
      }}
    />
  );
}

/** Logo squadra ufficiale / tabellone / partite */
export function TeamLogoImage(props) {
  return <StableCachedImage asset="team_logo" {...props} />;
}

/** Logo squadra fantasy (user_budget.team_logo) */
export function FantasyTeamLogoImage(props) {
  return <StableCachedImage asset="fantasy_team_logo" {...props} />;
}

/** Foto giocatore */
export function PlayerPhotoImage(props) {
  return <StableCachedImage asset="player_photo" fallbackIcon="person-outline" {...props} />;
}
