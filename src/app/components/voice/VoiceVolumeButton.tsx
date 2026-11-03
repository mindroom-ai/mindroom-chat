import React, { MouseEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import FocusTrap from 'focus-trap-react';
import { Range } from 'react-range';
import { Icon, Icons, PopOut, RectCords } from 'folds';
import { Menu } from '../glass/GlassPrimitives';
import { voiceMessageVolumeAtom } from '../../mindroom/settings/voiceMessageSettings';
import * as css from './VoiceVolumeButton.css';

// The library positions the 16 px thumb from the top of the 24 px hit area; pulling it up by
// its own height puts its center on the 6 px line.
const THUMB_CENTERING_OFFSET = -16;

/** Volume for every voice message player, in a small slider popover. */
export function VoiceVolumeButton() {
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
        className={css.Button}
        aria-label={t('sharedUi.voiceVolumeButton.volumeCurrently', { value: percent })}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={handleClick}
      >
        <Icon size="100" src={volume === 0 ? Icons.VolumeMute : Icons.VolumeHigh} />
      </button>
      <PopOut









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
                step={0.01}
                values={[volume]}
                onChange={([value]) => setVolume(value)}
                renderTrack={({ props, children }) => (
                  <div {...props} className={css.Track} style={{ ...props.style }}>
                    <div
                      className={css.TrackLine}
                      style={{
                        background: `linear-gradient(to right, var(--mr-volume-fill, currentColor) ${percent}%, var(--mr-volume-rest, rgba(127, 127, 127, 0.3)) ${percent}%)`,
                      }}
                    />
                    {children}
                  </div>
                )}
                renderThumb={({ props }) => (
                  <div
                    {...props}
                    key={props.key}
                    className={css.Thumb}
                    aria-label={t('sharedUi.voiceVolumeButton.volume')}
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
