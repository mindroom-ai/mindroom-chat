import { useEffect, useState } from 'react';
import { useClientConfig } from '../config/useClientConfig';
import { isMacOS } from '../lib/user-agent';
import { isNativeApp } from './nativeSso';

/** The disk image's name on a release: the Mac workflow attaches it minutes after publishing. */
const MAC_APP_DMG = 'MindRoom.dmg';

/** The newest releases, which GitHub serves to any page without sign-in. */
const MAC_APP_RELEASES_API =
  'https://api.github.com/repos/mindroom-ai/mindroom-chat/releases?per_page=10';

/** The releases page: the link until the disk image's own is known, and when it cannot be. */
export const MAC_APP_RELEASES_URL = 'https://github.com/mindroom-ai/mindroom-chat/releases';

/**
 * The disk image of the newest release that has one, from GitHub's list of releases (newest
 * first), drafts and pre-releases left out; undefined when none has one or the list is not one.
 * The newest release itself goes without it until the Mac workflow has attached it, which is why
 * `releases/latest/download/MindRoom.dmg` is no link to it.
 */
export const parseMacAppDownloadUrl = (releases: unknown): string | undefined => {
  if (!Array.isArray(releases)) return undefined;
  for (const release of releases as unknown[]) {
    if (typeof release !== 'object' || release === null) continue;
    const { draft, prerelease, assets } = release as Record<string, unknown>;
    if (draft === true || prerelease === true || !Array.isArray(assets)) continue;
    for (const asset of assets as unknown[]) {
      if (typeof asset !== 'object' || asset === null) continue;
      const { name, state, browser_download_url: url } = asset as Record<string, unknown>;
      // A failed upload can leave a `starter` asset of that name, which has nothing to download.
      const uploaded = name === MAC_APP_DMG && state === 'uploaded';
      if (uploaded && typeof url === 'string' && url.startsWith('https://')) return url;
    }
  }
  return undefined;
};

// One request for the life of the page, which every link to the download shares; a failed one
// leaves them on the releases page.
let resolving: Promise<string | undefined> | undefined;
let resolved: string | undefined;

const resolveMacAppDownloadUrl = (): Promise<string | undefined> => {
  resolving ??= fetch(MAC_APP_RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((releases: unknown) => {
      resolved = parseMacAppDownloadUrl(releases);
      return resolved;
    })
    .catch(() => undefined);
  return resolving;
};

/** Forgets the resolved download, as a page load does. */
export const resetMacAppDownloadUrlForTests = () => {
  resolving = undefined;
  resolved = undefined;
};

/**
 * The link to the Mac app's disk image: the releases page until the newest release that has one is
 * known, and for good when it cannot be (offline, rate limited). It asks GitHub only while
 * `enabled`, so only where the app is offered.
 */
export const useMacAppDownloadUrl = (enabled = true): string => {
  const [url, setUrl] = useState(() => resolved);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void resolveMacAppDownloadUrl().then((found) => {
      if (live) setUrl(found);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return url ?? MAC_APP_RELEASES_URL;
};

/** Installs the Mac app with Homebrew, from MindRoom's tap. */
export const MAC_APP_BREW_COMMAND = 'brew install --cask mindroom-ai/tap/mindroom-chat';

/**
 * Whether to point at the Mac app: only where the deployment turns it on (`macApp.offer` in
 * config.json), in a browser on a Mac (iPadOS, which reports a Mac, is not one), never inside the
 * app itself, which runs this client in its own shell.
 */
export const useOffersMacApp = (): boolean =>
  useClientConfig().macApp?.offer === true && isMacOS() && !isNativeApp();
