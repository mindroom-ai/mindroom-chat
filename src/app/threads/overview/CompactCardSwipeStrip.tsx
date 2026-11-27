import { type CSSProperties, type HTMLAttributes, type RefObject } from 'react';
import { Icon, Icons, Text } from 'folds';
import * as css from './CompactCardSwipe.css';

export type SwipePointerHandlers = Pick<
  HTMLAttributes<HTMLDivElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture'
>;

export type CompactCardSwipeStripProps = {
  resolved: boolean;
  label: string;
  armed?: boolean;
  snoozed?: boolean;
  snoozeLabel?: string;
  parked?: boolean;
  parkWidth?: number;
  onSnoozeClick?: () => void;
  onResolveClick?: () => void;
  stripRef?: RefObject<HTMLDivElement | null>;
  'data-tour-swipe'?: string;
} & SwipePointerHandlers &
  Pick<HTMLAttributes<HTMLDivElement>, 'onClickCapture'>;

/** The action strip or split tray revealed behind a swiped compact card; shared with the tour. */
export function CompactCardSwipeStrip({
  resolved,
  label,
  armed = false,
  snoozed = false,
  snoozeLabel,
  parked = false,
  parkWidth,
  onSnoozeClick,
  onResolveClick,
  stripRef,
  ...props
}: CompactCardSwipeStripProps) {
  if (snoozeLabel !== undefined) {
    const items = [
      ['snooze', css.SnoozeButton, Icons.Clock, snoozeLabel, onSnoozeClick],
      ['resolve', css.ResolveButton, Icons.Check, label, onResolveClick],
    ] as const;
    return (
      <div
        ref={stripRef}
        className={css.SwipeTray}
        style={
          parkWidth !== undefined
            ? ({ '--swipe-tray-width': `${parkWidth}px` } as CSSProperties)
            : undefined
        }
        data-compact-card-swipe="action"
        data-armed={armed ? 'true' : undefined}
        data-parked={parked ? 'true' : undefined}
        data-snoozed={snoozed ? 'true' : undefined}
        aria-hidden={parked ? undefined : true}
        {...props}
      >
        {items.map(([action, cls, icon, text, onClick]) => (
          <button
            key={action}
            type="button"
            className={`${css.TrayButton} ${cls}`}
            data-compact-card-swipe-action={action}
            tabIndex={parked ? 0 : -1}
            onClick={onClick}
          >
            <Icon size="200" src={icon} />
            <Text size="T200" className={css.TrayLabel}>
              {text}
            </Text>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div
      ref={stripRef}
      className={css.SwipeAction}
      data-compact-card-swipe="action"
      data-armed={armed ? 'true' : undefined}
      data-resolved={resolved ? 'true' : undefined}
      aria-hidden
      {...props}
    >
      <Icon size="200" src={resolved ? Icons.Reload : Icons.Check} />
      <Text size="B300">{label}</Text>
    </div>
  );
}
