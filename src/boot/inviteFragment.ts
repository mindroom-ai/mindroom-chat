// An invite link's fragment (one with `c=`, a single-use code). Chat clears it, by an absolute URL,
// before it leaves its origin or reloads: a browser keeps it through redirects to another origin.
const INVITE_FRAGMENT = /#(?:[^#]*&)?c=.*/;
export const dropInviteFragment = (win: Window = window): void => {
  const href = String(win.location.href);
  if (!INVITE_FRAGMENT.test(href)) return;
  win.history.replaceState(win.history.state, '', href.replace(INVITE_FRAGMENT, ''));
};
/** Leaves for `url`, or reloads without one, never with an invite link's code in either address. */
export const leavePage = (url?: string): void => {
  dropInviteFragment();
  if (url === undefined) window.location.reload();
  else window.location.assign(url.replace(INVITE_FRAGMENT, ''));
};
