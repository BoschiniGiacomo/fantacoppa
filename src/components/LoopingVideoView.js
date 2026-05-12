import React from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';

/**
 * Video locale/remoto in loop, muto, senza controlli nativi (expo-video).
 */
export default function LoopingVideoView({ uri, style, nativeControls = false }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={style}
      contentFit="contain"
      nativeControls={nativeControls}
      allowsFullscreen={false}
    />
  );
}
