import { type Ref, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Text } from 'folds';
import { RoomDialogEmpty, RoomDialogFrame } from '../ui/RoomDialogOverlay';
import { revealDirectionControls } from '../ui/directional';
import { useOwnerMention } from '../messages/useOwnerMention';
import * as s from '../schedules/roomSchedules.css';
import { RoomTriggerRow } from './RoomTriggerRow';
import { TriggersIcon } from './TriggersIcon';
import type { RoomTrigger } from './roomTriggersApi';

type RoomTriggersDialogProps = {
  roomId: string;
  triggers: readonly RoomTrigger[];
  loading?: boolean;
  loadFailed?: boolean;
  highlightTriggerId?: string;
  onClose: () => void;
  onOpenThread: (threadId: string, targetRoomId?: string) => void;
  onToggleTrigger: (triggerId: string, enabled: boolean) => Promise<void>;
  onDeleteTrigger: (triggerId: string) => Promise<void>;
  ref?: Ref<HTMLDivElement>;
};

export function RoomTriggersDialog({
  roomId,
  triggers,
  loading = false,
  loadFailed = false,
  highlightTriggerId,
  onClose,
  onOpenThread,
  onToggleTrigger,
  onDeleteTrigger,
  ref,
}: RoomTriggersDialogProps) {
  const { t } = useTranslation();
  const renderOwner = useOwnerMention(roomId);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const highlightedRef = useRef<HTMLElement>(null);
  const focusedHighlightRef = useRef<string | undefined>(undefined);
  const [matchedHighlightId, setMatchedHighlightId] = useState<string | undefined>(undefined);
  const matched = Boolean(
    !loadFailed &&
    highlightTriggerId &&
    triggers.some((row) => row.triggerId === highlightTriggerId)
  );
  if (matched && matchedHighlightId !== highlightTriggerId) {
    setMatchedHighlightId(highlightTriggerId);
  } else if (!highlightTriggerId && matchedHighlightId !== undefined) {
    setMatchedHighlightId(undefined);
  }

  useLayoutEffect(() => {
    if (matched && focusedHighlightRef.current !== highlightTriggerId) {
      focusedHighlightRef.current = highlightTriggerId;
      highlightedRef.current?.scrollIntoView?.({ block: 'nearest' });
      highlightedRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!matched) focusedHighlightRef.current = undefined;
    const modal = modalRef.current;
    if (!modal || !modal.contains(modal.ownerDocument.activeElement)) {
      closeBtnRef.current?.focus({ preventScroll: true });
    }
  }, [highlightTriggerId, matched, loadFailed, triggers]);

  return (
    <RoomDialogFrame
      ref={ref}
      modalRef={modalRef}
      closeButtonRef={closeBtnRef}
      icon={TriggersIcon}
      title={t('roomTriggers.title')}
      count={!loadFailed && (!loading || triggers.length > 0) ? triggers.length : undefined}
      onClose={onClose}
    >
      {loadFailed ? (
        <RoomDialogEmpty role="alert" data-triggers-error="">
          <Text size="T300">{t('roomTriggers.loadError')}</Text>
        </RoomDialogEmpty>
      ) : (
        <>
          {highlightTriggerId &&
            !loading &&
            !matched &&
            matchedHighlightId !== highlightTriggerId && (
              <div role="status" className={s.NoticeBar} data-trigger-missing="">
                <Text size="T200">
                  {t('roomTriggers.missingTrigger', {
                    id: revealDirectionControls(highlightTriggerId),
                  })}
                </Text>
              </div>
            )}

          {triggers.length > 0 ? (
            <Box direction="Column" gap="200">
              {triggers.map((trigger) => (
                <RoomTriggerRow
                  key={trigger.triggerId}
                  trigger={trigger}
                  highlighted={trigger.triggerId === highlightTriggerId}
                  owner={
                    !trigger.canManage && trigger.ownerUserId
                      ? renderOwner(trigger.ownerUserId)
                      : undefined
                  }
                  articleRef={trigger.triggerId === highlightTriggerId ? highlightedRef : undefined}
                  onOpenThread={
                    trigger.targetThreadId
                      ? () =>
                          onOpenThread(trigger.targetThreadId!, trigger.targetRoomId ?? undefined)
                      : undefined
                  }
                  onToggle={() => onToggleTrigger(trigger.triggerId, !trigger.enabled)}
                  onDelete={() => onDeleteTrigger(trigger.triggerId)}
                />
              ))}
            </Box>
          ) : loading ? (
            <RoomDialogEmpty hint={t('roomTriggers.loading')} role="status" aria-busy />
          ) : (
            <RoomDialogEmpty title={t('roomTriggers.empty')} hint={t('roomTriggers.emptyHint')} />
          )}
        </>
      )}
    </RoomDialogFrame>
  );
}
