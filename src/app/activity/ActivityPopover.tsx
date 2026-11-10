import FocusTrap from 'focus-trap-react';
import { Scroll, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { stopPropagation } from '../lib/keyboard';
import { PopOut } from '../ui/directional';
import { Menu } from '../ui/glass/GlassPrimitives';
import { ActivityList } from './ActivityList';

type ActivityPopoverProps = {
  /** The rail button it opens from; its own click toggles the popover. */
  anchor: HTMLElement;
  onClose: () => void;
  onExpand: () => void;
  /** A row opened its thread in the Activity section; closes the popover. */
  onNavigate: () => void;
};

/** Activity over the current page, beside the rail's bell: glance, answer, open a thread. */
export function ActivityPopover({ anchor, onClose, onExpand, onNavigate }: ActivityPopoverProps) {
  const { t } = useTranslation();
  const onAnchor = (target: EventTarget | null) =>
    target instanceof Node && anchor.contains(target);
  return (
    <PopOut
      // folds lays a full-window layer under the popover; it lets presses through, so a second
      // press of the bell reaches the bell (which opens the page) and the page stays usable.
      style={{ pointerEvents: 'none' }}
      anchor={anchor.getBoundingClientRect()}
      position="Right"
      align="Start"
      offset={8}
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            onDeactivate: onClose,
            escapeDeactivates: stopPropagation,
            clickOutsideDeactivates: (event) => !onAnchor(event.target),
            allowOutsideClick: (event) => onAnchor(event.target),
          }}
        >
          <Menu
            role="dialog"
            aria-label={t('activity.title')}
            style={{
              inlineSize: toRem(400),
              maxInlineSize: 'calc(100vw - 5rem)',
              maxBlockSize: '70vh',
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: 'auto',
            }}
          >
            <Scroll size="300" hideTrack visibility="Hover">
              <ActivityList variant="popover" onExpand={onExpand} onNavigate={onNavigate} />
            </Scroll>
          </Menu>
        </FocusTrap>
      }
    />
  );
}
