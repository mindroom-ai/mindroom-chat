import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Chip, Icon, Icons, Spinner, Text, color, config, toRem, type IconSrc } from 'folds';
import * as css from '../../features/room/RoomTimeline.css';
import * as overlay from './RoomOverlay.css';

/**
 * What the room timeline lays over and around its rows: the floating pills, the slot of the
 * thread filter bar, the expand-all toggle, a thread's loading lines, and the boxes' insets.
 */

/**
 * The room timeline's rows begin below the floating header and, where it shows, the thread filter
 * bar: the overview inset is the bar's height with its margins. The inset joins the band the
 * header covers, so a row scrolled into it counts as out of sight. Without the bar (the Full
 * view) it is a gap twice the Compact cards' one, so that a short room overflows by more than a
 * small wheel turn and loads its older rows only when the reader reaches its top
 * (live/room-load-older-keeps-reader).
 */
const ROOM_GAP_BELOW_HEADER = config.space.S400;
const roomViewStyle = {
  minHeight: 0,
  position: 'relative',
  '--room-overview-height': ROOM_GAP_BELOW_HEADER,
} as CSSProperties;
export const roomViewStyleUnder = (barHeight: number | null): CSSProperties =>
  barHeight === null
    ? roomViewStyle
    : ({ ...roomViewStyle, '--room-overview-height': `${barHeight}px` } as CSSProperties);
export const threadViewStyle: CSSProperties = { minHeight: 0, position: 'relative' };

/** As tall as the footer inset: a growing composer moves the newest row up with it. */
export const footerProbeStyle: CSSProperties = {
  position: 'absolute',
  insetInlineStart: 0,
  bottom: 0,
  width: 0,
  height: overlay.footerInset,
  visibility: 'hidden',
  pointerEvents: 'none',
};

/** A pill over the timeline that takes the reader somewhere or settles the unread state. */
export function FloatingAction({
  icon,
  label,
  onSelect,
  primary = false,
}: {
  icon: IconSrc;
  label: string;
  onSelect: () => void;
  primary?: boolean;
}) {
  return (
    <Chip
      onClick={onSelect}
      variant={primary ? 'Primary' : 'SurfaceVariant'}
      outlined
      radii="Pill"
      before={<Icon src={icon} size="50" />}
    >
      <Text size="L400">{label}</Text>
    </Chip>
  );
}

/** Jump to Latest, above the composer, while the reader is away from the bottom. */
export function JumpToLatestAction({ onSelect }: { onSelect: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className={css.TimelineFloat({ position: 'Bottom' })}
      style={{ bottom: `calc(${overlay.footerInset} + ${config.space.S400})` }}
    >
      <FloatingAction
        icon={Icons.ArrowBottom}
        label={t('mindroomUi.threads.mindroomRoomTimeline.jumpToLatest')}
        onSelect={onSelect}
      />
    </div>
  );
}

/**
 * Holds the thread filter bar where it floats, under the room header, and reports the height it
 * takes there (margins included) whenever that changes.
 */
export function FilterBarSlot({
  onHeight,
  children,
}: {
  onHeight: (height: number) => void;
  children: ReactNode;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;
    // A slot that has no layout (hidden, or a test document) leaves the inset at its gap.
    const report = () => {
      if (slot.offsetHeight > 0) onHeight(slot.offsetHeight);
    };
    report();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(report);
    observer?.observe(slot);
    return () => observer?.disconnect();
  }, [onHeight]);
  return (
    <div ref={slotRef} className={overlay.Overview}>
      {children}
    </div>
  );
}

/** "[+all]" and "[-all]": a small bracketed toggle that unfolds or folds every long message. */
const expandAllToggleStyle: CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: toRem(12),
  // 16 px of text in a 1 px rim: 18 px tall, as thread-light.png shows it.
  lineHeight: toRem(16),
  padding: `0 ${config.space.S200}`,
  borderRadius: config.radii.Pill,
  border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
  color: color.Primary.Main,
  // Rows scroll beneath it under the thread banner, so it frosts them like the banner does.
  backgroundColor: `color-mix(in srgb, ${color.Surface.Container} 72%, transparent)`,
  backdropFilter: 'blur(3px)',
  WebkitBackdropFilter: 'blur(3px)',
};

type ExpandAllProps = {
  /** Every long message is unfolded now. */
  expanded: boolean;
  onToggle: (evt: MouseEvent<HTMLButtonElement>) => void;
};

function ExpandAllButton({ expanded, onToggle }: ExpandAllProps) {
  const { t } = useTranslation();
  return (
    <button type="button" style={expandAllToggleStyle} onClick={onToggle}>
      {expanded
        ? t('mindroomUi.threads.message-rendering.useTimelineMessageExpansion.all')
        : t('mindroomUi.threads.message-rendering.useTimelineMessageExpansion.all2')}
    </button>
  );
}

/** In the room, and in a thread without a banner, the toggle takes a line of its own above the rows. */
export function ExpandAllLine(props: ExpandAllProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: `${config.space.S100} ${config.space.S700} 0`,
      }}
    >
      <ExpandAllButton {...props} />
    </div>
  );
}

/**
 * Under a thread's banner the toggle hangs in the gap above the first row, 12 px below the
 * banner's edge (the banner's own 8 px margin plus 4), and ends above the first row, which a
 * reader at the top sees unobstructed.
 */
export function BannerExpandAllToggle(props: ExpandAllProps) {
  return (
    <div
      // Hover toolbars of the rows under it keep clear of it (hoverToolbarPlacement).
      data-timeline-overlay=""
      style={{
        position: 'absolute',
        top: config.space.S100,
        insetInlineEnd: config.space.S500,
        display: 'flex',
      }}
    >
      <ExpandAllButton {...props} />
    </div>
  );
}

/** What a thread shows above its rows while they load: a failure, Load older, or a spinner. */
export function ThreadLoadingLines({
  loadError,
  showLoadOlder,
  paginatingBack,
  loading,
  onLoadOlder,
}: {
  loadError: boolean;
  showLoadOlder: boolean;
  paginatingBack: boolean;
  loading: boolean;
  onLoadOlder: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {loadError && (
        <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
          <Text size="T300" priority="300">
            {t('mindroomUi.threads.mindroomRoomTimeline.failedToLoadThisThread')}
          </Text>
        </Box>
      )}
      {showLoadOlder && (
        <Box justifyContent="Center" style={{ padding: config.space.S200 }}>
          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            before={
              paginatingBack ? (
                <Spinner size="50" variant="Secondary" />
              ) : (
                <Icon size="50" src={Icons.ArrowTop} />
              )
            }
            onClick={onLoadOlder}
          >
            <Text size="L400">
              {paginatingBack
                ? t('mindroomUi.threads.mindroomRoomTimeline.loading')
                : t('mindroomUi.threads.mindroomRoomTimeline.loadOlderMessages')}
            </Text>
          </Chip>
        </Box>
      )}
      {loading && (
        <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
          <Spinner size="300" variant="Secondary" />
        </Box>
      )}
    </>
  );
}
