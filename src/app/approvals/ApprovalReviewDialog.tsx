import { useTranslation } from 'react-i18next';
import React, { useEffect, useId, useRef, useState } from 'react';
import { FocusTrap } from 'focus-trap-react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
} from 'folds';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { groupApprovalRecords, ThreadApprovalRecord } from '../matrix/protocol/threadApprovalModel';
import { getToolApprovalOperationLabel } from '../matrix/protocol/toolApproval';
import { IsolatedText } from '../ui/directional';
import { Dialog, Header } from '../ui/glass/GlassPrimitives';
import { useGlassHighlight } from '../ui/glass/liquid/useLiquidGlass';
import { PageScroll } from '../ui/page/PageScroll';
import { glassDenseOverBackdrop } from '../ui/styles/Glass.css';
import { LoneTouchTarget } from '../ui/styles/TouchTarget.css';
import { getApprovalCapabilities } from './approvalActions';
import { ApprovalArgumentFields } from './ApprovalArgumentFields';
import { describeApprovalChip, describeReviewHeader } from './approvalLabels';
import {
  agentDisplayName,
  type ApprovalMemberRoom,
  useApprovalRoom,
  userDisplayName,
} from './approvalPeople';
import { ApprovalReviewCall } from './ApprovalReviewCall';
import { formatApprovalTime, formatExpiryDistance } from './approvalScheduleText';
import {
  ApprovalAgentAvatar,
  ApprovalDurations,
  ApprovalMeta,
  ApprovalSectionHeader,
} from './ApprovalSection';
import { mergeArgumentFields } from './argumentFields';
import { useThreadApprovals } from './ThreadApprovalProvider';
import * as css from './ThreadApprovals.css';

export function ApprovalDialog({
  title,
  subtitle,
  leading,
  onClose,
  children,
  returnFocus,
  fallbackFocus,
}: {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  returnFocus: React.RefObject<HTMLElement | null>;
  fallbackFocus?: () => void;
}) {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fallbackRef = useRef<(() => void) | undefined>(undefined);
  fallbackRef.current = fallbackFocus ?? context?.focusConversation;
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            setReturnFocus: () => (returnFocus.current?.isConnected ? returnFocus.current : false),
            onDeactivate: () => onCloseRef.current(),
            onPostDeactivate: () => {
              if (!returnFocus.current?.isConnected) fallbackRef.current?.();
            },
            clickOutsideDeactivates: true,
          }}
        >
          <Dialog
            className={glassDenseOverBackdrop}
            variant="Background"
            role="dialog"
            aria-modal="true"
            style={{ width: '40rem', maxWidth: 'calc(100vw - 24px)' }}
            aria-labelledby={titleId}
          >
            <PageScroll
              className={css.DialogScroll}
              header={
                <Header
                  size={subtitle ? '600' : '500'}
                  variant="Surface"
                  style={{ padding: '0 12px' }}
                >
                  <Box grow="Yes" alignItems="Center" gap="300">
                    {leading}
                    <Box direction="Column" className={css.DialogHeading}>
                      <Text id={titleId} size={subtitle ? 'H5' : 'H4'}>
                        <IsolatedText text={title} />
                      </Text>
                      {subtitle && (
                        <Text size="T200" priority="300">
                          <IsolatedText text={subtitle} />
                        </Text>
                      )}
                    </Box>
                  </Box>
                  <IconButton
                    size="300"
                    className={LoneTouchTarget}
                    aria-label={t('mindroomUi.messages.threadApprovalControls.close')}
                    onClick={onClose}
                  >
                    <Icon src={Icons.Cross} />
                  </IconButton>
                </Header>
              }
            >
              <div className={css.DialogBody}>{children}</div>
            </PageScroll>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function ApprovalGroup({
  children,
  flat = false,
}: {
  children: React.ReactNode;
  flat?: boolean;
}) {
  const glassRef = useGlassHighlight<HTMLElement>(undefined, !flat);
  return (
    <section ref={glassRef} className={flat ? css.Section : css.Group}>
      {children}
    </section>
  );
}

