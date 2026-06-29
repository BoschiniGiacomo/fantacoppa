import React, { useEffect, useMemo, useState } from 'react';
import { Image, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveDisplayMediaUri, resolveDisplayMediaUriSync } from '../utils/resolveDisplayMediaUri';

/**
 * Logo squadra / foto giocatore: bundle sincrono al primo frame, poi cache disco / rete.
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
  const fields = useMemo(
    () => ({ logoUrl, logoPath, photoPath, teamLogo, asset }),
    [logoUrl, logoPath, photoPath, teamLogo, asset]
  );

  const syncUri = useMemo(
    () => resolveDisplayMediaUriSync(fields).uri,
    [fields]
  );

  const [uri, setUri] = useState(syncUri);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const immediate = resolveDisplayMediaUriSync(fields).uri;
    if (immediate) setUri(immediate);

    (async () => {
      const { uri: resolved } = await resolveDisplayMediaUri(fields);
      if (!cancelled && resolved) setUri(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [fields]);

  const showFallback = !uri || failed;

  if (showFallback) {
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

/** Logo gruppo ufficiale (campionato). */
export function OfficialGroupLogoImage(props) {
  return <StableCachedImage asset="official_group_logo" {...props} />;
}

/** Logo squadra fantasy (user_budget.team_logo) */
export function FantasyTeamLogoImage(props) {
  return <StableCachedImage asset="fantasy_team_logo" {...props} />;
}

/** Foto giocatore */
export function PlayerPhotoImage(props) {
  return <StableCachedImage asset="player_photo" fallbackIcon="person-outline" {...props} />;
}
