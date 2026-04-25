import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { useRoomEvent } from '../threads/useRoomEvent';

export {
  isMindroomPinnedToolApprovalEvent,
  MINDROOM_PINNED_TOOL_APPROVAL_EVENT,
  renderMindroomPinnedToolApprovalEvent,
} from './pinnedToolApproval';

export const useMindroomPinnedEvent = (room: Room, eventId: string): MatrixEvent | undefined =>
  useRoomEvent(room, eventId) ?? undefined;
