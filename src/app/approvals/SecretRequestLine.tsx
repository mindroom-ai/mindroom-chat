import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Icon, Icons } from 'folds';
import type { SecretRequest, SecretRequestStatus } from '../matrix/protocol/secretRequest';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { formatLifetime } from '../lib/time';
import { ActivityIcon, type ActivityTone } from '../ui/ThreadActivity';
import * as activityCss from '../ui/ThreadActivity.css';
import { IsolatedText } from '../ui/directional';
import {
  SecretRequestChip,
  SecretRequestDetails,
  findByAttribute,
  timelineOf,
} from './SecretRequestCard';
import * as css from './SecretRequestLine.css';

const STATUS_TONE = {
  pending: 'warning',
  saved: 'success',
  declined: 'critical',
  expired: 'neutral',
} as const satisfies Record<SecretRequestStatus, ActivityTone>;

/** What a request is called on its line: a key's service, a temporary secret's label or variable. */
function SecretName({ request, className }: { request: SecretRequest; className: string }) {
  if (request.kind === 'key') {
    return (
      <span className={className}>
        <IsolatedText text={request.displayName} />
      </span>
    );
  }
  return (
    <span className={classNames(className, !request.label && css.Mono)} dir="auto">
      {request.label ?? request.env}
    </span>
  );
}

/** What the line says after the name: what became of the request. */
const useLineStatus = (request: SecretRequest): string => {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { status } = request;
  if (status !== 'saved') return t(`mindroomUi.messages.secretRequestCard.status.${status}`);
  if (request.kind === 'key') return t('mindroomUi.messages.secretRequestCard.status.saved');
  const kept = request.kept ? request.keep[request.kept] : undefined;
  return kept === undefined
    ? t('mindroomUi.messages.secretRequestCard.temporary.sent')
    : t('mindroomUi.messages.secretRequestCard.line.sentKept', {
        duration: formatLifetime(kept, language),
      });
};

// A reply's closed fold of its tool calls (ToolCallsFold.tsx) or of its work (FinishedWorkFold.tsx).
const CLOSED_FOLD =
  '[data-tool-calls-fold] > [aria-expanded="false"], [data-work-fold][aria-expanded="false"]';

/**
 * A done secret request drawn in the agent's reply, at the tool call that asked
 * (inlineSecretRequests.ts), as a line of the reply's tool calls: a lock in the status's colour,
 * the secret's name and what became of it. The line opens the request read-only, and folds it
 * again. When the card's row went with the focus in it, the line takes it, and gives it back when
 * the line goes in turn.
 */
export function SecretRequestLine({
  lineRef,
  eventId,
  request,
  roomId,
  agentUserId,
}: {
  /** Receives the line's element, for the reply that draws it. */
  lineRef?: RefObject<HTMLDivElement>;
  /** The card's event, whose row hid. */
  eventId: string;
  request: SecretRequest;
  roomId: string;
  agentUserId: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const temporary = request.kind === 'temporary';
  const { status } = request;
  const detail = useLineStatus(request);
  // The line goes when the reply stops showing its call: its calls hide (cog closed: the card's
  // row stays hidden), or its work folds or a newer frame leaves the call out (the row comes
  // back). Focus in the line moves to the line if it is drawn again, else to the card, else to
  // the closed fold of the reply, else to the reply, all in the line's own timeline.
  const ownRef = useRef<HTMLDivElement>(null);
  const line = lineRef ?? ownRef;
  useLayoutEffect(() => {
    const node = line.current;
    const timeline = timelineOf(node);
    const reply = node?.closest<HTMLElement>('[data-message-id]');
    return () => {
      if (!node?.contains(document.activeElement)) return;
      // Once the commits that took the line and drew the row are done, if the focus went with it.
      queueMicrotask(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        const card = findByAttribute(timeline, 'data-secret-request-card', eventId);
        (
          findByAttribute(timeline, 'data-secret-request-for', eventId) ??
          card?.querySelector('summary') ??
          card ??
          reply?.querySelector<HTMLElement>(CLOSED_FOLD) ??
          reply
        )?.focus({ preventScroll: true });
      });
    };
  }, [eventId, line]);
  return (
    // Keeps the interface's direction in a message that reads the other way (index.css).
    <div
      ref={line}
      className={activityCss.Activity}
      data-message-disclosure=""
      data-secret-request-line={status}
      role="group"
      aria-label={t(
        temporary
          ? 'mindroomUi.messages.secretRequestCard.temporary.label'
          : 'mindroomUi.messages.secretRequestCard.label'
      )}
    >
      <button
        type="button"
        // Where the focus goes when the card's row goes with it (SecretRequestCard.tsx).
        data-secret-request-for={eventId}
        className={activityCss.Line}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => setExpanded((value) => !value)}
      >
        <ActivityIcon src={Icons.Lock} tone={STATUS_TONE[status]} />
        <SecretName request={request} className={activityCss.Title} />
        <span className={activityCss.Detail}>{detail}</span>
        <Icon size="50" className={activityCss.Chevron} src={Icons.ChevronRight} aria-hidden />
      </button>
      {expanded && (
        <div id={panelId} className={css.Card} data-secret-request-receipt="">
          <div className={css.Header}>
            <Icon size="100" src={Icons.Lock} aria-hidden />
            <SecretName request={request} className={css.HeaderName} />
            <SecretRequestChip chip={status} temporary={temporary} />
          </div>
          <SecretRequestDetails
            request={request}
            status={status}
            roomId={roomId}
            agentUserId={agentUserId}
          />
        </div>
      )}
    </div>
  );
}
