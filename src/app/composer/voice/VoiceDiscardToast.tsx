import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue, useStore } from 'jotai';
import { Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { pageNoticeSlotAtom } from '../../ui/noticeSlots';
import { PageSlot } from '../../ui/noticeSlots.css';
import { Surface } from '../../ui/glass/GlassPrimitives';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { discardedVoiceDraftsAtom } from '../roomInputDrafts';
import { keepRecoveringVoiceDrafts, undoVoiceDiscard } from './voiceDrafts';
import * as css from './VoiceDiscardToast.css';

/**
 * Says that a voice recording of this account was discarded and offers Undo, in the page's notice
 * place, until the discard stands (`VOICE_DISCARD_UNDO_MS`). Mounted once for the signed-in app,
 * so it outlives the composer the recording was discarded in; the recordings a crash, a reload
 * or an app update left on disk are brought back from here for the same reason.
 */
export function VoiceDiscardToast() {
  const { t } = useTranslation();
  const store = useStore();
  const mx = useMatrixClient();
  const userId = mx.getUserId();
  useEffect(() => keepRecoveringVoiceDrafts(mx, store), [mx, store]);
  // The last one of several: Undo brings that back, and then offers the one before.
  const discarded = useAtomValue(discardedVoiceDraftsAtom).findLast(
    (entry) => entry.draft.context.ownerSessionId === userId
  );
  const pageSlot = useAtomValue(pageNoticeSlotAtom);

  if (!discarded) return null;
  const toast = (
    <Surface className={css.Toast} variant="Surface" data-testid="voice-discard-toast">
      <Text as="span" size="T300">
        {discarded.failed ? t('composer.voiceUndoFailed') : t('composer.voiceDiscarded')}
      </Text>
      <Button
        size="300"
        variant="Secondary"
        fill="Soft"
        radii="Pill"
        onClick={() => void undoVoiceDiscard(store, discarded.draft.recordingId)}
      >
        <Text as="span" size="B300">
          {discarded.failed
            ? t('mindroomUi.voice.voiceRecorderDialog.retry')
            : t('composer.voiceUndoDiscard')}
        </Text>
      </Button>
    </Surface>
  );
  return pageSlot ? (
    createPortal(toast, pageSlot)
  ) : (
    <div className={PageSlot({ phone: false })}>{toast}</div>
  );
}
