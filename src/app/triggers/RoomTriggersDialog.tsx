import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, Text } from 'folds';
import { localDigits } from '../lib/localDigits';
import { dateTimeFormat } from '../lib/time';
import { DialogCloseButton } from '../ui/DialogChrome';
import { revealDirectionControls } from '../ui/directional';
import { Header, Modal } from '../ui/glass/GlassPrimitives';
import { PageScroll } from '../ui/page/PageScroll';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { isUserId } from '../matrix/matrix';
import { getMatrixToUser } from '../matrix/matrix-to';
import { useMentionClickHandler } from '../messages/useMentionClickHandler';
import {
  makeMentionCustomProps,
  renderMatrixMention,
} from '../messages/html/react-custom-html-parser';
import * as schedCss from '../schedules/roomSchedules.css';
import { RoomTriggerRow } from './RoomTriggerRow';
import { TriggersIcon } from './TriggersIcon';
import type { RoomTrigger } from './roomTriggersApi';

export type RoomTriggersDialogProps = {
  roomId: string;
  triggers: readonly RoomTrigger[];
  loading?: boolean;
  highlightTriggerId?: string;
  /** Distinct object per open request so re-opening for the same trigger re-focuses it. */
  highlightRequest?: object;
  onClose: () => void;
  onOpenThread: (threadId: string, targetRoomId?: string) => void;
  onToggleTrigger: (triggerId: string, enabled: boolean) => Promise<void>;
  onDeleteTrigger: (triggerId: string) => Promise<void>;
};

export function RoomTriggersDialog({
  roomId,
  triggers,
  loading = false,
  highlightTriggerId,
  highlightRequest,
  onClose,
  onOpenThread,
  onToggleTrigger,
  onDeleteTrigger,
}: RoomTriggersDialogProps) {
  const { t, i18n } = useTranslation();
  const mx = useMatrixClient();
  const mentionClickHandler = useMentionClickHandler(roomId);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const highlightedNodeRef = useRef<HTMLElement | null>(null);
  const [deletedHighlightId, setDeletedHighlightId] = useState<string>();

  useEffect(() => setDeletedHighlightId(undefined), [highlightRequest, highlightTriggerId]);

  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const formatter = useMemo(
    () => dateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale]
  );

  const matchedHighlighted = Boolean(
    highlightTriggerId && triggers.some((row) => row.triggerId === highlightTriggerId)
  );
  const missingHighlighted = Boolean(
    highlightTriggerId &&
    !loading &&
    !matchedHighlighted &&
    deletedHighlightId !== highlightTriggerId
  );

  useLayoutEffect(() => {
    if (!matchedHighlighted) return;
    highlightedNodeRef.current?.scrollIntoView?.({ block: 'nearest' });
    highlightedNodeRef.current?.focus({ preventScroll: true });
  }, [highlightRequest, highlightTriggerId, matchedHighlighted]);

  useLayoutEffect(() => {
    const modal = dialogRef.current;
    if (!modal) return;
    const active = modal.ownerDocument.activeElement;
    if (active && active !== modal.ownerDocument.body) return;
    const fallback =
      (matchedHighlighted ? highlightedNodeRef.current : null) ??
      modal.querySelector<HTMLElement>('article[data-trigger-id]');
    (fallback ?? closeButtonRef.current)?.focus({ preventScroll: true });
  }, [matchedHighlighted, triggers.length]);

  const handleDelete = useCallback(
    async (triggerId: string) => {
      await onDeleteTrigger(triggerId);
      if (triggerId === highlightTriggerId) setDeletedHighlightId(triggerId);
    },
    [highlightTriggerId, onDeleteTrigger]
  );

  const renderOwner = (userId: string) =>
    isUserId(userId)
      ? renderMatrixMention(mx, roomId, getMatrixToUser(userId), {
          ...makeMentionCustomProps(mentionClickHandler),
          title: userId,
        })
      : undefined;
  const targetRoomLabel = (targetRoomId: string) => mx.getRoom(targetRoomId)?.name || targetRoomId;

  return (
    <Modal
      ref={dialogRef}
      size="400"
      flexHeight
      className={schedCss.Dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <PageScroll
        header={
          <Header size="500" className={schedCss.Header}>
            <Box grow="Yes" alignItems="Center" gap="200">
              <Icon size="200" src={TriggersIcon} />
              <Text as="h2" id={titleId} size="H4">
                {t('roomTriggers.title')}
              </Text>
              <span className={schedCss.HeaderCount}>
                {localDigits(String(triggers.length), locale)}
              </span>
            </Box>
            <DialogCloseButton
              ref={closeButtonRef}
              label={t('roomTriggers.close')}
              onClick={onClose}
            />
          </Header>
        }
      >
        <Box direction="Column" gap="300" className={schedCss.Content}>
          {missingHighlighted && highlightTriggerId && (
            <div role="status" className={schedCss.NoticeBar} data-trigger-missing="">
              <Text size="T200">
                {t('roomTriggers.missingTrigger', {
                  id: revealDirectionControls(highlightTriggerId),
                })}
              </Text>
            </div>
          )}

          {triggers.length === 0 ? (
            <Box direction="Column" gap="200" className={schedCss.Empty}>
              <Text size="T400">{t('roomTriggers.empty')}</Text>
              <Text size="T300" priority="300">
                {t('roomTriggers.emptyHint')}
              </Text>
            </Box>
          ) : (
            <Box direction="Column" gap="200">
              {triggers.map((trigger) => {
                const highlighted = trigger.triggerId === highlightTriggerId;
                return (
                  <RoomTriggerRow
                    key={trigger.triggerId}
                    roomId={roomId}
                    trigger={trigger}
                    highlighted={highlighted}
                    formatter={formatter}
                    renderOwner={renderOwner}
                    targetRoomLabel={targetRoomLabel}
                    articleRef={
                      highlighted
                        ? (node) => {
                            highlightedNodeRef.current = node;
                          }
                        : undefined
                    }
                    onOpenThread={onOpenThread}
                    onToggleTrigger={onToggleTrigger}
                    onDeleteTrigger={handleDelete}
                  />
                );
              })}
            </Box>
          )}
        </Box>
      </PageScroll>
    </Modal>
  );
}
