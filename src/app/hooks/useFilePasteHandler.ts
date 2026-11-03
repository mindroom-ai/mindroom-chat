import { ClipboardEventHandler, useCallback } from 'react';
import { getDataTransferFiles } from '../utils/dom';

/** A paste handler that hands pasted files to `onPaste` and leaves text pastes alone. */
export const useFilePasteHandler = (
  onPaste: (files: File[]) => void
): ClipboardEventHandler<HTMLElement> =>
  useCallback(
    (event) => {
      const files = getDataTransferFiles(event.clipboardData);
      if (!files || files.length === 0) return;
      event.preventDefault();
      onPaste(files);
    },
    [onPaste]
  );
