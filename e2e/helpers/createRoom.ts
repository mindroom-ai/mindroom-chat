import { matrixFetch } from './matrix';

/** The `/createRoom` fields these specs set; the server applies its defaults to the rest. */
export type NewRoom = {
  name: string;
  preset?: 'private_chat' | 'public_chat' | 'trusted_private_chat';
  invite?: string[];
  /** Creates a space (`m.space`) instead of a room. */
  space?: boolean;
};

/** Creates a room without a topic, private unless `preset` says otherwise; answers its ID. */
export const createRoom = async (
  homeserver: string,
  accessToken: string,
  room: NewRoom
): Promise<string> => {
  const created = await matrixFetch<{ room_id: string }>(homeserver, '/createRoom', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({
      name: room.name,
      preset: room.preset ?? 'private_chat',
      invite: room.invite,
      creation_content: room.space ? { type: 'm.space' } : undefined,
    }),
  });
  return created.room_id;
};
