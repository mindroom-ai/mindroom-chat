import { Preset, Visibility, type MatrixClient, type Room } from 'matrix-js-sdk';
import { Membership } from '../../../types/matrix/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import { waitForJoinedRoom } from '../calls/agentCall';

export const BUG_REPORTS_ROOM_TYPE = 'io.mindroom.bug_reports';
export const BUG_REPORTS_ACCOUNT_DATA_TYPE = 'io.mindroom.bug_reports';

const inFlight = new WeakMap<MatrixClient, Promise<Room>>();

const getStoredRoomId = (mx: MatrixClient): string | undefined => {
  const content = mx
    .getAccountData(BUG_REPORTS_ACCOUNT_DATA_TYPE as never)
    ?.getContent<{ room_id?: unknown }>();
  return typeof content?.room_id === 'string' ? content.room_id : undefined;
};

const inviteMissingAdmins = async (mx: MatrixClient, room: Room, admins: string[]) => {
  const missing = admins.filter((userId) => {
    const membership = room.getMember(userId)?.membership;
    return membership !== Membership.Join && membership !== Membership.Invite;
  });
  await Promise.all(missing.map((userId) => mx.invite(room.roomId, userId)));
};

const createReportRoom = async (mx: MatrixClient, admins: string[]): Promise<Room> => {
  const userId = mx.getSafeUserId();
  const displayName = mx.getUser(userId)?.displayName ?? getMxIdLocalPart(userId) ?? userId;
  // No m.room.encryption: matrix-mcp, which coding agents use to read reports, has no E2EE.
  const { room_id: roomId } = await mx.createRoom({
    name: `Bug reports · ${displayName}`,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    invite: admins,
    creation_content: { type: BUG_REPORTS_ROOM_TYPE },
  });
  await mx.setAccountData(BUG_REPORTS_ACCOUNT_DATA_TYPE as never, { room_id: roomId } as never);
  return waitForJoinedRoom(mx, roomId);
};

/** The reporter's private room with the administrators, created on first use. */
export const ensureBugReportRoom = (mx: MatrixClient, admins: string[]): Promise<Room> => {
  const pending = inFlight.get(mx);
  if (pending) return pending;

  const myUserId = mx.getSafeUserId();
  const otherAdmins = admins.filter((userId) => userId !== myUserId);
  const lookup = (async () => {
    const storedRoomId = getStoredRoomId(mx);
    const stored = storedRoomId ? mx.getRoom(storedRoomId) : null;
    if (stored && stored.getMyMembership() === Membership.Join) {
      await inviteMissingAdmins(mx, stored, otherAdmins);
      return stored;
    }
    return createReportRoom(mx, otherAdmins);
  })().finally(() => inFlight.delete(mx));
  inFlight.set(mx, lookup);
  return lookup;
};