export function ApprovalReviewGroup({
  records,
  flat = false,
  showMeta = true,
}: {
  records: readonly ThreadApprovalRecord[];
  flat?: boolean;
  /** The review sheet names the agent and requester once in its header. */
  showMeta?: boolean;
}) {
  const { t } = useTranslation();
  const context = useThreadApprovals();
  const user = useMatrixClient().getUserId();
  const room = useApprovalRoom();
  const [reason, setReason] = useState('');
  const [denyingAll, setDenyingAll] = useState(false);
  const reasonInput = useRef<HTMLInputElement>(null);
  const callsId = useId();
  const records0 = records[0];
  const availableCount = context
    ? records.filter(
        (record) =>
          getApprovalCapabilities(record, user, context.actions.get(record.eventId), context.now)
            .deny && record.approval.approvable
      ).length
    : 0;
  // Bulk approval stands in for the calls; without it, each call needs its own controls.
  const [showCalls, setShowCalls] = useState(availableCount <= 1);
  useEffect(() => {
    if (denyingAll) reasonInput.current?.focus();
  }, [denyingAll]);
  if (!context || !records0) return null;
  const { approval } = records0;
  const available = records.filter(
    (record) =>
      getApprovalCapabilities(record, user, context.actions.get(record.eventId), context.now).deny
  );
  const approvable = available.filter((record) => record.approval.approvable);
  const timed =
    approval.approverUserId === user && approval.scope && approvable.length === available.length
      ? approval.autoApproveOptions.filter((duration) =>
          approvable.every((record) =>
            getApprovalCapabilities(
              record,
              user,
              context.actions.get(record.eventId),
              context.now
            ).durations.includes(duration)
          )
        )
      : [];
  const chip = describeApprovalChip(records, context.actions, context.now, available.length > 0);
  // Bulk actions stand in for the calls; once they no longer apply, list every call.
  const bulk = available.length > 1;
  const single = records.length === 1;
  const callsListed = single || !bulk || showCalls;
  const calls = records.map((record, index) => (
    <ApprovalReviewCall
      key={record.eventId}
      record={record}
      index={index}
      single={single}
      offersDurations={timed.length > 0}
      userId={user}
      action={context.actions.get(record.eventId)}
      now={context.now}
      submit={context.submit}
    />
  ));
  return (
    <ApprovalGroup flat={flat}>
      <ApprovalSectionHeader
        operation={getToolApprovalOperationLabel(approval)}
        count={records.length}
        chip={chip}
      />
      <div className={css.SectionBody}>
        {showMeta && <ApprovalMeta approval={approval} room={room} viewerId={user} />}
        {single || !bulk ? (
          calls
        ) : (
          <>
            {!showCalls && (
              <ApprovalArgumentFields
                value={records.map((record) => record.approval.arguments)}
                limit={3}
                parse={mergeArgumentFields}
              />
            )}
            <Button
              type="button"
              size="300"
              variant="Secondary"
              fill="Soft"
              radii="300"
              className={css.CallsToggle}
              aria-expanded={showCalls}
              aria-controls={callsId}
              onClick={() => setShowCalls((value) => !value)}
              before={<Icon size="50" src={showCalls ? Icons.ChevronTop : Icons.ChevronBottom} />}
              outlined
            >
              <Text size="B300">
                {showCalls
                  ? t('mindroomUi.messages.threadApprovalControls.hideCalls')
                  : t('mindroomUi.messages.threadApprovalControls.showCalls', {
                      count: records.length,
                    })}
              </Text>
            </Button>
            {showCalls && <div id={callsId}>{calls}</div>}
          </>
        )}
        {bulk && !denyingAll && (
          <div className={css.Actions}>
            {approvable.length > 1 && (
              <Button
                size="300"
                variant="Primary"
                fill="Soft"
                onClick={() => {
                  approvable.forEach((record) => {
                    void context.submit(record, { status: 'approved' });
                  });
                }}
                outlined
                radii="300"
              >
                <Text size="B300">
                  {t('mindroomUi.messages.threadApprovalControls.approveAllOnce', {
                    count: approvable.length,
                  })}
                </Text>
              </Button>
            )}
            <Button
              size="300"
              variant="Critical"
              fill="Soft"
              onClick={() => setDenyingAll(true)}
              outlined
              radii="300"
            >
              <Text size="B300">
                {t('mindroomUi.messages.threadApprovalControls.denyAll', {
                  count: available.length,
                })}
              </Text>
            </Button>
          </div>
        )}
        {bulk && denyingAll && (
          <form
            className={css.DenyRow}
            onSubmit={(event) => {
              event.preventDefault();
              available.forEach((record) => {
                void context.submit(record, { status: 'denied', reason });
              });
              setDenyingAll(false);
              setReason('');
            }}
          >
            <Input
              ref={reasonInput}
              aria-label={t(
                'mindroomUi.messages.threadApprovalControls.reasonForDenyingAllOptional'
              )}
              placeholder={t('mindroomUi.messages.approvalDecisionControls.denialReasonOptional')}
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            <div className={css.Actions}>
              <Button type="submit" size="300" variant="Critical" fill="Soft" outlined radii="300">
                <Text size="B300">
                  {t('mindroomUi.messages.threadApprovalControls.confirmDenyAll', {
                    count: available.length,
                  })}
                </Text>
              </Button>
              <Button
                type="button"
                size="300"
                variant="Secondary"
                fill="Soft"
                outlined
                onClick={() => {
                  setDenyingAll(false);
                  setReason('');
                }}
                radii="300"
              >
                <Text size="B300">{t('mindroomUi.messages.approvalDecisionControls.cancel')}</Text>
              </Button>
            </div>
          </form>
        )}
        <ApprovalDurations
          durations={bulk && denyingAll ? [] : timed}
          disabled={approvable.length === 0}
          onPick={(duration) => {
            if (approvable[0]) void context.submit(approvable[0], { status: 'approved', duration });
          }}
          accessibleLabel={(duration) =>
            t('mindroomUi.messages.threadApprovalControls.allowForMinutes', {
              count: duration / 60,
            })
          }
          explanation={t(
            'mindroomUi.messages.threadApprovalControls.allowThisOperationForThisThreadRequesterAndAgentArguments'
          )}
        />
        {/* A listed call says this itself. */}
        {!callsListed &&
          records.some(
            (record) =>
              context.actions.get(record.eventId)?.status === 'submitted' &&
              context.pendingEventIds.has(record.eventId)
          ) && (
            <small role="status">
              {t('mindroomUi.messages.threadApprovalControls.submittedWaitingForRoomUpdate')}
            </small>
          )}
      </div>
    </ApprovalGroup>
  );
}

