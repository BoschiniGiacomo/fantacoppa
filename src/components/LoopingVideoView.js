import React from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';

/**
 * Video locale/remoto in loop, muto, senza controlli nativi (expo-video).
 * @param {'contain'|'cover'} contentFit
 */
export default function LoopingVideoView({ uri, style, nativeControls = false, contentFit = 'contain' }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

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
