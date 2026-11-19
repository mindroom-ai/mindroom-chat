import {
  ClientEvent,
  KnownMembership,
  RoomEvent,
  type MatrixClient,
  type Membership,
  type Room,
} from 'matrix-js-sdk';
import type { ReceivedToDeviceMessage } from 'matrix-js-sdk/lib/sync-accumulator';
import { matchesEnum } from '../lib/matchesEnum';
import type { InviteLink } from './inviteLink';

// Protocol version 1 of email invitations, defined by the MindRoom backend: Chat sends the code
// from the link to the router as a plain to-device claim, and the router answers with a result.
export const CLAIM_EVENT = 'io.mindroom.email_invite.claim';
export const RESULT_EVENT = 'io.mindroom.email_invite.result';
export const CLAIM_TIMEOUT_MS = 20_000;
export const CLAIM_RESEND_MS = 5_000;

export type ClaimOutcome =
  | { status: 'invited'; roomId: string }
  | { status: 'rejected' }
  | { status: 'retry' }
  | { status: 'offline' };

/** Who invited this account to `room`, while that invitation is pending. */
const inviterOf = (mx: MatrixClient, room: Room): string | undefined =>
  matchesEnum(room.getMyMembership(), KnownMembership.Invite)
    ? room.getMember(mx.getSafeUserId())?.events.member?.getSender()
    : undefined;

/** The room this account is invited to by `routerId`, limited to `roomId` when given. */
export const pendingRouterInvite = (
  mx: MatrixClient,
  routerId: string,
  roomId?: string
): string | undefined =>
  mx
    .getRooms()
    .find(
      (room) => (roomId === undefined || room.roomId === roomId) && inviterOf(mx, room) === routerId
    )?.roomId;

/** The final outcome a result from the router carries, or undefined for any other shape. */
const parseResult = (content: Record<string, unknown>): ClaimOutcome | undefined => {
  const { status, room_id: roomId } = content;
  if (status === 'invited') {
    return typeof roomId === 'string' && roomId ? { status, roomId } : undefined;
  }
  return status === 'rejected' || status === 'retry' ? { status } : undefined;
};

/**
 * Sends the claim and reports outcomes: `offline` after CLAIM_TIMEOUT_MS without an answer, and
 * any final outcome whenever it arrives, also after `offline`. Returns a function that stops it.
 */
export const startClaim = (
  mx: MatrixClient,
  link: InviteLink,
  onOutcome: (outcome: ClaimOutcome) => void
): (() => void) => {
  const requestId = crypto.randomUUID();
  const content = { version: 1, request_id: requestId, code: link.code };
  // An invitation from the router that was already pending says nothing about this claim.
  const pendingBefore = new Set(
    mx
      .getRooms()
      .filter((room) => inviterOf(mx, room) === link.routerId)
      .map((room) => room.roomId)
  );

  const send = (): void => {
    // A failed send ends in `offline`, like a claim the router never answers.
    mx.sendToDevice(CLAIM_EVENT, new Map([[link.routerId, new Map([['*', content]])]])).catch(
      () => undefined
    );
  };

  // Read encrypted or not: the router may answer either way.
  function onMessage({ message }: ReceivedToDeviceMessage): void {
    if (message.type !== RESULT_EVENT || message.sender !== link.routerId) return;
    const result = message.content as Record<string, unknown>;
    if (result.version !== 1 || result.request_id !== requestId) return;
    const outcome = parseResult(result);
    if (outcome) finish(outcome);
  }

  // The router's invitation stands for its result, should the result not arrive.
  function onMembership(room: Room, membership: Membership): void {
    if (!matchesEnum(membership, KnownMembership.Invite) || pendingBefore.has(room.roomId)) return;
    if (inviterOf(mx, room) === link.routerId) finish({ status: 'invited', roomId: room.roomId });
  }

  mx.on(ClientEvent.ReceivedToDeviceMessage, onMessage);
  mx.on(RoomEvent.MyMembership, onMembership);
  send();
  const resend = setTimeout(send, CLAIM_RESEND_MS);
  const offline = setTimeout(() => onOutcome({ status: 'offline' }), CLAIM_TIMEOUT_MS);

  function stop(): void {
    clearTimeout(resend);
    clearTimeout(offline);
    mx.removeListener(ClientEvent.ReceivedToDeviceMessage, onMessage);
    mx.removeListener(RoomEvent.MyMembership, onMembership);
  }
  function finish(outcome: ClaimOutcome): void {
    stop();
    onOutcome(outcome);
  }
  return stop;
};
