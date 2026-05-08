/* eslint-disable jsx-a11y/media-has-caption */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, IconButton, Icons, Spinner, Text } from 'folds';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { useAtomValue } from 'jotai';
import { IAudioInfo } from '../../../../types/matrix/common';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import {
  PlayTimeCallback,
  useMediaLoading,
  useMediaPlay,
  useMediaPlayTimeCallback,
  useMediaSeek,
} from '../../../hooks/media';
import { useThrottle } from '../../../hooks/useThrottle';
import { secondsToMinutesAndSeconds } from '../../../utils/common';
import {
  applyVoiceMessageVolume,
  applyVoicePlaybackRate,
  voiceMessagePlaybackRateAtom,
  voiceMessageVolumeAtom,
} from '../../../state/voiceMessageSettings';
import {
  VoicePlaybackRateButton,
  VoicePlaybackRatePlaceholder,
} from '../../voice/VoicePlaybackRateButton';
import { VoiceVolumeButton } from '../../voice/VoiceVolumeButton';
import { VoiceWaveform } from '../../voice/VoiceWaveform';
import { getAudioContentSourceIdentity, useAudioContentSource } from './useAudioContentSource';
import * as css from './VoiceAudioContent.css';

const PLAY_TIME_THROTTLE_OPS = {
  wait: 250,
  immediate: true,
};

const formatVoiceTime = (seconds: number) =>
  secondsToMinutesAndSeconds(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);

export type VoiceAudioContentProps = {
  mimeType: string;
  url: string;
  info: IAudioInfo;
  encInfo?: EncryptedAttachmentInfo;
  waveform?: number[];
};

