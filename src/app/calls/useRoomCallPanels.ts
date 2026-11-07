import { useEffect, useRef } from 'react';
import { useCallPanel } from './callStore';
import { useTranscriptPanel } from './transcription/transcriptPanel';

/**
 * The room's call panel and its call's live transcript among the room's side panels. The call
 * panel is one more side panel: opening it closes a canvas or the computer (`closeMedia`), and
 * opening one of those (`mediaPanelOpen`) closes it. The live transcript takes the call panel's
 * place, which comes back when it closes, and gives way to every other panel for good.
 */
export const useRoomCallPanels = (
  roomId: string,
  mediaPanelOpen: boolean,
  closeMedia: () => void
) => {
  const [callOpen, setCallOpen] = useCallPanel(roomId);
  const transcript = useTranscriptPanel(roomId);
  const { open: transcriptOpen, dismiss: dismissTranscript } = transcript;
  const lastPanels = useRef({ callOpen, mediaPanelOpen, transcriptOpen });
  useEffect(() => {
    const last = lastPanels.current;
    lastPanels.current = { callOpen, mediaPanelOpen, transcriptOpen };
    if (callOpen && !last.callOpen) {
      closeMedia();
      dismissTranscript();
    } else if (transcriptOpen && !last.transcriptOpen) {
      closeMedia();
    } else if (mediaPanelOpen && !last.mediaPanelOpen) {
      if (callOpen) setCallOpen(false);
      dismissTranscript();
    }
  }, [callOpen, closeMedia, dismissTranscript, mediaPanelOpen, setCallOpen, transcriptOpen]);
  return {
    callOpen,
    setCallOpen,
    callShown: callOpen && !mediaPanelOpen,
    transcriptShown: transcriptOpen && !callOpen && !mediaPanelOpen,
    closeTranscript: transcript.close,
    dismissTranscript,
  };
};
