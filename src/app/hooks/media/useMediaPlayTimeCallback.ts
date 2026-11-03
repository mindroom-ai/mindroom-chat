import { useEffect, useRef } from 'react';

/** Calls `onTime(duration, currentTime)` as the media plays, seeks, or learns its duration. */
export const useMediaPlayTimeCallback = (
  getMedia: () => HTMLMediaElement | null | undefined,
  onTime: (duration: number, currentTime: number) => void
): void => {
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  useEffect(() => {
    const media = getMedia();
    if (!media) return undefined;
    const report = () => onTimeRef.current(media.duration, media.currentTime);
    const events = ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked'] as const;
    events.forEach((event) => media.addEventListener(event, report));
    return () => events.forEach((event) => media.removeEventListener(event, report));
  }, [getMedia]);
};
