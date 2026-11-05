import { useCallback, useEffect, useState } from 'react';

/** Whether the media plays, and a setter that plays or pauses it. */
export const useMediaPlay = (getMedia: () => HTMLMediaElement | null | undefined) => {
  const [playing, setPlayingState] = useState(false);

  useEffect(() => {
    const media = getMedia();
    if (!media) return undefined;
    setPlayingState(!media.paused);
    const handlePlay = () => setPlayingState(true);
    const handlePause = () => setPlayingState(false);
    media.addEventListener('play', handlePlay);
    media.addEventListener('pause', handlePause);
    media.addEventListener('ended', handlePause);
    return () => {
      media.removeEventListener('play', handlePlay);
      media.removeEventListener('pause', handlePause);
      media.removeEventListener('ended', handlePause);
    };
  }, [getMedia]);

  const setPlaying = useCallback(
    (play: boolean) => {
      const media = getMedia();
      if (!media) return;
      if (play) media.play().catch(() => setPlayingState(false));
      else media.pause();
    },
    [getMedia]
  );

  return { playing, setPlaying };
};
