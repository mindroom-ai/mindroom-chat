import { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useConversationOutOfSightAtom } from '../../navigation/conversationView';
import { coverNoticeSlotAtom } from '../../ui/noticeSlots';
import { liveCaptureCapsulesShownAtom } from './liveCapture';

/**
 * Counts this composer as showing the account's live capture capsule while `showingLive` holds,
 * its conversation is in sight (not behind a side panel, folded column or phone nav drawer), and
 * nothing covers the page (a large dialog such as Settings, a phone's drawer or members sheet).
 * When no composer counts, `LiveCaptureIndicator` stands in.
 */
export const useLiveCaptureCapsuleVisible = (showingLive: boolean): void => {
  const conversationOutOfSight = useAtomValue(useConversationOutOfSightAtom());
  const pageCovered = useAtomValue(coverNoticeSlotAtom) !== null;
  const visible = showingLive && !conversationOutOfSight && !pageCovered;
  const setCapsulesShown = useSetAtom(liveCaptureCapsulesShownAtom);
  useEffect(() => {
    if (!visible) return undefined;
    setCapsulesShown((count) => count + 1);
    return () => setCapsulesShown((count) => count - 1);
  }, [setCapsulesShown, visible]);
};
