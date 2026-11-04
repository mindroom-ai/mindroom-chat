import { useState } from 'react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { useBugReportAdmins } from './bugReportConfig';
import { buildBugReport, getBugReportFileName, serializeBugReport } from './bugReportPayload';
import { ensureBugReportRoom } from './bugReportRoom';
import { sendBugReport } from './sendBugReport';
import { saveFile } from '../native/nativeFileSave';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { MenuEntry } from '../../components/MenuEntry';

/** `busy` while the report is on its way, `done` once the admins have it. */
type Phase = 'ready' | 'busy' | 'error' | 'done';

/**
 * "Report a bug" in a message's menu. With bug report admins configured in the homeserver's
 * well-known, the report (this message and the conversation around it) goes to a room with them
 * and its thread opens; without, the report downloads as a file.
 */
export function MessageBugReportItem(props: {
  room: Room;
  mEvent: MatrixEvent;
  onClose: () => void;
}) {
  const { room, mEvent, onClose } = props;
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { navigateRoomThread } = useRoomNavigate();
  const admins = useBugReportAdmins();
  const [phase, setPhase] = useState<Phase>('ready');
  const delivers = admins.length > 0;

  const download = async (): Promise<void> => {
    const report = await buildBugReport(mx, room, mEvent);
    await saveFile(serializeBugReport(report), getBugReportFileName(report));
    onClose();
  };

  const deliver = async (): Promise<void> => {
    setPhase('busy');
    const target = await buildBugReport(mx, room, mEvent)
      .then(async (report) => sendBugReport(mx, await ensureBugReportRoom(mx, admins), report))
      .catch((reason: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[bug-report] could not send the bug report', reason);
        return undefined;
      });
    if (target === undefined) {
      setPhase('error');
      return;
    }
    // Delivered: if its thread then fails to open, the item must not offer a second send.
    setPhase('done');
    onClose();
    navigateRoomThread(target.roomId, target.threadRootId);
  };

  const idleKey = delivers
    ? ('mindroomUi.messages.bugReport.report' as const)
    : ('mindroomUi.messages.bugReport.download' as const);
  const phaseKeys = {
    ready: idleKey,
    busy: 'mindroomUi.messages.bugReport.sending',
    error: 'mindroomUi.messages.bugReport.failed',
    done: idleKey,
  } as const satisfies Record<Phase, string>;

  return (
    <MenuEntry
      label={t(phaseKeys[phase])}
      icon={Icons.Flag}
      disabled={phase === 'busy' || phase === 'done'}
      // The click handler keeps the report's promise as its result for the Lane P tests that
      // await it; a click ignores it.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSelect={delivers ? deliver : download}
    />
  );
}
