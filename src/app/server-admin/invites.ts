import { Capacitor } from '@capacitor/core';
import { Method, type MatrixClient } from 'matrix-js-sdk';
import type { TFunction } from 'i18next';
import { appUrl } from '../lib/basePath';
import { describeError } from '../lib/describeError';
import { isRecord } from '../lib/isRecord';
import { specVersions } from '../matrix/cs-api';

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

const freshFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

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

/** The addresses of a pasted text, each once whatever its case. The server says which are malformed. */
export const parseAddresses = (text: string): string[] => {
  const seen = new Set<string>();
  return text.split(/[\s,;]+/).filter((address) => {
    const key = address.toLowerCase();
    if (address === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** What became of one address: the invite the server stored for it, or why it refused. */
export type InviteResult = { address: string; invite?: RegistrationInvite; error?: unknown };

/**
 * Invites each address with the same rooms and external mark, one request per address. A
 * refused address does not stop the others; an address that had an invite gets the new one.
 */
export const inviteAddresses = (
  mx: MatrixClient,
  addresses: readonly string[],
  rooms: readonly string[],
  external: boolean
): Promise<InviteResult[]> =>
  Promise.all(
    addresses.map((address) =>
      mx.http
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
        )
    )
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

/** The names of the providers the homeserver signs people in with; none when it cannot be asked. */
export const ssoProviderNames = (mx: MatrixClient): Promise<string[]> =>
  mx.loginFlows().then(
    ({ flows }) =>
      flows
        .flatMap((flow) => ('identity_providers' in flow ? flow.identity_providers ?? [] : []))
        .map(({ name }): unknown => name)
        .filter((name): name is string => typeof name === 'string' && name !== '')
        .map((name) => KNOWN_PROVIDERS[name.toLowerCase()] ?? name),
    () => []
  );

/** Where this app is served; undefined in the native app, whose pages have no web address. */
export const chatUrl = (origin: string = window.location.origin): string | undefined =>
  Capacitor.isNativePlatform() ? undefined : new URL(appUrl(''), origin).href;

type Invitation = {
  /** Where this app is served. */
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

export type InvitableRoom = { roomId: string; name: string };

/**
 * The rooms an invite can name here: those the administrator has joined, without direct chats
 * and without the homeserver's admin room (`#admins`), which it lets no registration join.
 */
export const invitableRooms = (mx: MatrixClient, directs: ReadonlySet<string>): InvitableRoom[] => {
  const adminRoom = `#admins:${mx.getDomain()}`;
  return mx
    .getRooms()
    .filter(
      (room) =>
        room.getMyMembership() === 'join' &&
        !directs.has(room.roomId) &&
        room.getCanonicalAlias() !== adminRoom
    )
    .map(({ roomId, name }) => ({ roomId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