export function VoiceAudioContent({
  mimeType,
  url,
  info,
  encInfo,
  waveform,
}: VoiceAudioContentProps) {
  const [srcState, loadSrc] = useAudioContentSource({ mimeType, url, encInfo });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const pendingSeekTimeRef = useRef<number>();
  const [autoPlayOnLoad, setAutoPlayOnLoad] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playbackRate = useAtomValue(voiceMessagePlaybackRateAtom);
  const volume = useAtomValue(voiceMessageVolumeAtom);
  const infoDuration =
    Number.isFinite(info.duration) && info.duration && info.duration > 0 ? info.duration : 0;
  const hasInfoDuration = infoDuration > 0;
  const [duration, setDuration] = useState(infoDuration / 1000);
  const mediaIdentity = getAudioContentSourceIdentity({ mimeType, url, encInfo });
  const mediaIdentityRef = useRef(mediaIdentity);
  const loadIntentRef = useRef(0);
  const browserMeasuredDurationRef = useRef(false);

  const setAudioRef = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
    setAudioElement(element);
  }, []);
  const getAudioRef = useCallback(() => audioElement, [audioElement]);
  const { loading } = useMediaLoading(getAudioRef);
  const { playing, setPlaying } = useMediaPlay(getAudioRef);
  const { seek } = useMediaSeek(getAudioRef);
  const handlePlayTimeCallback: PlayTimeCallback = useCallback((d, ct) => {
    if (Number.isFinite(d) && d > 0) {
      browserMeasuredDurationRef.current = true;
      setDuration((currentDuration) =>
        Math.abs(currentDuration - d) > 0.01 ? d : currentDuration
      );
    }
    setCurrentTime(Number.isFinite(ct) && ct > 0 ? ct : 0);
  }, []);
  useMediaPlayTimeCallback(
    getAudioRef,
    useThrottle(handlePlayTimeCallback, PLAY_TIME_THROTTLE_OPS)
  );

  useEffect(() => {
    if (!hasInfoDuration) return;

    setDuration((currentDuration) =>
      currentDuration === 0 || !browserMeasuredDurationRef.current
        ? infoDuration / 1000
        : currentDuration
    );
  }, [hasInfoDuration, infoDuration]);

  useEffect(() => {
    if (mediaIdentityRef.current === mediaIdentity) return;

    mediaIdentityRef.current = mediaIdentity;
    loadIntentRef.current += 1;
    browserMeasuredDurationRef.current = false;
    pendingSeekTimeRef.current = undefined;
    setAutoPlayOnLoad(false);
    setCurrentTime(0);
    setDuration(infoDuration / 1000);
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

  const updatePlayTimeFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    handlePlayTimeCallback(audio.duration, audio.currentTime);
  }, [handlePlayTimeCallback]);

  const applyPendingSeek = useCallback(() => {
    const pendingSeekTime = pendingSeekTimeRef.current;
    const audio = audioRef.current;
    if (pendingSeekTime === undefined || !audio) return;

    try {
      seek(pendingSeekTime);
      pendingSeekTimeRef.current = undefined;
      setCurrentTime(pendingSeekTime);
    } catch {
      // Some browsers reject currentTime before metadata is available; keep it pending.
    }
  }, [seek]);

  useEffect(() => {
    if (srcState.status === AsyncStatus.Success) {
      applyPendingSeek();
    }
  }, [applyPendingSeek, srcState.status]);

  const sourceValue = srcState.status === AsyncStatus.Success ? srcState.data : undefined;
  const audioMediaKey = `${mediaIdentity}:${sourceValue ?? ''}`;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    applyVoicePlaybackRate(audio, playbackRate);
    applyVoiceMessageVolume(audio, volume);
  }, [audioElement, playbackRate, sourceValue, volume]);

  const applyCurrentVoiceSettings = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    applyVoicePlaybackRate(audio, playbackRate);
    applyVoiceMessageVolume(audio, volume);
  }, [playbackRate, volume]);

  const handleLoadedMetadata = useCallback(() => {
    applyCurrentVoiceSettings();
    updatePlayTimeFromAudio();
    applyPendingSeek();
  }, [applyCurrentVoiceSettings, applyPendingSeek, updatePlayTimeFromAudio]);

  const handlePlay = () => {
    setInteracted(true);
    applyCurrentVoiceSettings();

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

  const handleSeekProgress = (progress: number) => {
    if (!duration) return;

    setInteracted(true);
    const nextTime = progress * duration;
    pendingSeekTimeRef.current = undefined;
    setCurrentTime(nextTime);
    if (srcState.status === AsyncStatus.Success) {
      seek(nextTime);
      return;
    }

    pendingSeekTimeRef.current = nextTime;
    if (srcState.status !== AsyncStatus.Loading) {
      const loadIntent = createLoadIntent();
      void loadSrc().catch(() => {
        if (!isCurrentLoadIntent(loadIntent)) return;
        pendingSeekTimeRef.current = undefined;
      });
    }
  };

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const displayCurrentTime = Math.min(currentTime, duration || currentTime);
  const displayDuration = duration;

  return (
    <div className={css.Root}>
      <div className={css.Capsule}>
        <div className={css.PlayCell}>
          <IconButton
            variant="SurfaceVariant"
            size="300"
            radii="300"
            onClick={handlePlay}
            disabled={srcState.status === AsyncStatus.Loading}
            aria-label={playing ? 'Pause voice message' : 'Play voice message'}
            aria-pressed={playing}
          >
            {srcState.status === AsyncStatus.Loading || loading ? (
              <Spinner variant="Secondary" size="50" />
            ) : (
              <Icon src={playing ? Icons.Pause : Icons.Play} size="50" filled={playing} />
            )}
          </IconButton>
        </div>
        <div className={css.WaveformCell}>
          <VoiceWaveform
            waveform={waveform}
            progress={progress}
            label="Seek voice message"
            onSeekProgress={handleSeekProgress}
          />
        </div>
        <Text className={css.Time} size="B300">
          {`${formatVoiceTime(displayCurrentTime)} / ${formatVoiceTime(displayDuration)}`}
        </Text>
        <div className={css.VolumeCell}>
          <VoiceVolumeButton />
        </div>
        <div className={css.RateCell}>
          {interacted ? <VoicePlaybackRateButton /> : <VoicePlaybackRatePlaceholder />}
        </div>
        <audio
          key={audioMediaKey}
          className={css.Audio}
          controls={false}
          autoPlay={autoPlayOnLoad}
          ref={setAudioRef}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => {
            setInteracted(true);
            applyCurrentVoiceSettings();
            updatePlayTimeFromAudio();
            applyPendingSeek();
            setAutoPlayOnLoad(false);
          }}
        >
          {srcState.status === AsyncStatus.Success && (
            <source src={srcState.data} type={mimeType} />
          )}
        </audio>
      </div>
    </div>
  );
}
