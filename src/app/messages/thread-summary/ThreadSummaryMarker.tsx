import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Text, Tooltip, type RectCords } from 'folds';
import { PopOut, revealDirectionControls } from '../../ui/directional';
import { IconSparkles } from '@tabler/icons-react';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import type { ThreadSummaryMarkerPlan } from '../../event-store/threads/threadSummaryTimeline';
import * as css from './ThreadSummaryMarker.css';

type ThreadSummaryMarkerProps = {
  summaryInfo: ThreadSummaryInfo;
  plan?: ThreadSummaryMarkerPlan;
  /** Opens the room's title settings; with it the details card holds a link that calls it. */
  onOpenSettings?: () => void;
};

type OpenMode = 'hover' | 'pinned';

/** How long the details card stays after the pointer leaves the marker, so it can reach the card. */
export const MARKER_DETAILS_CLOSE_DELAY_MS = 150;

const within = (element: Element | null, target: EventTarget | null) =>
  !!element && target instanceof Node && element.contains(target);

// Inside a thread the banner already shows the current summary, so a summary
// event shrinks to one quiet line under the reply before it. Hovering it, or
// tapping it on a phone, shows the full title and the one it replaced. With
// `onOpenSettings` the details take the pointer and focus too, for their
// "Title settings…" link.
export function ThreadSummaryMarker({
  summaryInfo,
  plan,
  onOpenSettings,
}: ThreadSummaryMarkerProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  // A press in the card that moves focus nowhere (Safari does not focus a pressed button) blurs
  // the trigger without a related target; it must not close the card it landed in.
  const pressedCard = useRef(false);
  const [open, setOpen] = useState<{ mode: OpenMode; anchor: RectCords }>();
  const descriptionId = useId();
  const cardId = useId();
  const interactive = !!onOpenSettings;

  const cancelClose = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };
  const close = () => {
    cancelClose();
    pressedCard.current = false;
    setOpen(undefined);
  };
  const show = (mode: OpenMode) => {
    cancelClose();
    const trigger = triggerRef.current;
    if (trigger) setOpen({ mode, anchor: trigger.getBoundingClientRect() });
  };
  // The pointer left the marker or its card: a card it can enter waits for it a moment.
  const leave = (evt: PointerEvent) => {
    if (evt.pointerType !== 'mouse' || open?.mode !== 'hover') return;
    if (!interactive) {
      close();
      return;
    }
    cancelClose();
    closeTimer.current = setTimeout(close, MARKER_DETAILS_CLOSE_DELAY_MS);
  };
  const onFocusLeave = (evt: FocusEvent) => {
    const next = evt.relatedTarget;
    if (within(triggerRef.current, next) || within(cardRef.current, next)) return;
    if (pressedCard.current) return;
    close();
  };

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const isOpen = !!open;
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (evt: globalThis.KeyboardEvent) => {
      if (evt.key !== 'Escape') return;
      // Focus in the card would fall to the page once it is gone.
      if (within(cardRef.current, document.activeElement)) triggerRef.current?.focus();
      close();
    };
    const onPointerDown = (evt: Event) => {
      if (within(cardRef.current, evt.target)) return;
      if (!within(triggerRef.current, evt.target)) close();
    };
    // The details sit at a fixed spot; the timeline scrolls on its own as rows
    // arrive and settle, so they follow the marker instead of closing.
    const onScroll = () => {
      const trigger = triggerRef.current;
      if (trigger)
        setOpen((current) => current && { ...current, anchor: trigger.getBoundingClientRect() });
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
    // close only clears refs and state, the same on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  let label = t('mindroomUi.messages.mindroomThreadSummaryMarker.updated');
  if (summaryInfo.isManual) label = t('mindroomUi.messages.mindroomThreadSummaryMarker.edited');
  else if (plan?.first) label = t('mindroomUi.messages.mindroomThreadSummaryMarker.titled');

  let provenance = t('sharedUi.threadSummary.provenance');
  if (summaryInfo.isManual) provenance = t('sharedUi.threadSummary.manual');
  else if (typeof summaryInfo.messageCount === 'number')
    provenance = t('sharedUi.threadSummary.provenanceCount', { count: summaryInfo.messageCount });

  const previous = plan?.previousSummaryText && (
    <Trans
      t={t}
      shouldUnescape
      tOptions={{ interpolation: { escapeValue: true } }}
      i18nKey="mindroomUi.messages.mindroomThreadSummaryMarker.previous"
      values={{ summary: revealDirectionControls(plan.previousSummaryText) }}
      components={{ old: <s /> }}
    />
  );

  const details = (
    <div className={css.MarkerDetails} data-thread-summary-details="true">
      <Text size="T200" priority="300">
        {provenance}
      </Text>
      <Text size="T300">{revealDirectionControls(summaryInfo.summaryText ?? '')}</Text>
      {previous && (
        <Text size="T200" priority="300">
          {previous}
        </Text>
      )}
      {onOpenSettings && (
        <button
          ref={linkRef}
          type="button"
          className={css.MarkerSettingsLink}
          onClick={() => {
            close();
            onOpenSettings();
          }}
          onKeyDown={(evt: KeyboardEvent) => {
            if (evt.key !== 'Tab') return;
            // The card lives in the body; Tab goes on from the marker, where it opened.
            if (evt.shiftKey) evt.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          {t('mindroomUi.messages.mindroomThreadSummaryMarker.titleSettings')}
        </button>
      )}
    </div>
  );

  return (
    <div className={css.Marker}>
      <button
        ref={triggerRef}
        type="button"
        className={css.MarkerTrigger}
        aria-expanded={isOpen}
        aria-describedby={descriptionId}
        aria-haspopup={interactive ? 'dialog' : undefined}
        aria-controls={interactive && isOpen ? cardId : undefined}
        onPointerEnter={(evt: PointerEvent) => {
          if (evt.pointerType !== 'mouse') return;
          cancelClose();
          if (!open) show('hover');
        }}
        onPointerLeave={leave}
        onClick={() => (open?.mode === 'pinned' ? close() : show('pinned'))}
        onFocus={() => {
          pressedCard.current = false;
        }}
        onKeyDown={(evt: KeyboardEvent) => {
          // The card lives in the body, so Tab would skip it; send it to the card's link.
          if (evt.key !== 'Tab' || evt.shiftKey || !open || !linkRef.current) return;
          evt.preventDefault();
          linkRef.current.focus();
        }}
        onBlur={onFocusLeave}
      >
        <IconSparkles size={14} aria-hidden />
        <Text as="span" size="T200">
          {label}
        </Text>
      </button>
      <span id={descriptionId} hidden>
        {revealDirectionControls(summaryInfo.summaryText ?? '')} {previous}
      </span>
      {/* folds' PopOut layer covers the screen; it must let the pointer through
          to the marker and the timeline. The card inside, not the layer, has
          the role: on touch screens index.css hides tooltip layers in the body,
          and these details a tap opens. Without a link the card is a tooltip
          the pointer passes through; with one it is a small dialog that takes
          the pointer and focus. */}
      <PopOut
        style={{ pointerEvents: 'none' }}
        anchor={open?.anchor}
        position="Top"
        align="Start"
        offset={4}
        content={
          interactive ? (
            <Tooltip
              ref={cardRef}
              id={cardId}
              role="dialog"
              aria-label={label}
              style={{ pointerEvents: 'auto' }}
              onPointerEnter={(evt: PointerEvent) => {
                if (evt.pointerType === 'mouse') cancelClose();
              }}
              onPointerLeave={leave}
              onPointerDownCapture={() => {
                pressedCard.current = true;
              }}
              onFocus={() => {
                pressedCard.current = false;
              }}
              onBlur={onFocusLeave}
            >
              {details}
            </Tooltip>
          ) : (
            <Tooltip role="tooltip">{details}</Tooltip>
          )
        }
      />
    </div>
  );
}
