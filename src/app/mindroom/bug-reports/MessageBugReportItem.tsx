import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Icon, Icons, Text } from 'folds';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import * as css from '../../features/room/message/styles.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { saveFile } from '../native/nativeFileSave';
import { useBugReportAdmins } from './bugReportConfig';
import { buildBugReport, getBugReportFileName, serializeBugReport } from './bugReportPayload';
import { ensureBugReportRoom } from './bugReportRoom';
import { sendBugReport } from './sendBugReport';

type ReportState = 'idle' | 'sending' | 'failed' | 'sent';

type MessageBugReportItemProps = {
  room: Room;
  mEvent: MatrixEvent;
  onClose: () => void;
};

/**
 * "Report a bug" in a message's menu. With bug report admins configured in the homeserver's
 * well-known, the report (this message and the conversation around it) goes to a room with them
 * and its thread opens; without, the report downloads as a file.
 */
export function MessageBugReportItem({ room, mEvent, onClose }: MessageBugReportItemProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const admins = useBugReportAdmins();
  const { navigateRoomThread } = useRoomNavigate();
  const [state, setState] = useState<ReportState>('idle');
  const send = admins.length > 0;

  const handleClick = async () => {
    if (!send) {
      const report = await buildBugReport(mx, room, mEvent);
      await saveFile(serializeBugReport(report), getBugReportFileName(report));
      onClose();
      return;
    }
    setState('sending');
    let sent: { roomId: string; threadRootId: string };
    try {
      const report = await buildBugReport(mx, room, mEvent);
      const reportRoom = await ensureBugReportRoom(mx, admins);
      sent = await sendBugReport(mx, reportRoom, report);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[bug-report] could not send the bug report', error);
      setState('failed');
      return;
    }
    // Sent: a failure to open its thread must not offer to send it again.
    setState('sent');
    onClose();
    navigateRoomThread(sent.roomId, sent.threadRootId);
  };

  let label: string;
  if (state === 'sending') label = t('mindroomUi.messages.bugReport.sending');
  else if (state === 'failed') label = t('mindroomUi.messages.bugReport.failed');
  else if (send) label = t('mindroomUi.messages.bugReport.report');
  else label = t('mindroomUi.messages.bugReport.download');

  return (
    <MenuItem
      size="300"
      radii="300"
      after={<Icon size="100" src={Icons.Flag} />}
      disabled={state === 'sending' || state === 'sent'}
      onClick={handleClick}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        {label}
      </Text>
    </MenuItem>
  );
}
