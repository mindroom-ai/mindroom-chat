// An invite link's fragment holds its single-use code. At boot, and on every same-document
// navigation, the fragment moves from the address into this tab's session storage, as
// `<expiry>#<fragment>`, before the router or any code that saves paths can read it.
const STORAGE_KEY = 'mindroom.invite_link';
const MAX_AGE_MS = 15 * 60 * 1000;
/** Takes an invite link (`#…c=…`) out of the address, whatever its path; drops an expired one. */
export const holdInviteLink = (): void => {
  const { hash, pathname, search } = window.location;
  const isLink = new URLSearchParams(hash.slice(1)).has('c');
  if (isLink) window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  try {
    if (isLink) sessionStorage.setItem(STORAGE_KEY, `${Date.now() + MAX_AGE_MS}#${hash.slice(1)}`);
    else if (!(Number(sessionStorage.getItem(STORAGE_KEY)?.split('#')[0]) > Date.now()))
      sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without session storage the page says to open the link from the mail again.
  }
};
/** The held fragment, read once: removed on read, and empty when missing, expired or unreadable. */
export const takeInviteFragment = (): string => {
  try {
    const [expiresAt, fragment] = (sessionStorage.getItem(STORAGE_KEY) ?? '').split('#', 2);
    sessionStorage.removeItem(STORAGE_KEY);
    return fragment && Number(expiresAt) > Date.now() ? `#${fragment}` : '';
  } catch {
    return '';
  }
};
