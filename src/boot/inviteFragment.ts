// An invite link's fragment holds a single-use code. Before Chat leaves its origin or reloads, it
// clears such a fragment whole: a browser keeps the fragment through redirects to another origin.
export const readInviteFragment = (hash: string) => {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return { routerId: params.get('r'), code: params.get('c') };
};
const withoutInviteFragment = (href: string): string => {
  const at = href.indexOf('#');
  const { routerId, code } = readInviteFragment(at < 0 ? '' : href.slice(at));
  return routerId === null && code === null ? href : href.slice(0, at);
};
export const dropInviteFragment = (win: Window = window): void => {
  const href = String(win.location.href);
  const clean = withoutInviteFragment(href);
  if (clean !== href) win.history.replaceState(win.history.state, '', clean);
};
/** Leaves for `url`, or reloads without one, never with an invite link's code in either address. */
export const leavePage = (url?: string): void => {
  dropInviteFragment();
  if (url === undefined) window.location.reload();
  else window.location.assign(withoutInviteFragment(url));
};
