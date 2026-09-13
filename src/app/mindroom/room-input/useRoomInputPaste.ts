import { ClipboardEventHandler, useCallback } from 'react';
import { Editor } from 'slate';

import {
  customHtmlEqualsPlainText,
  moveCursor,
  toMatrixCustomHTML,
  toPlainText,
  trimCustomHtml,
} from '../../components/editor';
import { TUploadItem, TUploadMetadata } from '../../state/room/roomInputDrafts';
import { getDataTransferFiles } from '../../utils/dom';
import {
  createMindroomPasteAttachment,
  parseMindroomPasteMarker,
} from '../messages/pasteAttachmentMarker';
import { createMindroomRoomInputPasteMarkerElement } from './RoomInputMindroomExtensions';
import { shouldConvertPasteToAttachment } from './pasteAttachment';

type UseRoomInputPasteOptions = {
  editor: Editor;
  isMarkdown: boolean;
  handleFiles: (files: File[]) => Promise<void>;
  createUploadItems: (
    files: File[],
    getMetadata?: (file: File, index: number) => TUploadMetadata
  ) => Promise<TUploadItem[]>;
  appendUploadItems: (fileItems: TUploadItem[]) => void;
};

export const useRoomInputPaste = ({
  editor,
  isMarkdown,
  handleFiles,
  createUploadItems,
  appendUploadItems,
}: UseRoomInputPasteOptions): ClipboardEventHandler => {
  // Must stay synchronous and return `undefined` when it does not handle the
  // paste: slate-react treats any non-null return value (including the
  // Promise from an async handler) as "handled" and then skips its own
  // onPaste fallback, so the browser inserts the text into the DOM without
  // the editor model ever learning about it.
  const handlePaste: ClipboardEventHandler = useCallback(
    (evt) => {
      const files = getDataTransferFiles(evt.clipboardData);
      if (files) {
        void handleFiles(files);
        return;
      }

      const pastedText = evt.clipboardData.getData('text/plain');
      if (!pastedText) return;

      const plainText = toPlainText(editor.children, isMarkdown).trim();
      const customHtml = trimCustomHtml(
        toMatrixCustomHTML(editor.children, {
          allowTextFormatting: true,
          allowBlockMarkdown: isMarkdown,
          allowInlineMarkdown: isMarkdown,
        })
      );
      const hasFormattedBody = !customHtmlEqualsPlainText(customHtml, plainText);
      const convertPaste = shouldConvertPasteToAttachment({
        currentPlainText: plainText,
        currentFormattedBody: hasFormattedBody ? customHtml : undefined,
        pastedText,
        includeFormattedPaste: isMarkdown,
      });

      if (!convertPaste) return;

      evt.preventDefault();
      const pasteAttachment = createMindroomPasteAttachment(pastedText);
      const pasteMarker = parseMindroomPasteMarker(pasteAttachment.marker);
      if (!pasteMarker) return;

      void (async () => {
        const pasteUploadItems = await createUploadItems([pasteAttachment.file], () => ({
          markedAsSpoiler: false,
          mindroomPasteAttachment: {
            id: pasteMarker.id,
            chars: pasteMarker.chars,
            fileName: pasteMarker.fileName,
          },
        }));
        appendUploadItems(pasteUploadItems);
        if (pasteUploadItems.some((item) => item.prepError)) {
          editor.insertText(pastedText);
          return;
        }

        editor.insertNode(createMindroomRoomInputPasteMarkerElement(pasteMarker));
        moveCursor(editor);
      })();
    },
    [appendUploadItems, createUploadItems, editor, handleFiles, isMarkdown]
  );

  return handlePaste;
};
