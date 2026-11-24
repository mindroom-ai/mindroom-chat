import React, {
  MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import FocusTrap from 'focus-trap-react';
import type { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { Icon, IconButton, Icons, RectCords, Spinner, Text } from 'folds';
import { PopOut, revealDirectionControls } from '../../ui/directional';
import { Menu } from '../../ui/glass/GlassPrimitives';
import type { IAudioInfo } from '../../matrix/types/common';
import type { EventAttachmentOwner } from '../../matrix/protocol/eventAttachments';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  voiceMessagePlaybackRateAtom,
  voiceMessageVolumeAtom,
} from '../../preferences/voiceMessageSettings';
import { bytesToSize, secondsToMinutesAndSeconds } from '../../lib/common';
import { VoiceWaveform } from './voice/VoiceWaveform';
import { useMeasuredWaveform } from './voice/measuredWaveform';
import { VoicePlaybackRateButton } from './voice/VoicePlaybackRateButton';
import { VoiceVolumeButton } from './voice/VoiceVolumeButton';
import { getAudioContentSourceIdentity, voiceAudioPlayback } from './voice/voiceAudioPlayback';
import { FileDownloadButton } from './FileHeader';
import * as css from './VoiceAudioContent.css';

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

/**
 * The More menu: labeled volume and download rows first, then name (when known), type, size and
 * length.
 */
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
        <VoiceVolumeButton className={css.MoreMenuAction} />
        <FileDownloadButton
          className={css.MoreMenuAction}
          label={t('sharedUi.voiceAudioContent.download')}
          encInfo={encInfo}
          url={url}
          mimeType={mimeType}
          owner={owner}
          filename={filename ?? subject}
        />
        {filename ? (
          <DetailRow
            label={t('sharedUi.voiceAudioContent.name')}
            value={revealDirectionControls(filename)}
            truncate
          />
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
  const mx = useMatrixClient();
  const subject = label ?? t('sharedUi.voiceAudioContent.voiceMessage');
  const mediaIdentity = getAudioContentSourceIdentity({ mimeType, url, encInfo, owner });
  const subscribe = useCallback(
    (listener: () => void) => voiceAudioPlayback.subscribe(mediaIdentity, listener),
    [mediaIdentity]
  );
  const getSnapshot = useCallback(
    () => voiceAudioPlayback.getSnapshot(mediaIdentity),
    [mediaIdentity]
  );
  const track = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const shownWaveform = useMeasuredWaveform(mediaIdentity, track.src, waveform);

  const rate = useAtomValue(voiceMessagePlaybackRateAtom);
  const volume = useAtomValue(voiceMessageVolumeAtom);
  const [moreAnchor, setMoreAnchor] = useState<RectCords>();
  const identityRef = useRef(mediaIdentity);

  const matrixDuration = validSeconds(
    info.duration !== undefined ? info.duration / 1000 : undefined
  );
  const duration = track.browserDuration ?? matrixDuration ?? 0;

  // Stop only when this mounted player switches to different media (for example an edit), never
  // on unmount when virtualized timeline rows scroll out of view.
  useLayoutEffect(() => {
    const prevIdentity = identityRef.current;
    if (prevIdentity === mediaIdentity) return;
    identityRef.current = mediaIdentity;
    voiceAudioPlayback.stopIfActive(prevIdentity);
  }, [mediaIdentity]);

  useEffect(() => {
    voiceAudioPlayback.setPlaybackRate(rate);
  }, [rate]);

  useEffect(() => {
    voiceAudioPlayback.setVolume(volume);
  }, [volume]);

  const handlePlay = () => {
    voiceAudioPlayback.togglePlay(
      mx,
      { mimeType, url, encInfo, owner },
      { duration: matrixDuration, rate, volume }
    );
  };

  const seekTo = (progress: number) => {
    voiceAudioPlayback.seek(mx, { mimeType, url, encInfo, owner }, progress, {
      duration: matrixDuration,
      rate,
      volume,
    });
  };

  // Read by the waveform every frame while playing. A seek waiting for the source wins over the
  // media's own position, which is still 0 until that seek lands.
  const readPlayedProgress = useCallback(
    () => voiceAudioPlayback.getLiveProgress(mediaIdentity, duration),
    [mediaIdentity, duration]
  );

  const handleMoreClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Read the target now: React may run the updater after the event is released.
    const rect = event.currentTarget.getBoundingClientRect();
    setMoreAnchor((current) => (current ? undefined : rect));
  };

  const { playing, buffering, currentTime, engaged, src, status, playbackFailed } = track;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const started = playing || engaged || currentTime > 0;
  const timeText = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  const sourceFailed = status === 'error';
  const loadingSource = status === 'loading' || (Boolean(src) && buffering && playing);
  const errorMessage = playbackFailed
    ? t('sharedUi.voiceAudioContent.playbackError')
    : sourceFailed
      ? t('sharedUi.voiceAudioContent.loadError')
      : undefined;

  return (
    <div className={css.Root}>
      {!isVoiceMessage && filename && (
        <Text
          as="div"
          size="T200"
          className={css.Title}
          truncate
          title={revealDirectionControls(filename)}
        >
          {revealDirectionControls(filename)}
        </Text>
      )}
      <div className={css.Capsule} data-audio-capsule="true" data-playing={playing || undefined}>
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
                <Icon size="100" src={playing ? Icons.Pause : Icons.Play} filled />
              )}
            </IconButton>
          </div>
          <div className={css.WaveformCell}>
            <VoiceWaveform
              waveform={shownWaveform}
              progress={progress}
              getProgress={playing ? readPlayedProgress : undefined}
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
    </div>
  );
}
