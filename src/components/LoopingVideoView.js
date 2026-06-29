import React, { useEffect } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';

/**
 * Player interno: remount completo quando cambia uri (evita "shared object already released").
 */
function LoopingVideoPlayer({ uri, style, nativeControls, contentFit }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (!player) return undefined;
    try {
      player.loop = true;
      player.muted = true;
      player.play();
    } catch (_) {
      // player rilasciato durante transizione uri
    }
    return () => {
      try {
        player.pause();
      } catch (_) {}
    };
  }, [player, uri]);

  return (
    <VideoView
      player={player}
      style={style}
      contentFit={contentFit}
      nativeControls={nativeControls}
      fullscreenOptions={{ enabled: false }}
    />
  );
}

/**
 * Video locale/remoto in loop, muto, senza controlli nativi (expo-video).
 * @param {'contain'|'cover'} contentFit
 */
export default function LoopingVideoView({ uri, style, nativeControls = false, contentFit = 'contain' }) {
  if (!uri) return null;
  return (
    <LoopingVideoPlayer
      key={uri}
      uri={uri}
      style={style}
      nativeControls={nativeControls}
      contentFit={contentFit}
    />
  );
}
