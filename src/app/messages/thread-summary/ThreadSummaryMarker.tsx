import { useId, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Text, Tooltip } from 'folds';
import { PopOut, revealDirectionControls } from '../../ui/directional';
import { useAnchoredCard } from '../../ui/useAnchoredCard';
import { IconSparkles } from '@tabler/icons-react';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import type { ThreadSummaryMarkerPlan } from '../../event-store/threads/threadSummaryTimeline';
import { OWNS_FOCUS_ATTRIBUTE } from '../../lib/overlayFocus';
import * as css from './ThreadSummaryMarker.css';

type ThreadSummaryMarkerProps = {
  summaryInfo: ThreadSummaryInfo;
  plan?: ThreadSummaryMarkerPlan;
  /** Opens the room's title settings; with it the details card holds a link that calls it. */
  onOpenSettings?: () => void;
};

/** How long the details card stays after the pointer leaves the marker, so it can reach the card. */
export const MARKER_DETAILS_CLOSE_DELAY_MS = 150;

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
  const interactive = !!onOpenSettings;
  const { open, triggerRef, cardRef, close, pin, toggle, hover, onFocusLeave } = useAnchoredCard(
    interactive ? MARKER_DETAILS_CLOSE_DELAY_MS : 0
  );
  const linkRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const cardId = useId();
  const isOpen = !!open;

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
        {...hover}
        onClick={toggle}
        onKeyDown={(evt: KeyboardEvent) => {
          // The card lives in the body, so Tab would skip it; send it to the card's link.
          if (evt.key !== 'Tab' || evt.shiftKey || !open || !linkRef.current) return;
          evt.preventDefault();
          pin();
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
          the pointer and focus. The marker moves that focus itself, so the
          app's overlay focus (lib/overlayFocus) must not move it into the
          link as the card opens, nor keep Tab inside it. */}
      <PopOut
        style={{ pointerEvents: 'none' }}
        {...(interactive && { [OWNS_FOCUS_ATTRIBUTE]: '' })}
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
              {...hover}
              // A press in the card keeps focus where it is (Safari focuses no pressed button,
              // so the marker would blur to nothing and close the card under the press).
              onMouseDown={(evt: MouseEvent) => evt.preventDefault()}
              onFocus={pin}
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
