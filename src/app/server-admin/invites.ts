import { Capacitor } from '@capacitor/core';
import { Method, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { TFunction } from 'i18next';
import type { ClientConfig } from '../config/useClientConfig';
import { getOriginBaseUrl } from '../routes/pathUtils';
import { describeError } from '../lib/describeError';
import { isRecord } from '../lib/isRecord';
import { freshFetch, specVersions } from '../matrix/cs-api';
import { StateEvent } from '../matrix/types/room';

/**
 * Registration invites, for the homeserver's administrators: single email addresses that may
 * each create one account by signing in through single sign-on, with the rooms that account
 * joins and whether it is external. The routes are the MindRoom homeserver's own
 * (`/_matrix/client/unstable/io.mindroom/admin/registration_invites`).
 */

/** The homeserver lists this in `/versions` while it has the invite routes and a provider to sign in with. */
const REGISTRATION_INVITES_FEATURE = 'io.mindroom.registration_invites';
const INVITES = { prefix: '/_matrix/client/unstable/io.mindroom' };
const ROUTE = '/admin/registration_invites';

/** One invite, as the server stores it: its address in lowercase. */
export type RegistrationInvite = {
  email: string;
  /** Room IDs or aliases the new account joins. */
  rooms: string[];
  external: boolean;
};

/**
 * Whether the homeserver has registration invites, asked now: a server that was just upgraded
 * says so at once. A server that cannot be asked has none here.
 */
export const supportsRegistrationInvites = (
  mx: MatrixClient,
  request: typeof fetch = freshFetch
): Promise<boolean> =>
  specVersions(request, mx.getHomeserverUrl()).then(
    (versions) => versions.unstable_features?.[REGISTRATION_INVITES_FEATURE] === true,
    () => false
  );

export const parseInvite = (raw: unknown): RegistrationInvite | undefined => {
  if (!isRecord(raw) || typeof raw.email !== 'string') return undefined;
  const rooms: unknown[] = Array.isArray(raw.rooms) ? raw.rooms : [];
  return {
    email: raw.email,
    rooms: rooms.filter((room): room is string => typeof room === 'string'),
    external: raw.external === true,
  };
};

/** Every pending invite, by address. */
export const listInvites = async (mx: MatrixClient): Promise<RegistrationInvite[]> => {
  const { invites } = await mx.http.authedRequest<{ invites?: unknown }>(
    Method.Get,
    ROUTE,
    undefined,
    undefined,
    INVITES
  );
  const listed: unknown[] = Array.isArray(invites) ? invites : [];
  return listed
    .map(parseInvite)
    .filter((invite): invite is RegistrationInvite => invite !== undefined);
};

// A recipient as a mail program writes it: a name, quoted or not, before the address in angle brackets.
const NAMED_ADDRESS = /(^|[,;\n])\s*(?:"[^"]*"\s*|[^,;\n<>"@]*)<([^<>]*)>/g;
// What a pasted address is wrapped in: brackets, quotes, `mailto:`, the full stop that ends a sentence.
const ADDRESS_WRAPPING = /^[<("']*(?:mailto:)?|[>)"'.]+$/gi;

/**
 * The addresses of a pasted text, each once whatever its case, taken out of the forms a mail
 * program writes them in: `"Alice Smith" <alice@example.com>`, `mailto:alice@example.com`. What is
 * left and is no address stays in, for {@link inviteAddresses} to say so.
 */
export const parseAddresses = (text: string): string[] => {
  const seen = new Set<string>();
  return text
    .replace(NAMED_ADDRESS, '$1 $2 ')
    .split(/[\s,;]+/)
    .map((pasted) => pasted.replace(ADDRESS_WRAPPING, ''))
    .filter((address) => {
      const key = address.toLowerCase();
      if (address === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

// As loose as the server, which wants one `@` with something on both sides; it reads no more of it.
const isAddress = (text: string): boolean => /^[^\s@]+@[^\s@]+$/.test(text);
/** What the server answers a malformed address with, for one that is refused here. */
const NOT_AN_ADDRESS = { errcode: 'M_INVALID_PARAM' };

/** What became of one address: the invite the server stored for it, or why it refused. */
export type InviteResult = { address: string; invite?: RegistrationInvite; error?: unknown };

/**
 * Invites each address with the same rooms and external mark, one request per address. A
 * refused address does not stop the others; an address that had an invite gets the new one.
 * What is no address is refused here, and nothing is sent for it.
 */
export const inviteAddresses = (
  mx: MatrixClient,
  addresses: readonly string[],
  rooms: readonly string[],
  external: boolean
): Promise<InviteResult[]> =>
  Promise.all(
    addresses.map((address) => {
      if (!isAddress(address)) return { address, error: NOT_AN_ADDRESS };
      return mx.http
        .authedRequest<unknown>(
          Method.Put,
          `${ROUTE}/${encodeURIComponent(address)}`,
          undefined,
          { rooms, external },
          INVITES
        )
        .then(
          (stored): InviteResult => ({
            address,
            invite: parseInvite(stored) ?? { email: address, rooms: [...rooms], external },
          }),
          (error: unknown): InviteResult => ({ address, error: error ?? new Error('unknown') })
        );
    })
  );

const errcodeOf = (error: unknown): unknown => (isRecord(error) ? error.errcode : undefined);

/** Deletes the invite of an address. One that is gone already, used or deleted, is done too. */
export const deleteInvite = async (mx: MatrixClient, email: string): Promise<void> => {
  try {
    await mx.http.authedRequest(
      Method.Delete,
      `${ROUTE}/${encodeURIComponent(email)}`,
      undefined,
      undefined,
      INVITES
    );
  } catch (error) {
    if (errcodeOf(error) !== 'M_NOT_FOUND') throw error;
  }
};

/**
 * Why the server refused an address, in plain words. It names the account that has the address
 * only in its explanation, so that is where the Matrix ID is read from.
 */
export const inviteErrorText = (t: TFunction, error: unknown): string => {
  const errcode = errcodeOf(error);
  if (errcode === 'M_INVALID_PARAM') return t('serverAccounts.invites.errors.invalidAddress');
  if (errcode === 'M_THREEPID_IN_USE' && isRecord(error) && isRecord(error.data)) {
    const explanation = typeof error.data.error === 'string' ? error.data.error : '';
    const user = /@\S+:\S+/.exec(explanation)?.[0].replace(/\.$/, '');
    if (user !== undefined) return t('serverAccounts.invites.errors.inUse', { user });
  }
  return describeError(t, error);
};

// The homeserver writes a provider's brand in lowercase; these are spelled as on the sign-in page.
const KNOWN_PROVIDERS: Readonly<Record<string, string>> = {
  apple: 'Apple',
  github: 'GitHub',
  google: 'Google',
};

/**
 * The names of the providers the homeserver signs people in with, each once; none when it cannot
 * be asked.
 */
export const ssoProviderNames = (mx: MatrixClient): Promise<string[]> =>
  mx.loginFlows().then(
    ({ flows }) => [
      ...new Set(
        flows
          .flatMap((flow) => ('identity_providers' in flow ? flow.identity_providers ?? [] : []))
          .map(({ name }): unknown => name)
          .filter((name): name is string => typeof name === 'string' && name !== '')
          .map((name) => KNOWN_PROVIDERS[name.toLowerCase()] ?? name)
      ),
    ],
    () => []
  );

/**
 * Where an invited person signs in: where this app is served, whose sign-in page offers the
 * deployment's homeservers. The native app's pages have no web address, so there the line names
 * the homeserver instead.
 */
export const invitationUrl = (
  serverName: string,
  hashRouter?: ClientConfig['hashRouter'],
  native: boolean = Capacitor.isNativePlatform()
): string => (native ? serverName : `${getOriginBaseUrl(hashRouter)}/`);

type Invitation = {
  /** Where to sign in. */
  url: string;
  providers: readonly string[];
  email: string;
};

/** The line an administrator sends to an invited person; the homeserver sends nothing. */
export const invitationText = (
  t: TFunction,
  language: string,
  { url, providers, email }: Invitation
): string =>
  providers.length === 0
    ? t('serverAccounts.invites.messagePlain', { url, email })
    : t('serverAccounts.invites.message', {
        url,
        providers: new Intl.ListFormat(language, { type: 'disjunction' }).format(providers),
        email,
      });

/** A room as an administrator picks or reads it. */
export type InvitableRoom = {
  roomId: string;
  name: string;
  /** Its canonical alias, else its ID: what tells it from a room of the same name. */
  address: string;
};

export const describeRoom = (room: Room): InvitableRoom => ({
  roomId: room.roomId,
  name: room.name,
  address: room.getCanonicalAlias() ?? room.roomId,
});

/**
 * The rooms an invite can name here: those the administrator has joined, without direct chats.
 * Spaces are left out, since an account that joins one joins none of its rooms, and so are the
 * rooms the homeserver lets no registration join: its admin room (`#admins`) and a room that an
 * upgrade replaced.
 */
export const invitableRooms = (mx: MatrixClient, directs: ReadonlySet<string>): InvitableRoom[] => {
  const adminRoom = `#admins:${mx.getDomain()}`;
  return mx
    .getRooms()
    .filter(
      (room) =>
        room.getMyMembership() === 'join' &&
        !directs.has(room.roomId) &&
        !room.isSpaceRoom() &&
        room.getCanonicalAlias() !== adminRoom &&
        room.currentState.getStateEvents(StateEvent.RoomTombstone, '') === null
    )
    .map(describeRoom)
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * A room's name, followed by its address where one of the rooms on offer has the same name. The
 * address reads left to right in any language, so it is isolated from the text around it.
 */
export const roomLabel = (
  { roomId, name, address }: InvitableRoom,
  offered: readonly InvitableRoom[]
): string =>
  offered.some((other) => other.name === name && other.roomId !== roomId)
    ? `${name} (\u2068${address}\u2069)`
    : name;
