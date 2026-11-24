import { forwardRef, useId, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, Text } from 'folds';
import { localDigits } from '../lib/localDigits';
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
import * as s from '../schedules/roomSchedules.css';
import { RoomTriggerRow } from './RoomTriggerRow';
import { TriggersIcon } from './TriggersIcon';
import type { RoomTrigger } from './roomTriggersApi';

export type RoomTriggersDialogProps = {
  roomId: string;
  triggers: readonly RoomTrigger[];
  loading?: boolean;
  loadFailed?: boolean;
  highlightTriggerId?: string;
  onClose: () => void;
  onOpenThread: (threadId: string, targetRoomId?: string) => void;
  onToggleTrigger: (triggerId: string, enabled: boolean) => Promise<void>;
  onDeleteTrigger: (triggerId: string) => Promise<void>;
};

export const RoomTriggersDialog = forwardRef<HTMLDivElement, RoomTriggersDialogProps>(
  function RoomTriggersDialog(props, ref) {
    const { roomId, triggers, loading = false, loadFailed = false, highlightTriggerId } = props;
    const { onClose, onOpenThread, onToggleTrigger, onDeleteTrigger } = props;
    const { t, i18n } = useTranslation();
    const mx = useMatrixClient();
    const mentionClickHandler = useMentionClickHandler(roomId);
    const titleId = useId();
    const highlightedRef = useRef<HTMLElement>(null);
    const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
    const matched = Boolean(
      highlightTriggerId && triggers.some((row) => row.triggerId === highlightTriggerId)
    );

    useLayoutEffect(() => {
      if (!matched) return;
      highlightedRef.current?.scrollIntoView?.({ block: 'nearest' });
      highlightedRef.current?.focus({ preventScroll: true });
    }, [highlightTriggerId, matched]);

    const renderOwner = (userId: string) =>
      isUserId(userId)
        ? renderMatrixMention(mx, roomId, getMatrixToUser(userId), {
            ...makeMentionCustomProps(mentionClickHandler),
            title: userId,
          })
        : undefined;

    return (
      <Modal
        ref={ref}
        size="400"
        flexHeight
        className={s.Dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <PageScroll
          header={
            <Header size="500" className={s.Header}>
              <Box grow="Yes" alignItems="Center" gap="200">
                <Icon size="200" src={TriggersIcon} />
                <Text as="h2" id={titleId} size="H4">
                  {t('roomTriggers.title')}
                </Text>
                {!loadFailed && (!loading || triggers.length > 0) && (
                  <span className={s.HeaderCount}>
                    {localDigits(String(triggers.length), locale)}
                  </span>
                )}
              </Box>
              <DialogCloseButton label={t('roomTriggers.close')} onClick={onClose} />
            </Header>
          }
        >
          <Box direction="Column" gap="300" className={s.Content}>
            {loadFailed ? (
              <Box
                direction="Column"
                gap="200"
                className={s.Empty}
                role="alert"
                data-triggers-error=""
              >
                <Text size="T300">{t('roomTriggers.loadError')}</Text>
              </Box>
            ) : (
              <>
                {highlightTriggerId && !loading && !matched && (
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
                            ? (renderOwner(trigger.ownerUserId) ?? trigger.ownerUserId)
                            : undefined
                        }
                        articleRef={
                          trigger.triggerId === highlightTriggerId ? highlightedRef : undefined
                        }
                        onOpenThread={
                          trigger.targetThreadId
                            ? () =>
                                onOpenThread(
                                  trigger.targetThreadId!,
                                  trigger.targetRoomId ?? undefined
                                )
                            : undefined
                        }
                        onToggle={() => onToggleTrigger(trigger.triggerId, !trigger.enabled)}
                        onDelete={() => onDeleteTrigger(trigger.triggerId)}
                      />
                    ))}
                  </Box>
                ) : (
                  !loading && (
                    <Box direction="Column" gap="200" className={s.Empty}>
                      <Text size="T400">{t('roomTriggers.empty')}</Text>
                      <Text size="T300" priority="300">
                        {t('roomTriggers.emptyHint')}
                      </Text>
                    </Box>
                  )
                )}
              </>
            )}
          </Box>
        </PageScroll>
      </Modal>
    );
  }
);
