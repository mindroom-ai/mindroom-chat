import { useStore } from 'jotai';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { Editor, Transforms } from 'slate';
import { isEmptyEditor, resetEditor, resetEditorHistory } from '../editor/utils';
import { roomIdToMsgDraftAtomFamily } from './roomInputDrafts';

// The drafts mounted composers show, each counted once per composer.
const shownDrafts = new Map<string, number>();

/** Whether a mounted composer shows the draft under `draftKey` (`getRoomInputDraftKey`). */
export const isDraftShown = (draftKey: string): boolean => shownDrafts.has(draftKey);

/**
 * Keeps the editor's text as the draft under `draftKey`: a room and thread's
 * (`getRoomInputDraftKey`), or Home's ask field's (`getHomeAskDraftKey`).
 */
export const useRoomInputDraft = (editor: Editor, draftKey: string) => {
  const store = useStore();
  const draftAtom = roomIdToMsgDraftAtomFamily(draftKey);
  const activeRef = useRef<{ editor: Editor; atom: typeof draftAtom }>();
  const savingRef = useRef(false);

  const saveDraft = useCallback(() => {
    if (activeRef.current?.editor !== editor || activeRef.current.atom !== draftAtom) return;
    const draft = isEmptyEditor(editor) ? [] : editor.children;
    if (JSON.stringify(draft) === JSON.stringify(store.get(draftAtom))) return;
    savingRef.current = true;
    try {
      store.set(draftAtom, draft);
    } finally {
      savingRef.current = false;
    }
  }, [draftAtom, editor, store]);

  useLayoutEffect(() => {
    const restoreDraft = () => {
      if (savingRef.current) return;
      const draft = store.get(draftAtom);
      resetEditor(editor);
      if (draft.length > 0) Transforms.insertFragment(editor, JSON.parse(JSON.stringify(draft)));
      resetEditorHistory(editor);
    };
    restoreDraft();
    activeRef.current = { editor, atom: draftAtom };
    const unsubscribe = store.sub(draftAtom, restoreDraft);
    shownDrafts.set(draftKey, (shownDrafts.get(draftKey) ?? 0) + 1);
    return () => {
      saveDraft();
      activeRef.current = undefined;
      unsubscribe();
      const shown = (shownDrafts.get(draftKey) ?? 1) - 1;
      if (shown > 0) shownDrafts.set(draftKey, shown);
      else shownDrafts.delete(draftKey);
      // Nothing else to undo: the next destination's effect restores its own draft into
      // this editor, and an unmounted editor is discarded.
    };
  }, [draftAtom, draftKey, editor, saveDraft, store]);

  return saveDraft;
};
