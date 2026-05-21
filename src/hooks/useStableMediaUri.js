import { useEffect, useState } from 'react';
import { resolveDisplayMediaUri } from '../utils/resolveDisplayMediaUri';

/**
 * Hook per sostituire publicAssetUrl(photo_path) con URI da cache disco.
 */
export function useStableMediaUri(fields, asset = 'player_photo') {
  const { logoUrl, logoPath, photoPath, teamLogo } = fields || {};
  const [uri, setUri] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = photoPath || logoPath || teamLogo || logoUrl;
      if (!raw || String(raw).startsWith('default_')) {
        if (!cancelled) setUri(null);
        return;
      }
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

  return uri;
}
