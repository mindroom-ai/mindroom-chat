import React, { type ReactNode } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { MINDROOM_TOOL_APPROVAL_EVENT } from './toolApproval';

/** Pinned tool approvals keep their own event type, unlike `m.room.message` pins. */
export const MINDROOM_PINNED_TOOL_APPROVAL_EVENT = MINDROOM_TOOL_APPROVAL_EVENT;

export const isMindroomPinnedToolApprovalEvent = (eventType: string): boolean =>
  eventType === MINDROOM_PINNED_TOOL_APPROVAL_EVENT;

export type MindroomPinnedToolApprovalRenderOptions = {
  roomId: string;
  displayName: string;






  eventId?: string;
  /** Latest edit of the approval (the backend edits it as the request is decided). */
  editedEvent?: MatrixEvent;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * A pinned approval request through the message renderer, so it shows the same card as in the
 * timeline and answers the request in the approval's room and thread. A relation-only edit (an
 * encrypted pin whose edit was found by relation) carries the decided status in `m.new_content`,
 * which is merged onto the original request.
 */
export const renderMindroomPinnedToolApprovalEvent = (
  event: MatrixEvent,
  { displayName, editedEvent, eventId, ...options }: MindroomPinnedToolApprovalRenderOptions
): ReactNode => {
  const newContent = asRecord(editedEvent?.getContent()?.['m.new_content']);
  const getContent = (() =>
    newContent ? { ...event.getContent(), 'm.new_content': newContent } : event.getContent()) as <
    T
  >() => T;

  return (
    <RenderMessageContent
      displayName={displayName}
      msgType={MINDROOM_PINNED_TOOL_APPROVAL_EVENT}
      eventType={MINDROOM_PINNED_TOOL_APPROVAL_EVENT}
      ts={event.getTs()}
      edited={!!newContent}
      getContent={getContent}
      mediaAutoLoad={options.mediaAutoLoad}
      urlPreview={options.urlPreview}
      htmlReactParserOptions={options.htmlReactParserOptions}
      linkifyOpts={options.linkifyOpts}
      outlineAttachment={options.outlineAttachment}
      mEvent={event}
      roomId={options.roomId}
      eventId={eventId ?? event.getId()}
      threadId={event.threadRootId}
    />
  );
};
