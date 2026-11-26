import { Fragment, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Icon, Icons, Text } from 'folds';
import { IconFold } from '@tabler/icons-react';
import Linkify from 'linkify-react';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { EventType, MsgType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { AiRunErrorAction, AiRunErrorInfo, AiRunInfo } from '../../matrix/protocol/aiRun';
import { useOptionalMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { getMxIdLocalPart } from '../../matrix/matrix';
import { getMemberRawDisplayName } from '../../matrix/room';
import { discardFailedLocalEcho } from '../../matrix/protocol/pendingLocalEcho';
import { getMessageRelation } from '../../matrix/send/composeMessageRelation';
import { sanitizeText } from '../../rich-text/sanitize';
import { ownDirectionLine } from '../../ui/directional';
import * as css from './RunErrorCard.css';

export type RunErrorTone = 'warning' | 'danger';

const WARNING_ERROR_KINDS: ReadonlySet<string> = new Set([
  'stream_stalled',
  'provider_unavailable',
  'rate_limited',
  'timeout',
  'safeguard_refusal',
]);

const DANGER_ERROR_KINDS: ReadonlySet<string> = new Set([
  'context_window',
  'tokens_per_minute',
  'quota_exhausted',
  'missing_api_key',
  'authentication_failed',
  'runtime_error',
]);

const CHIP_LABEL_KEYS = {
  stream_stalled: 'mindroomUi.messages.runError.chips.streamStalled',
  provider_unavailable: 'mindroomUi.messages.runError.chips.providerUnavailable',
  rate_limited: 'mindroomUi.messages.runError.chips.rateLimited',
  timeout: 'mindroomUi.messages.runError.chips.timeout',
  context_window: 'mindroomUi.messages.runError.chips.contextWindow',
  tokens_per_minute: 'mindroomUi.messages.runError.chips.tokensPerMinute',
  safeguard_refusal: 'mindroomUi.messages.runError.chips.safeguardRefusal',
  quota_exhausted: 'mindroomUi.messages.runError.chips.quotaExhausted',
  missing_api_key: 'mindroomUi.messages.runError.chips.missingApiKey',
  authentication_failed: 'mindroomUi.messages.runError.chips.authenticationFailed',
  runtime_error: 'mindroomUi.messages.runError.chips.runtimeError',
} as const;

type KnownChipKind = keyof typeof CHIP_LABEL_KEYS;

// Kinds whose HTTP status code is clearer than a generic chip word when available.
const STATUS_CODE_CHIP_KINDS: ReadonlySet<string> = new Set([
  'provider_unavailable',
  'rate_limited',
  'timeout',
  'authentication_failed',
  'runtime_error',
]);

const ACTION_LABEL_KEYS = {
  continue: 'mindroomUi.messages.runError.actions.continue',
  retry: 'mindroomUi.messages.runError.actions.retry',
  compact: 'mindroomUi.messages.runError.actions.compact',
} as const satisfies Record<AiRunErrorAction, string>;

const RECEIPT_STATUS_KEYS = {
  continue: 'mindroomUi.messages.runError.receipt.continue',
  retry: 'mindroomUi.messages.runError.receipt.retry',
  compact: 'mindroomUi.messages.runError.receipt.compact',
} as const satisfies Record<AiRunErrorAction, string>;

const ACTION_PROMPTS: Record<Exclude<AiRunErrorAction, 'compact'>, string> = {
  continue: 'Continue.',
  retry: 'Please try again.',
};

type ActionState = { status: 'idle' } | { status: 'sending' | 'done'; action: AiRunErrorAction };

const hasFocusWithin = (element: HTMLElement | null): boolean =>
  document.activeElement instanceof Node && Boolean(element?.contains(document.activeElement));

export const getRunErrorTone = (error: AiRunErrorInfo): RunErrorTone => {
  if (WARNING_ERROR_KINDS.has(error.kind)) return 'warning';
  if (DANGER_ERROR_KINDS.has(error.kind)) return 'danger';
  return error.retryable ? 'warning' : 'danger';
};

export const getRunErrorChip = (error: AiRunErrorInfo, t: TFunction): string | undefined => {
  if (error.statusCode !== undefined && STATUS_CODE_CHIP_KINDS.has(error.kind)) {
    return String(error.statusCode);
  }
  if (error.kind in CHIP_LABEL_KEYS) {
    return t(CHIP_LABEL_KEYS[error.kind as KnownChipKind]);
  }
  return error.statusCode !== undefined ? String(error.statusCode) : undefined;
};

export const formatRunErrorCode = (error: AiRunErrorInfo): string | undefined => {
  const parts: string[] = [];
  if (error.statusCode !== undefined) parts.push(String(error.statusCode));
  if (error.code) parts.push(error.code);
  return parts.length > 0 ? parts.join(' · ') : undefined;
};

export const sendRunErrorAction = async (
  mx: MatrixClient,
  room: Room,
  threadId: string | undefined,
  action: AiRunErrorAction,
  agentUserId?: string
): Promise<void> => {
  const relation = getMessageRelation(undefined, undefined, threadId);
  let content: Record<string, unknown>;

  if (action === 'compact') {
    content = {
      msgtype: MsgType.Text,
      body: '/compact',
      ...(relation ? { 'm.relates_to': relation } : {}),
    };
  } else {
    if (!agentUserId) {
      throw new Error('Cannot mention agent without a sender user ID.');
    }
    const prompt = ACTION_PROMPTS[action];
    const agentName =
      getMemberRawDisplayName(room, agentUserId) ?? getMxIdLocalPart(agentUserId) ?? agentUserId;
    content = {
      msgtype: MsgType.Text,
      body: `${agentUserId} ${prompt}`,
      format: 'org.matrix.custom.html',
      formatted_body: `<a href="https://matrix.to/#/${encodeURIComponent(
        agentUserId
      )}">${sanitizeText(agentName)}</a> ${prompt}`,
      'm.mentions': { user_ids: [agentUserId] },
      ...(relation ? { 'm.relates_to': relation } : {}),
    };
  }

  const txnId = mx.makeTxnId();
  try {
    await mx.sendMessage(room.roomId, threadId ?? null, content as never, txnId);
  } catch (sendError) {
    discardFailedLocalEcho(mx, room.getEventForTxnId(txnId));
    throw sendError;
  }
};

type TechRow = readonly [label: string, value: string];

function TechDetailsList({ rows }: { rows: readonly TechRow[] }) {
  return (
    <dl className={css.TechBox}>
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className={css.TechKey}>{label}</dt>
          <dd className={css.TechValue}>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function ActionIcon({ action }: { action: AiRunErrorAction }) {
  if (action === 'continue') return <Icon size="50" src={Icons.Play} aria-hidden />;
  if (action === 'retry') return <Icon size="50" src={Icons.Reload} aria-hidden />;
  return <IconFold size={12} stroke={1.8} aria-hidden />;
}

export type RunErrorCardProps = {
  error: AiRunErrorInfo;
  aiRun?: AiRunInfo;
  mEvent?: MatrixEvent;
  roomId?: string;
  threadId?: string;
  readOnly?: boolean;
  linkifyOpts?: LinkifyOpts;
};

/**
 * Quiet Callout Card for failed MindRoom agent/team runs: clear title + chip + summary,
 * optional one-click Continue/Retry/Compact action, collapsible monospace technical details,
 * and a 1-line expandable receipt once the user triggers its recovery action.
 */
export function RunErrorCard({
  error,
  aiRun,
  mEvent,
  roomId,
  threadId,
  readOnly = false,
  linkifyOpts,
}: RunErrorCardProps) {
  const { t } = useTranslation();
  const mx = useOptionalMatrixClient();
  const room = mx && roomId ? mx.getRoom(roomId) : null;
  const viewerId = mx?.getUserId() ?? undefined;
  const senderId = mEvent?.getSender() ?? undefined;
  const targetThreadId = threadId ?? mEvent?.threadRootId;

  const [actionState, setActionState] = useState<ActionState>({ status: 'idle' });
  const [sendFailed, setSendFailed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const cardRef = useRef<HTMLElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const receiptButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<'receipt' | 'action' | null>(null);

  useLayoutEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    if (target === 'receipt' && actionState.status !== 'idle') {
      pendingFocusRef.current = null;
      receiptButtonRef.current?.focus({ preventScroll: true });
    } else if (target === 'action' && actionState.status === 'idle') {
      pendingFocusRef.current = null;
      actionButtonRef.current?.focus({ preventScroll: true });
    }
  }, [actionState]);

  const tone = getRunErrorTone(error);
  const chip = getRunErrorChip(error, t);
  const summaryContent = linkifyOpts ? (
    <Linkify options={linkifyOpts}>{error.summary}</Linkify>
  ) : (
    error.summary
  );

  const canSend =
    !readOnly &&
    !!mx &&
    !!room &&
    !!viewerId &&
    room.getMyMembership() === 'join' &&
    room.currentState.maySendEvent(EventType.RoomMessage, viewerId) &&
    (error.action === 'compact' || !!senderId);

  const modelId = aiRun?.modelId;
  const modelValue =
    modelId && aiRun.modelDisplayName && aiRun.modelDisplayName !== modelId
      ? `${modelId} (${aiRun.modelDisplayName})`
      : modelId;
  const hasTechDetails = Boolean(
    error.detail || error.code || error.statusCode !== undefined || error.provider || modelId
  );
  const providerValue = error.provider ?? (hasTechDetails ? aiRun?.modelProvider : undefined);
  const codeValue = formatRunErrorCode(error);

  const techRows: TechRow[] = [];
  if (modelValue) techRows.push([t('mindroomUi.messages.runError.details.model'), modelValue]);
  if (providerValue)
    techRows.push([t('mindroomUi.messages.runError.details.provider'), providerValue]);
  if (codeValue) techRows.push([t('mindroomUi.messages.runError.details.code'), codeValue]);
  if (error.detail) techRows.push([t('mindroomUi.messages.runError.details.detail'), error.detail]);

  const handleAction = (event: MouseEvent<HTMLButtonElement>) => {
    if (!error.action || !mx || !room || actionState.status !== 'idle') return;
    const clickedAction = error.action;
    const viaKeyboard = event.detail === 0;
    setSendFailed(false);
    pendingFocusRef.current = viaKeyboard ? 'receipt' : null;
    setActionState({ status: 'sending', action: clickedAction });
    void sendRunErrorAction(mx, room, targetThreadId, clickedAction, senderId)
      .then(() => {
        setActionState({ status: 'done', action: clickedAction });
      })
      .catch(() => {
        const shouldRestoreFocus = viaKeyboard && hasFocusWithin(cardRef.current);
        pendingFocusRef.current = shouldRestoreFocus ? 'action' : null;
        setReceiptOpen(false);
        setActionState({ status: 'idle' });
        setSendFailed(true);
      });
  };

  if (actionState.status !== 'idle') {
    return (
      <section
        ref={cardRef}
        className={css.Receipt}
        aria-label={t('mindroomUi.messages.runError.cardLabel')}
        data-run-error-card="resumed"
        data-tone={tone}
      >
        <button
          ref={receiptButtonRef}
          type="button"
          className={css.ReceiptButton}
          aria-expanded={receiptOpen}
          onClick={() => setReceiptOpen((open) => !open)}
        >
          <span className={css.ReceiptCheck} aria-hidden>
            <Icon size="50" src={Icons.Check} />
          </span>
          <span className={css.ReceiptStatus}>{t(RECEIPT_STATUS_KEYS[actionState.action])}</span>
          <span className={css.ReceiptSep} aria-hidden>
            ·
          </span>
          <span className={css.ReceiptTitle} {...ownDirectionLine}>
            {error.title}
          </span>
          <span className={css.ReceiptChevron} aria-hidden>
            <Icon size="50" src={receiptOpen ? Icons.ChevronTop : Icons.ChevronBottom} />
          </span>
        </button>
        {receiptOpen && (
          <div className={css.ReceiptBody}>
            <span className={css.Summary} {...ownDirectionLine}>
              {summaryContent}
            </span>
            {techRows.length > 0 && <TechDetailsList rows={techRows} />}
          </div>
        )}
      </section>
    );
  }

  const action = canSend ? error.action : undefined;
  const showFooter = Boolean(action || techRows.length > 0);

  return (
    <section
      ref={cardRef}
      className={css.Card[tone]}
      aria-label={t('mindroomUi.messages.runError.cardLabel')}
      data-run-error-card="open"
      data-tone={tone}
    >
      <div className={css.Top}>
        <span className={css.IconTile[tone]} aria-hidden>
          <Icon size="50" src={tone === 'warning' ? Icons.Warning : Icons.NoEntry} />
        </span>
        <div className={css.Copy}>
          <div className={css.TitleRow}>
            <span className={css.Title} {...ownDirectionLine}>
              {error.title}
            </span>
            {chip && <span className={css.Chip[tone]}>{chip}</span>}
          </div>
          <span className={css.Summary} {...ownDirectionLine}>
            {summaryContent}
          </span>
        </div>
      </div>

      {showFooter && (
        <div className={css.Footer}>
          {action && (
            <button
              ref={actionButtonRef}
              type="button"
              className={css.ActionButton}
              onClick={handleAction}
            >
              <ActionIcon action={action} />
              <span>{t(ACTION_LABEL_KEYS[action])}</span>
            </button>
          )}
          {techRows.length > 0 && (
            <button
              type="button"
              className={css.DetailsToggle}
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              <span>{t('mindroomUi.messages.runError.technicalDetails')}</span>
              <Icon
                size="50"
                src={detailsOpen ? Icons.ChevronTop : Icons.ChevronBottom}
                aria-hidden
              />
            </button>
          )}
        </div>
      )}

      {detailsOpen && techRows.length > 0 && (
        <div className={css.DetailsDrawer}>
          <TechDetailsList rows={techRows} />
        </div>
      )}

      {sendFailed && (
        <Text role="alert" size="T200" className={css.ErrorAlert}>
          {t('mindroomUi.messages.runError.sendFailed')}
        </Text>
      )}
    </section>
  );
}

/** Quiet horizontal seam replacing repeated or standalone service-restart interruption lines. */
export function RestartSeam({ count }: { count: number }) {
  const { t } = useTranslation();
  const label =
    count > 1
      ? t('mindroomUi.messages.runError.restartSeamRepeated', { times: count })
      : t('mindroomUi.messages.runError.restartSeam');
  return (
    <div className={css.RestartSeam} data-restart-seam={count}>
      <span className={css.RestartRuleStart} aria-hidden />
      <span className={css.RestartLabel}>{label}</span>
      <span className={css.RestartRuleEnd} aria-hidden />
    </div>
  );
}
