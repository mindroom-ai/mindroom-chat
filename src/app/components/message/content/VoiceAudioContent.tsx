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
import { useAudioContentSource } from './useAudioContentSource';
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
  const mediaIdentity = `${mimeType}\n${url}\n${encInfo?.iv ?? ''}\n${
    encInfo?.hashes?.sha256 ?? ''
  }`;
  const mediaIdentityRef = useRef(mediaIdentity);
  const audioMetadataLoadedRef = useRef(false);

  const getAudioRef = useCallback(() => audioRef.current, []);
  const { loading } = useMediaLoading(getAudioRef);
  const { playing, setPlaying } = useMediaPlay(getAudioRef);
  const { seek } = useMediaSeek(getAudioRef);
  const handlePlayTimeCallback: PlayTimeCallback = useCallback(
    (d, ct) => {
      if (!hasInfoDuration && Number.isFinite(d) && d > 0) {
        setDuration((currentDuration) =>
          Math.abs(currentDuration - d) > 0.01 ? d : currentDuration
        );
      }
      setCurrentTime(Number.isFinite(ct) && ct > 0 ? ct : 0);
    },
    [hasInfoDuration]
  );
  useMediaPlayTimeCallback(
    getAudioRef,
    useThrottle(handlePlayTimeCallback, PLAY_TIME_THROTTLE_OPS)
  );

  useEffect(() => {
    if (!hasInfoDuration) return;

    setDuration((currentDuration) =>
      currentDuration === 0 || !audioMetadataLoadedRef.current
        ? infoDuration / 1000
        : currentDuration
    );
  }, [hasInfoDuration, infoDuration]);

  useEffect(() => {
    if (mediaIdentityRef.current === mediaIdentity) return;

    mediaIdentityRef.current = mediaIdentity;
    audioMetadataLoadedRef.current = false;
    pendingSeekTimeRef.current = undefined;
    setCurrentTime(0);
    setDuration(infoDuration / 1000);
  }, [infoDuration, mediaIdentity]);

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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    applyVoicePlaybackRate(audio, playbackRate);
    applyVoiceMessageVolume(audio, volume);
  }, [playbackRate, sourceValue, volume]);

  const applyCurrentVoiceSettings = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    applyVoicePlaybackRate(audio, playbackRate);
    applyVoiceMessageVolume(audio, volume);
  }, [playbackRate, volume]);

  const handleLoadedMetadata = useCallback(() => {
    audioMetadataLoadedRef.current = true;
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
      setAutoPlayOnLoad(true);
      void loadSrc().catch(() => {
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
      void loadSrc().catch(() => {
        pendingSeekTimeRef.current = undefined;
      });
    }
  };

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const displayCurrentTime = Math.min(currentTime, duration || currentTime);
  const displayDuration = duration;

  return (
    <div className={css.Capsule}>
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
      <div className={css.WaveformSlot}>
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
      <div className={css.Controls}>
        <VoiceVolumeButton />
        {interacted ? <VoicePlaybackRateButton /> : <VoicePlaybackRatePlaceholder />}
      </div>
      <audio
        className={css.Audio}
        controls={false}
        autoPlay={autoPlayOnLoad}
        ref={audioRef}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => {
          setInteracted(true);
          applyCurrentVoiceSettings();
          updatePlayTimeFromAudio();
          applyPendingSeek();
          setAutoPlayOnLoad(false);
        }}
      >
        {srcState.status === AsyncStatus.Success && <source src={srcState.data} type={mimeType} />}
      </audio>
    </div>
  );
}
