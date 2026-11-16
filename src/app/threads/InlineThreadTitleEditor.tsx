import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useOptionalMatrixClient } from '../matrix/hooks/useMatrixClient';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { describeError } from '../lib/describeError';
import { ownDirectionLine } from '../ui/directional';
import {
  getThreadSummaryActionError,
  normalizeSummaryText,
  saveThreadSummary,
  SUMMARY_MAX_LENGTH,
} from './summary/threadSummaryActions';
import * as css from './ThreadContextBanner.css';

/** What the title needs to start editing; both undefined where the user may not set it. */
export type ThreadTitleEditStart = {
  onDoubleClick?: () => void;
  /** Says how to rename, for the title's tooltip. */
  hint?: string;
};

type TitleEdit = {
  roomId: string;
  rootId: string;
  draft: string;
  saving: boolean;
  /** Set once a too long title was sent, so its length shows. */
  tooLong: boolean;
  failure?: { error: unknown };
};

type InlineThreadTitleEditorProps = {
  room: Room;
  rootId: string;
  /** The title shown: the summary, else the whole start of the first message. */
  text: string;
  children: (start: ThreadTitleEditStart) => ReactNode;
};

const titleLength = (draft: string) => Array.from(normalizeSummaryText(draft)).length;

/**
 * The thread banner's title, which a double-click turns into a field that sets it as the thread's
 * summary: Enter or leaving the field saves, Escape keeps the title as it was.
 */
export function InlineThreadTitleEditor({
  room,
  rootId,
  text,
  children,
}: InlineThreadTitleEditorProps) {
  const { t } = useTranslation();
  const mx = useOptionalMatrixClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState<TitleEdit>();
  // Read by the handlers, which can run before the render that follows the last change.
  const editRef = useRef(edit);
  const update = (next: TitleEdit | undefined) => {
    editRef.current = next;
    setEdit(next);
  };
  // Another thread ends the edit.
  if (edit && (edit.roomId !== room.roomId || edit.rootId !== rootId)) update(undefined);
  const shown = edit?.roomId === room.roomId && edit.rootId === rootId ? edit : undefined;

  const editing = !!shown;
  useEffect(() => {
    // Focusing inside the sticky banner would otherwise scroll the thread to its first message.
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [editing]);
  const failure = shown?.failure;
  useEffect(() => {
    // A failed save takes the focus back only from nowhere (the field was disabled while it
    // saved), not from where a click that left the field put it.
    const input = inputRef.current;
    if (!failure || !input) return;
    const { activeElement, body } = input.ownerDocument;
    if (!activeElement || activeElement === body) input.focus({ preventScroll: true });
  }, [failure]);

  const editable =
    !!mx &&
    isConfirmedMatrixEventId(rootId) &&
    getThreadSummaryActionError(mx, room, rootId) === undefined;

  if (!shown || !mx) {
    if (!editable) return <>{children({})}</>;
    return (
      <>
        {children({
          hint: t('thread.renameHint'),
          onDoubleClick: () =>
            update({ roomId: room.roomId, rootId, draft: text, saving: false, tooLong: false }),
        })}
      </>
    );
  }

  const save = () => {
    const current = editRef.current;
    if (!current || current.saving) return;
    const title = normalizeSummaryText(current.draft);
    if (!title || title === normalizeSummaryText(text)) {
      update(undefined);
      return;
    }
    if (Array.from(title).length > SUMMARY_MAX_LENGTH) {
      update({ ...current, tooLong: true });
      return;
    }
    const saving: TitleEdit = { ...current, saving: true, failure: undefined };
    update(saving);
    saveThreadSummary(mx, room, rootId, title).then(
      () => {
        if (editRef.current === saving) update(undefined);
      },
      (error: unknown) => {
        if (editRef.current === saving) update({ ...saving, saving: false, failure: { error } });
      }
    );
  };

  const length = titleLength(shown.draft);
  return (
    <>
      <input
        ref={inputRef}
        className={css.TitleInput}
        aria-label={t('threadActions.summary')}
        aria-invalid={shown.tooLong && length > SUMMARY_MAX_LENGTH ? true : undefined}
        value={shown.draft}
        disabled={shown.saving}
        onChange={(event) => update({ ...shown, draft: event.target.value })}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          } else if (event.key === 'Escape') {
            // The thread's own Escape (back to the composer, read) waits for the field to close.
            event.preventDefault();
            event.stopPropagation();
            update(undefined);
          }
        }}
        {...ownDirectionLine}
      />
      {shown.tooLong && length > SUMMARY_MAX_LENGTH && (
        <Text as="span" role="alert" size="T200">
          {t('threadActions.length', { count: length, max: SUMMARY_MAX_LENGTH })}
        </Text>
      )}
      {failure && (
        <Text as="span" role="alert" size="T200">
          {describeError(t, failure.error)}
        </Text>
      )}
    </>
  );
}
