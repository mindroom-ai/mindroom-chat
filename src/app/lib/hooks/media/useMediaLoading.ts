import { useEffect, useState } from 'react';

/** Whether the media element is waiting for data (buffering or before it can play). */
export const useMediaLoading = (getMedia: () => HTMLMediaElement | null | undefined) => {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const media = getMedia();
    if (!media) return undefined;
    const handleWaiting = () => setLoading(true);
    const handleReady = () => setLoading(false);
    media.addEventListener('loadstart', handleWaiting);
    media.addEventListener('waiting', handleWaiting);
    media.addEventListener('canplay', handleReady);
    media.addEventListener('playing', handleReady);
    media.addEventListener('error', handleReady);
    return () => {
      media.removeEventListener('loadstart', handleWaiting);
      media.removeEventListener('waiting', handleWaiting);
      media.removeEventListener('canplay', handleReady);
      media.removeEventListener('playing', handleReady);
      media.removeEventListener('error', handleReady);
    };
  }, [getMedia]);

  return { loading };
};