export const HISTORY_ERROR_KEYS = {
  unavailable: 'mindroomUi.messages.threadApprovalControls.historyErrors.unavailable',
  undecryptable: 'mindroomUi.messages.threadApprovalControls.historyErrors.undecryptable',
  unloadable: 'mindroomUi.messages.threadApprovalControls.historyErrors.unloadable',
} as const;

export function ApprovalReviewDialog({
  room,
  eventIds,
  onClose,
  returnFocus,
  fallbackFocus,
  children,
}: {
  room: ApprovalMemberRoom | null | undefined;
  eventIds?: readonly string[];
  onClose: () => void;
  returnFocus: React.RefObject<HTMLElement | null>;
  fallbackFocus?: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const context = useThreadApprovals();
  const user = useMatrixClient().getUserId();
  if (!context) return null;
  const reviewGroups = eventIds
    ? groupApprovalRecords(
        eventIds.flatMap((id) => context.records.find((record) => record.eventId === id) ?? [])
      )
    : [];
  const review = describeReviewHeader(reviewGroups.flat(), user);
  const reviewTitle =
    review.agents.length === 1
      ? t('mindroomUi.messages.threadApprovalControls.reviewAgentWants', {
          agent: agentDisplayName(room, review.agents[0]!),
          count: review.count,
        })
      : review.agents.length > 1
        ? t('mindroomUi.messages.threadApprovalControls.reviewAgentsWant', {
            agents: review.agents.length,
            count: review.count,
          })
        : t('mindroomUi.messages.threadApprovalControls.reviewToolCalls');
  const reviewSubtitle = [
    review.requester &&
      t('mindroomUi.messages.threadApprovalControls.reviewRequestedBy', {
        requester:
          review.requester === 'you'
            ? t('mindroomUi.messages.threadApprovalControls.you')
            : userDisplayName(room, review.requester),
      }),
    review.expiresAt &&
      t('mindroomUi.messages.threadApprovalControls.expires', {
        time:
          formatExpiryDistance(review.expiresAt, Date.now(), language) ??
          formatApprovalTime(review.expiresAt, language),
      }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ApprovalDialog
      title={reviewTitle}
      subtitle={reviewSubtitle || undefined}
      leading={
        review.agents.length === 1 ? (
          <ApprovalAgentAvatar room={room} agentName={review.agents[0]!} size="300" />
        ) : undefined
      }
      onClose={onClose}
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
    >
      {eventIds ? (
        <>
          {reviewGroups.map((records) => (
            <ApprovalReviewGroup
              key={records[0]!.eventId}
              records={records}
              flat
              showMeta={review.agents.length > 1 || review.requester === null}
            />
          ))}
          {eventIds.some((id) => !context.records.some((record) => record.eventId === id)) && (
            <p>
              {t('mindroomUi.messages.threadApprovalControls.someRequestsAreNoLongerAvailable')}
            </p>
          )}
        </>
      ) : (
        children
      )}
    </ApprovalDialog>
  );
}
