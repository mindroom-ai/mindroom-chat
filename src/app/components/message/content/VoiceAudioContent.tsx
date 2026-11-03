import React, {
  MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import FocusTrap from 'focus-trap-react';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { Icon, IconButton, Icons, PopOut, RectCords, Spinner, Text } from 'folds';
import { Menu } from '../../glass/GlassPrimitives';
import type { IAudioInfo } from '../../../../types/matrix/common';
import type { EventAttachmentOwner } from '../../../mindroom/messages/eventAttachments';
import {
  applyVoiceMessageVolume,
  applyVoicePlaybackRate,
  voiceMessagePlaybackRateAtom,
  voiceMessageVolumeAtom,
} from '../../../mindroom/settings/voiceMessageSettings';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { useMediaLoading, useMediaPlay, useMediaPlayTimeCallback } from '../../../hooks/media';
import { useThrottle } from '../../../hooks/useThrottle';
import { bytesToSize, secondsToMinutesAndSeconds } from '../../../utils/common';
import { VoiceWaveform } from '../../voice/VoiceWaveform';
import { VoicePlaybackRateButton } from '../../voice/VoicePlaybackRateButton';
import { VoiceVolumeButton } from '../../voice/VoiceVolumeButton';
import { FileDownloadButton } from '../FileHeader';
import { getAudioContentSourceIdentity, useAudioContentSource } from './useAudioContentSource';
import * as css from './VoiceAudioContent.css';

const HAVE_METADATA = 1;

const validSeconds = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const formatTime = (seconds: number): string =>
  secondsToMinutesAndSeconds(Math.max(0, Math.floor(seconds)));

type VoiceAudioContentProps = {
  mimeType: string;
  url: string;
  info: IAudioInfo;
  encInfo?: EncryptedAttachmentInfo;
  owner?: EventAttachmentOwner;
  filename?: string;
  /** MSC1767 waveform, values from 0 to 1024. */
  waveform?: number[];
  /**
   * What the controls call this audio ("Play voice message", "Seek audio"); defaults to
   * "voice message".
   */
  label?: string;
  /** Voice messages show no title; other audio shows its file name. */
  isVoiceMessage?: boolean;
};

/** One "label: value" line in the More menu's file details. */
function DetailRow({
  label,
  value,
  truncate = false,
}: {
  label: string;
  value: React.ReactNode;
  truncate?: boolean;
}) {
  return (
    <div className={css.MoreMenuMeta}>
      <Text className={css.MoreMenuMetaLabel} as="span" size="T200">
        {label}
      </Text>
      <Text className={css.MoreMenuMetaValue} as="span" size="T200" truncate={truncate}>
        {value}
      </Text>
    </div>
  );
}

type VoiceDetailsMenuProps = Pick<
  VoiceAudioContentProps,
  'mimeType' | 'url' | 'info' | 'encInfo' | 'owner' | 'filename'
> & {
  subject: string;
  duration: number;
  onDismiss: () => void;
};

/** The More menu: volume and download first, then name (when known), type, size and length. */
function VoiceDetailsMenu({
  subject,
  filename,
  mimeType,
  url,
  encInfo,
  owner,
  info,
  duration,
  onDismiss,
}: VoiceDetailsMenuProps) {
  const { t } = useTranslation();
  const trapOptions = {
    initialFocus: false as const,
    clickOutsideDeactivates: true,
    escapeDeactivates: true,
    onDeactivate: onDismiss,
  };
  const { size } = info;

  return (
    <FocusTrap focusTrapOptions={trapOptions}>
      <Menu
        role="dialog"
        aria-label={t('sharedUi.voiceAudioContent.moreAudioOptions')}
        className={css.MoreMenu}
      >
        <div className={css.MoreMenuAction}>
          <VoiceVolumeButton />
          <FileDownloadButton
            encInfo={encInfo}
            url={url}
            mimeType={mimeType}
            owner={owner}
            filename={filename ?? subject}
          />
        </div>
        {filename ? (
          <DetailRow label={t('sharedUi.voiceAudioContent.name')} value={filename} truncate />
        ) : null}
        <DetailRow
          label={t('sharedUi.voiceAudioContent.type')}
          value={info.mimetype ?? mimeType}
          truncate
        />
        {typeof size === 'number' ? (
          <DetailRow label={t('sharedUi.voiceAudioContent.size')} value={bytesToSize(size)} />
        ) : null}
        <DetailRow label={t('sharedUi.voiceAudioContent.duration')} value={formatTime(duration)} />
      </Menu>
    </FocusTrap>
  );
}

/**
 * Player for voice messages and audio files: play, waveform seek, time, speed, and a More menu
 * with volume, download, and file details. The media loads on the first play or seek.
 */
export function VoiceAudioContent({
  mimeType,
  url,
  info,
  encInfo,
  owner,
  filename,
  waveform,
  label,
  isVoiceMessage = true,
}: VoiceAudioContentProps) {
  const { t } = useTranslation();
  const subject = label ?? t('sharedUi.voiceAudioContent.voiceMessage');
  const mediaIdentity = getAudioContentSourceIdentity({ mimeType, url, encInfo, owner });
  const [srcState, loadSrc] = useAudioContentSource({ mimeType, url, encInfo, owner });
  const src = srcState.status === AsyncStatus.Success ? srcState.data : undefined;

  const rate = useAtomValue(voiceMessagePlaybackRateAtom);
  const volume = useAtomValue(voiceMessageVolumeAtom);

  const audioRef = useRef<HTMLAudioElement>(null);
  // The element remounts when its source changes; a new getter rebinds the media hooks.
  const audioKey = src ?? 'unloaded';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const getAudio = useCallback(() => audioRef.current, [audioKey]);

  const [currentTime, setCurrentTime] = useState(0);
  const [browserDuration, setBrowserDuration] = useState<number>();
  const [autoPlay, setAutoPlay] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<RectCords>();
  const pendingSeekRef = useRef<number>();
  const loadRequestRef = useRef<string>();
  const identityRef = useRef(mediaIdentity);

  const matrixDuration = validSeconds(
    info.duration !== undefined ? info.duration / 1000 : undefined
  );
  const duration = browserDuration ?? matrixDuration ?? 0;

  useLayoutEffect(() => {
    if (identityRef.current === mediaIdentity) return;
    identityRef.current = mediaIdentity;
    pendingSeekRef.current = undefined;
    loadRequestRef.current = undefined;
    setCurrentTime(0);
    setBrowserDuration(undefined);
    setAutoPlay(false);
    setPlaybackFailed(false);
  }, [mediaIdentity]);

  const { playing, setPlaying } = useMediaPlay(getAudio);
  const { loading: buffering } = useMediaLoading(getAudio);

  const handlePlayTime = useThrottle(
    useCallback((mediaDuration: number, mediaTime: number) => {
      const measured = validSeconds(mediaDuration);
      if (measured !== undefined) setBrowserDuration(measured);
      if (Number.isFinite(mediaTime) && pendingSeekRef.current === undefined) {
        setCurrentTime(mediaTime);
      }
    }, []),
    { wait: 200, immediate: true }
  );
  useMediaPlayTimeCallback(getAudio, handlePlayTime);

  const applyAudioSettings = useCallback(
    (audio: HTMLAudioElement) => {
      applyVoicePlaybackRate(audio, rate);
      applyVoiceMessageVolume(audio, volume);
    },
    [rate, volume]
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) applyVoicePlaybackRate(audio, rate);
  }, [rate, audioKey]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) applyVoiceMessageVolume(audio, volume);
  }, [volume, audioKey]);

  const requestSource = useCallback(() => {
    if (srcState.status === AsyncStatus.Success) return;
    if (srcState.status === AsyncStatus.Loading && loadRequestRef.current === mediaIdentity) return;
    if (loadRequestRef.current === mediaIdentity && srcState.status !== AsyncStatus.Error) return;
    const requestIdentity = mediaIdentity;
    loadRequestRef.current = requestIdentity;
    loadSrc().catch(() => {
      if (loadRequestRef.current === requestIdentity) loadRequestRef.current = undefined;
    });
  }, [loadSrc, mediaIdentity, srcState.status]);

  const handlePlay = () => {
    if (src) {
      setPlaying(!playing);
      return;
    }
    setAutoPlay(true);
    requestSource();
  };

  const seekTo = (progress: number) => {
    const target = progress * duration;
    setCurrentTime(target);
    const audio = audioRef.current;
    if (src && audio && audio.readyState >= HAVE_METADATA) {
      pendingSeekRef.current = undefined;
      audio.currentTime = target;
      return;
    }
    pendingSeekRef.current = progress;
    requestSource();
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    applyAudioSettings(audio);
    const measured = validSeconds(audio.duration);
    if (measured !== undefined) setBrowserDuration(measured);
    const pendingSeek = pendingSeekRef.current;
    if (pendingSeek !== undefined && audio.readyState >= HAVE_METADATA) {
      pendingSeekRef.current = undefined;
      const target = pendingSeek * (measured ?? matrixDuration ?? 0);
      audio.currentTime = target;
      setCurrentTime(target);
      return;
    }
    if (Number.isFinite(audio.currentTime)) setCurrentTime(audio.currentTime);
  };

  const handleMediaPlay = () => {
    const audio = audioRef.current;
    if (audio) applyAudioSettings(audio);
  };

  const markPlaybackFailed = () => setPlaybackFailed(true);

  const handleMoreClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Read the target now: React may run the updater after the event is released.
    const rect = event.currentTarget.getBoundingClientRect();
    setMoreAnchor((current) => (current ? undefined : rect));
  };

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const started = playing || currentTime > 0;
  const timeText = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  const sourceFailed = srcState.status === AsyncStatus.Error;
  const loadingSource = srcState.status === AsyncStatus.Loading || (!!src && buffering && playing);
  const errorMessage = playbackFailed
    ? t('sharedUi.voiceAudioContent.playbackError')
    : sourceFailed
    ? t('sharedUi.voiceAudioContent.loadError')
    : undefined;

  return (
    <div className={css.Root}>
      {!isVoiceMessage && filename && (
        <Text as="div" size="T300" className={css.Title} truncate title={filename}>
          {filename}
        </Text>
      )}
      <div className={css.Capsule} data-playing={playing || undefined}>
        <div className={css.Controls}>
          <div className={css.PlayCell}>
            <IconButton
              className={css.PlayButton}
              variant="Primary"
              size="300"
              radii="Pill"
              disabled={playbackFailed}
              aria-label={
                playing
                  ? t('sharedUi.voiceAudioContent.pauseValue1', { value1: subject })
                  : t('sharedUi.voiceAudioContent.playValue1', { value1: subject })
              }
              onClick={handlePlay}
            >
              {loadingSource ? (
                <Spinner size="100" variant="Primary" fill="Solid" />
              ) : (
                <Icon
                  className={playing ? undefined : css.PlayIcon}
                  size="100"
                  src={playing ? Icons.Pause : Icons.Play}
                  filled
                />
              )}
            </IconButton>
          </div>
          <div className={css.WaveformCell}>
            <VoiceWaveform
              waveform={waveform}
              progress={progress}
              dimmed={!started}
              label={t('sharedUi.voiceAudioContent.seekValue1', { value1: subject })}
              valueText={t('sharedUi.voiceAudioContent.playbackPosition', {
                current: formatTime(currentTime),
                duration: formatTime(duration),
              })}
              disabled={playbackFailed}
              onSeekProgress={seekTo}
            />
          </div>
          <Text as="span" size="T200" className={css.Time} title={timeText}>
            {started ? formatTime(currentTime) : formatTime(duration)}
          </Text>
          <div className={css.RateCell}>
            <VoicePlaybackRateButton />
          </div>
          <div className={css.MoreCell}>
            <IconButton
              size="300"
              radii="Pill"
              variant="SurfaceVariant"
              aria-label={t('sharedUi.voiceAudioContent.moreAudioOptions')}
              aria-haspopup="dialog"
              aria-expanded={!!moreAnchor}
              onClick={handleMoreClick}
            >
              <Icon size="100" src={Icons.VerticalDots} />
            </IconButton>
          </div>
        </div>
        {errorMessage && (
          <Text as="span" size="T200" className={css.Error} role="status">
            {errorMessage}
          </Text>
        )}
      </div>
      <PopOut
        anchor={moreAnchor}
        position="Bottom"
        align="End"
        offset={4}
        content={
          <VoiceDetailsMenu
            subject={subject}
            encInfo={encInfo}
            url={url}
            mimeType={mimeType}
            filename={filename}
            owner={owner}
            info={info}
            duration={duration}
            onDismiss={() => setMoreAnchor(undefined)}
          />
        }
      />
      {/* Voice messages have no caption track; the waveform and time stand in for one. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        key={audioKey}
        autoPlay={autoPlay}
        preload="metadata"
        controls={false}
        className={css.Audio}
        onError={markPlaybackFailed}
        onPlay={handleMediaPlay}
        onLoadedMetadata={handleLoadedMetadata}
      >
        {src ? <source type={mimeType} src={src} onError={markPlaybackFailed} /> : null}
      </audio>
    </div>
  );
}
