/* eslint-disable jsx-a11y/media-has-caption */
import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Chip, Icon, IconButton, Icons, ProgressBar, Spinner, Text, toRem } from 'folds';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { Range } from 'react-range';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { IAudioInfo } from '../../../../types/matrix/common';
import {
  PlayTimeCallback,
  useMediaLoading,
  useMediaPlay,
  useMediaPlayTimeCallback,
  useMediaSeek,
  useMediaVolume,
} from '../../../hooks/media';
import { useThrottle } from '../../../hooks/useThrottle';
import { secondsToMinutesAndSeconds } from '../../../utils/common';
import { getAudioContentSourceIdentity, useAudioContentSource } from './useAudioContentSource';

const PLAY_TIME_THROTTLE_OPS = {
  wait: 500,
  immediate: true,
};

type RenderMediaControlProps = {
  after: ReactNode;
  leftControl: ReactNode;
  rightControl: ReactNode;
  children: ReactNode;
};
export type AudioContentProps = {
  mimeType: string;
  url: string;
  info: IAudioInfo;
  encInfo?: EncryptedAttachmentInfo;
  renderMediaControl: (props: RenderMediaControlProps) => ReactNode;
};
export function AudioContent({
  mimeType,
  url,
  info,
  encInfo,
  renderMediaControl,
}: AudioContentProps) {
  const [srcState, loadSrc] = useAudioContentSource({ mimeType, url, encInfo });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [autoPlayOnLoad, setAutoPlayOnLoad] = useState(false);
  const mediaIdentity = getAudioContentSourceIdentity({ mimeType, url, encInfo });
  const mediaIdentityRef = useRef(mediaIdentity);
  const loadIntentRef = useRef(0);

  const [currentTime, setCurrentTime] = useState(0);
  // duration in seconds. (NOTE: info.duration is in milliseconds)
  const infoDuration = info.duration ?? 0;
  const [duration, setDuration] = useState((infoDuration >= 0 ? infoDuration : 0) / 1000);

  const setAudioRef = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
    setAudioElement(element);
  }, []);
  const getAudioRef = useCallback(() => audioElement, [audioElement]);
  const { loading } = useMediaLoading(getAudioRef);
  const { playing, setPlaying } = useMediaPlay(getAudioRef);
  const { seek } = useMediaSeek(getAudioRef);
  const { volume, mute, setMute, setVolume } = useMediaVolume(getAudioRef);
  const handlePlayTimeCallback: PlayTimeCallback = useCallback((d, ct) => {
    setDuration(d);
    setCurrentTime(ct);
  }, []);
  useMediaPlayTimeCallback(
    getAudioRef,
    useThrottle(handlePlayTimeCallback, PLAY_TIME_THROTTLE_OPS)
  );

  useEffect(() => {
    if (mediaIdentityRef.current === mediaIdentity) return;

    mediaIdentityRef.current = mediaIdentity;
    loadIntentRef.current += 1;
    setAutoPlayOnLoad(false);
    setCurrentTime(0);
    setDuration((infoDuration >= 0 ? infoDuration : 0) / 1000);
  }, [infoDuration, mediaIdentity]);

  const createLoadIntent = useCallback(() => {
    const intent = {
      id: loadIntentRef.current + 1,
      mediaIdentity,
    };
    loadIntentRef.current = intent.id;
    return intent;
  }, [mediaIdentity]);

  const isCurrentLoadIntent = useCallback(
    (intent: { id: number; mediaIdentity: string }) =>
      loadIntentRef.current === intent.id && mediaIdentityRef.current === intent.mediaIdentity,
    []
  );

  const handlePlay = () => {
    if (srcState.status === AsyncStatus.Success) {
      setAutoPlayOnLoad(false);
      setPlaying(!playing);
    } else if (srcState.status !== AsyncStatus.Loading) {
      const loadIntent = createLoadIntent();
      setAutoPlayOnLoad(true);
      void loadSrc().catch(() => {
        if (!isCurrentLoadIntent(loadIntent)) return;
        setAutoPlayOnLoad(false);
      });
    }
  };

  const sourceValue = srcState.status === AsyncStatus.Success ? srcState.data : undefined;
  const audioMediaKey = `${mediaIdentity}:${sourceValue ?? ''}`;

  return renderMediaControl({
    after: (
      <Range
        step={1}
        min={0}
        max={duration || 1}
        values={[currentTime]}
        onChange={(values) => seek(values[0])}
        renderTrack={(params) => (
          <div {...params.props}>
            {params.children}
            <ProgressBar
              as="div"
              variant="Secondary"
              size="300"
              min={0}
              max={duration}
              value={currentTime}
              radii="300"
            />
          </div>
        )}
        renderThumb={(params) => (
          <Badge
            size="300"
            variant="Secondary"
            fill="Solid"
            radii="Pill"
            outlined
            {...params.props}
            style={{
              ...params.props.style,
              zIndex: 0,
            }}
          />
        )}
      />
    ),
    leftControl: (
      <>
        <Chip
          onClick={handlePlay}
          variant="Secondary"
          radii="300"
          disabled={srcState.status === AsyncStatus.Loading}
          before={
            srcState.status === AsyncStatus.Loading || loading ? (
              <Spinner variant="Secondary" size="50" />
            ) : (
              <Icon src={playing ? Icons.Pause : Icons.Play} size="50" filled={playing} />
            )
          }
        >
          <Text size="B300">{playing ? 'Pause' : 'Play'}</Text>
        </Chip>

        <Text size="T200">{`${secondsToMinutesAndSeconds(
          currentTime
        )} / ${secondsToMinutesAndSeconds(duration)}`}</Text>
      </>
    ),
    rightControl: (
      <>
        <IconButton
          variant="SurfaceVariant"
          size="300"
          radii="Pill"
          onClick={() => setMute(!mute)}
          aria-pressed={mute}
        >
          <Icon src={mute ? Icons.VolumeMute : Icons.VolumeHigh} size="50" />
        </IconButton>
        <Range
          step={0.1}
          min={0}
          max={1}
          values={[volume]}
          onChange={(values) => setVolume(values[0])}
          renderTrack={(params) => (
            <div {...params.props}>
              {params.children}
              <ProgressBar
                style={{ width: toRem(48) }}
                variant="Secondary"
                size="300"
                min={0}
                max={1}
                value={volume}
                radii="300"
              />
            </div>
          )}
          renderThumb={(params) => (
            <Badge
              size="300"
              variant="Secondary"
              fill="Solid"
              radii="Pill"
              outlined
              {...params.props}
              style={{
                ...params.props.style,
                zIndex: 0,
              }}
            />
          )}
        />
      </>
    ),
    children: (
      <audio
        key={audioMediaKey}
        controls={false}
        autoPlay={autoPlayOnLoad}
        ref={setAudioRef}
        onPlay={() => setAutoPlayOnLoad(false)}
      >
        {sourceValue && <source src={sourceValue} type={mimeType} />}
      </audio>
    ),
  });
}
