import type { MatrixEvent, Room } from 'matrix-js-sdk';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import type { ReactNode } from 'react';
import type { GetContentCallback } from '../../matrix/types/room';
import type { EventRendererOpts } from '../useMatrixEventRenderer';
import { useRoomEvent } from '../../event-store/cache/useRoomEvent';

export {
  isMindroomPinnedToolApprovalEvent,
  MINDROOM_PINNED_TOOL_APPROVAL_EVENT,
  renderMindroomPinnedToolApprovalEvent,
} from './pinnedToolApproval';
import {
  isMindroomPinnedToolApprovalEvent,
  MINDROOM_PINNED_TOOL_APPROVAL_EVENT,
  renderMindroomPinnedToolApprovalEvent,
} from './pinnedToolApproval';

type MindroomPinnedMessageRenderOptions = {
  roomId: string;
  mediaAutoLoad?: boolean;
  urlPreview?: boolean;
  htmlReactParserOptions: HTMLReactParserOptions; // turns formatted_body HTML into React nodes
  linkifyOpts: LinkifyOpts;
  outlineAttachment?: boolean;
};

type MindroomPinnedEncryptedMessageRenderOptions = MindroomPinnedMessageRenderOptions & {
  displayName: string;
  eventId: string;
  resolveEditedEvent?: (event: MatrixEvent) => MatrixEvent | undefined;
};

export const getMindroomPinnedMessageRenderers = (
  options: MindroomPinnedMessageRenderOptions
): EventRendererOpts<[MatrixEvent, string, GetContentCallback]> => ({
  [MINDROOM_PINNED_TOOL_APPROVAL_EVENT]: (event, displayName) =>
    renderMindroomPinnedToolApprovalEvent(event, {
      ...options,
      displayName,
    }),
});

export const renderMindroomPinnedEncryptedMessageEvent = (
  event: MatrixEvent,
  options: MindroomPinnedEncryptedMessageRenderOptions
): ReactNode | undefined => {
  if (!isMindroomPinnedToolApprovalEvent(event.getType())) return undefined;

  const { resolveEditedEvent, ...renderOptions } = options;
  return renderMindroomPinnedToolApprovalEvent(event, {
    ...renderOptions,
    editedEvent: resolveEditedEvent?.(event),
  });
};

/**
 * `undefined` means still loading, `null` means the fetch failed — the pin
 * menu renders its "Failed to load message!" branch for `null`.
 */
export const useMindroomPinnedEvent = (room: Room, eventId: string): MatrixEvent | null | undefined =>
  useRoomEvent(room, eventId);
