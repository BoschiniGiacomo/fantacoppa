import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveDisplayMediaUri, resolveDisplayMediaUriSync } from '../utils/resolveDisplayMediaUri';

function isRemoteUri(uri) {
  return !!uri && /^https?:\/\//i.test(String(uri));
}

function isLocalUri(uri) {
  return !!uri && /^(file:|asset:|content:)/i.test(String(uri));
}

/**
 * Logo squadra / foto giocatore: bundle/memory sync al primo frame, poi cache disco / rete.
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
  const loadedOkRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadedOkRef.current = false;
    setFailed(false);
    const immediate = resolveDisplayMediaUriSync(fields).uri;
    if (immediate) setUri(immediate);
    else setUri(null);

    (async () => {
      const { uri: resolved } = await resolveDisplayMediaUri(fields);
      if (cancelled || !resolved) return;
      setUri((prev) => {
        // Evita reload tardivo remote→file se l'immagine remota è già a schermo.
        if (
          loadedOkRef.current
          && prev
          && isRemoteUri(prev)
          && isLocalUri(resolved)
          && prev !== resolved
        ) {
          return prev;
        }
        return resolved;
      });
      setFailed(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [fields]);

  useEffect(() => {
    if (syncUri) {
      loadedOkRef.current = false;
      setFailed(false);
      setUri(syncUri);
    }
  }, [syncUri]);

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
      onLoad={() => {
        loadedOkRef.current = true;
      }}
      onError={(e) => {
        loadedOkRef.current = false;
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
