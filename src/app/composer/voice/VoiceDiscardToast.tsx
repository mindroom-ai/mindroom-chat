import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue, useStore } from 'jotai';
import { Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { pageNoticeSlotAtom } from '../../ui/noticeSlots';
import { PageSlot } from '../../ui/noticeSlots.css';
import { Surface } from '../../ui/glass/GlassPrimitives';
import { discardedVoiceDraftAtom } from '../roomInputDrafts';
import { confirmVoiceDiscard, undoVoiceDiscard } from './voiceDrafts';
import * as css from './VoiceDiscardToast.css';

/**
 * Says that a voice recording was discarded and offers Undo, in the page's notice place, until
 * the discard stands (`VOICE_DISCARD_UNDO_MS`). Mounted once for the signed-in app, so it
 * outlives the composer the recording was discarded in.
 */
export function VoiceDiscardToast() {
  const { t } = useTranslation();
  const store = useStore();
  const discarded = useAtomValue(discardedVoiceDraftAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);

  useEffect(() => {
    if (!discarded) return undefined;
    const timer = setTimeout(
      () => confirmVoiceDiscard(store),
      Math.max(0, discarded.until - Date.now())
    );
    return () => clearTimeout(timer);
  }, [discarded, store]);

  if (!discarded) return null;
  const toast = (
    <Surface className={css.Toast} variant="Surface" data-testid="voice-discard-toast">
      <Text as="span" size="T300">
        {t('composer.voiceDiscarded')}
      </Text>
      <Button
        size="300"
        variant="Secondary"
        fill="Soft"
        radii="Pill"
        onClick={() => undoVoiceDiscard(store)}
      >
        <Text as="span" size="B300">
          {t('composer.voiceUndoDiscard')}
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
