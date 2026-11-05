import { MouseEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import FocusTrap from 'focus-trap-react';
import { Range } from 'react-range';
import { Icon, Icons, RectCords } from 'folds';
import { PopOut } from '../../../ui/directional';
import { Menu } from '../../../ui/glass/GlassPrimitives';
import { voiceMessageVolumeAtom } from '../../../preferences/voiceMessageSettings';
import * as css from './VoiceVolumeButton.css';

// With this margin the 16 px thumb has an empty margin box, which the track centers: its top
// lands on the top of the 32 px hit area. react-range then moves it down by half the height
// difference (8 px), which puts its center on the 6 px line.
const THUMB_CENTERING_OFFSET = -16;
// Each arrow key press moves the volume by 5 %.
const VOLUME_STEP = 0.05;

/**
 * The More menu's "Voice volume" row, with the speaker at its end. It opens the slider in a small
 * chip below the row, so the player above stays visible. The volume applies to every voice
 * message player.
 */
export function VoiceVolumeButton({ className }: { className: string }) {
  const { t } = useTranslation();
  const [volume, setVolume] = useAtom(voiceMessageVolumeAtom);
  const [anchor, setAnchor] = useState<RectCords>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const percent = Math.round(volume * 100);

  const isTrigger = (target: EventTarget | null) =>
    typeof Node !== 'undefined' && target instanceof Node && !!triggerRef.current?.contains(target);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Read the target now: React may run the updater after the event is released.
    const rect = event.currentTarget.getBoundingClientRect();
    setAnchor((current) => (current ? undefined : rect));
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={t('sharedUi.voiceVolumeButton.voiceVolumeCurrentlyValue1', { value1: percent })}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={handleClick}
      >
        <span>{t('sharedUi.voiceVolumeButton.voiceVolume')}</span>
        <Icon size="100" src={volume === 0 ? Icons.VolumeMute : Icons.VolumeHigh} />
      </button>
      <PopOut
        anchor={anchor}
        offset={4}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              // Focus lands on the slider thumb, so arrow keys change the volume right away.
              onDeactivate: () => setAnchor(undefined),
              // The trigger toggles the popover itself; let its click through.
              clickOutsideDeactivates: (event: { target: EventTarget | null }) =>
                !isTrigger(event.target),
              allowOutsideClick: (event: { target: EventTarget | null }) => isTrigger(event.target),
              escapeDeactivates: true,
            }}
          >
            <Menu className={css.Menu}>
              <Range
                min={0}
                max={1}
                step={VOLUME_STEP}
                values={[volume]}
                onChange={([value]) => setVolume(value)}
                renderTrack={({ props, children }) => (
                  <div {...props} className={css.Track} style={{ ...props.style }}>
                    <div className={css.TrackLine} />
                    {children}
                  </div>
                )}
                renderThumb={({ props }) => (
                  <div
                    {...props}
                    key={props.key}
                    className={css.Thumb}
                    aria-label={t('sharedUi.voiceVolumeButton.voiceVolume')}
                    style={{ ...props.style, marginTop: THUMB_CENTERING_OFFSET }}
                  />
                )}
              />
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}
