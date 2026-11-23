import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Chip, Icon, Icons, Spinner, Text, color, config, toRem, type IconSrc } from 'folds';
import * as css from './RoomTimeline.css';
import * as overlay from '../ui/styles/RoomOverlay.css';

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

/** A pagination sentinel at the top of the virtual list, where its first row is, taking no place. */
export const listTopSentinelStyle: CSSProperties = {
  position: 'absolute',
  insetBlockStart: 0,
  insetInline: 0,
  height: 1,
  pointerEvents: 'none',
};

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
      className={css.FloatingAction}
      onClick={onSelect}
      variant={primary ? 'Primary' : 'SurfaceVariant'}
      outlined
      radii="Pill"
      before={<Icon src={icon} size="50" />}
    >
      <Text size="L400" style={{ textWrap: 'balance' }}>
        {label}
      </Text>
    </Chip>
  );
}

/**
 * Jump to Latest, above the composer, while the reader is away from the rows' latest end; its
 * arrow points there: down, or `up` when the newest row is the first.
 */
export function JumpToLatestAction({
  onSelect,
  up = false,
}: {
  onSelect: () => void;
  up?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={css.TimelineFloat({ position: 'Bottom' })}
      style={{ bottom: `calc(${overlay.footerInset} + ${config.space.S400})` }}
    >
      <FloatingAction
        icon={up ? Icons.ArrowTop : Icons.ArrowBottom}
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
  // Holds the layer that paints the pill behind the text (css.ExpandAllToggle).
  position: 'relative',
  isolation: 'isolate',
  cursor: 'pointer',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: toRem(12),
  // 16 px of text in a 1 px rim: 18 px tall, as thread-light.png shows it.
  lineHeight: toRem(16),
  padding: `0 ${config.space.S200}`,
  border: '1px solid transparent',
  color: color.Primary.Main,
};

type ExpandAllProps = {
  /** Every long message is unfolded now. */
  expanded: boolean;
  onToggle: (evt: MouseEvent<HTMLButtonElement>) => void;
};

function ExpandAllButton({ expanded, onToggle }: ExpandAllProps) {
  const { t } = useTranslation();
  // The token reads as code; its name says what it does.
  const label = expanded
    ? t('mindroomUi.threads.mindroomRoomTimeline.collapseAllLong')
    : t('mindroomUi.threads.mindroomRoomTimeline.expandAllLong');
  const token = expanded
    ? t('mindroomUi.threads.message-rendering.useTimelineMessageExpansion.all')
    : t('mindroomUi.threads.message-rendering.useTimelineMessageExpansion.all2');
  // The name holds the word on the button, so speech control finds the button by it; a language
  // whose label does not use that word hears the token after the label.
  const word = token.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
  const name = label.toLocaleLowerCase().includes(word) ? label : `${label} ${token}`;
  return (
    // A token such as [+all], not a sentence: it keeps its order in a right-to-left interface.
    <button
      type="button"
      className={css.ExpandAllToggle}
      style={expandAllToggleStyle}
      onClick={onToggle}
      aria-label={name}
      title={label}
      dir="ltr"
    >
      {token}
    </button>
  );
}

/**
 * The toggle takes a line of its own above the room's rows (a thread has none) and scrolls away
 * with them, so it never covers one. It sits at the line's end; `atStart` moves it to the line's
 * start, in the column a phone's unread pills keep clear (`EXPAND_ALL_START_COLUMN`), without
 * changing the line's height.
 */
export function ExpandAllLine({
  atStart = false,
  ...props
}: ExpandAllProps & { atStart?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: atStart ? 'flex-start' : 'flex-end',
        paddingBlockStart: config.space.S100,
        // At the start, in line with the avatars of the rows below.
        paddingInlineStart: atStart ? config.space.S400 : config.space.S700,
        paddingInlineEnd: config.space.S700,
      }}
    >
      {/* The hover toolbar of the row below keeps clear of it (hoverToolbarPlacement). */}
      <div data-timeline-overlay="" style={{ display: 'flex' }}>
        <ExpandAllButton {...props} />
      </div>
    </div>
  );
}

/**
 * How far from the timeline's start edge "[+all]" reaches when it sits at its line's start: the
 * line's inset, the toggle (62 px for "[+all]", a little more in scripts with wider letters), and
 * a gap before the unread pills.
 */
export const EXPAND_ALL_START_COLUMN = `calc(${config.space.S400} + ${toRem(68)} + ${
  config.space.S200
})`;

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

const SKELETON_ROWS = [
  { nameW: "24%", line1W: "76%", line2W: "52%" },
  { nameW: "18%", line1W: "64%", line2W: "82%" },
  { nameW: "28%", line1W: "72%", line2W: "44%" },
  { nameW: "22%", line1W: "80%", line2W: "60%" },
  { nameW: "20%", line1W: "68%", line2W: "48%" },
  { nameW: "26%", line1W: "74%", line2W: "56%" },
  { nameW: "19%", line1W: "62%", line2W: "70%" },
  { nameW: "25%", line1W: "78%", line2W: "40%" },
] as const;

/**
 * Occupies the positive headroom reserve above row 0 with the existing loading lines
 * plus sticky skeleton placeholders so landing anywhere inside the reserve (Home,
 * thumb drag, long flick) never displays pure blank space.
 */
export function ThreadHeadroomReserve({
  headroomPx,
  topInset,
  showLoadOlder,
  paginatingBack,
  loading,
}: {
  headroomPx: number;
  topInset: string;
  showLoadOlder: boolean;
  paginatingBack: boolean;
  loading: boolean;
}) {
  const { t } = useTranslation();
  if (headroomPx <= 0) return null;
  const rounded = Math.round(headroomPx);
  return (
    <div
      data-testid="thread-headroom-reserve"
      data-headroom-px={rounded}
      aria-busy={showLoadOlder || paginatingBack || loading || undefined}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: headroomPx,
        pointerEvents: "none",
      }}
    >
      <div
        data-headroom-skeleton="true"
        style={{
          position: "sticky",
          top: topInset,
          maxHeight: "100%",
          minHeight: `min(${rounded}px, 100vh)`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          gap: config.space.S300,
          padding: `${config.space.S400} ${config.space.S400}`,
          boxSizing: "border-box",
        }}
      >
        {(showLoadOlder || paginatingBack || loading) && (
          <Box justifyContent="Center" alignItems="Center" gap="200" style={{ padding: config.space.S200 }}>
            <Spinner size="50" variant="Secondary" />
            <Text size="L400" priority="300">
              {t("mindroomUi.threads.mindroomRoomTimeline.loading")}
            </Text>
          </Box>
        )}
        {SKELETON_ROWS.map((row, idx) => (
          <div
            key={idx}
            aria-hidden="true"
            data-headroom-skeleton-row="true"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: config.space.S300,
              padding: `${config.space.S200} 0`,
              opacity: 0.45,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                flexShrink: 0,
                background: "var(--bg-surface-hover, rgba(128, 128, 128, 0.22))",
              }}
            />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  width: row.nameW,
                  height: 12,
                  borderRadius: 6,
                  background: "var(--bg-surface-hover, rgba(128, 128, 128, 0.25))",
                }}
              />
              <div
                style={{
                  width: row.line1W,
                  height: 14,
                  borderRadius: 6,
                  background: "var(--bg-surface-hover, rgba(128, 128, 128, 0.2))",
                }}
              />
              <div
                style={{
                  width: row.line2W,
                  height: 14,
                  borderRadius: 6,
                  background: "var(--bg-surface-hover, rgba(128, 128, 128, 0.16))",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
