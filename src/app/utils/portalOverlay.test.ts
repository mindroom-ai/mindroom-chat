import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasBlockingPortalOverlay } from './portalOverlay';

const portalChild = (role: string | null) => ({
  getAttribute: (name: string) => (name === 'role' ? role : null),
});

const stubPortal = (children: ReturnType<typeof portalChild>[] | undefined) => {
  vi.stubGlobal('document', {
    getElementById: (id: string) =>
      id === 'portalContainer' && children
        ? { children, childElementCount: children.length }
        : null,
  });
};

describe('hasBlockingPortalOverlay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false without a portal container or with an empty one', () => {
    stubPortal(undefined);
    expect(hasBlockingPortalOverlay()).toBe(false);
    stubPortal([]);
    expect(hasBlockingPortalOverlay()).toBe(false);
  });

  it('treats dialogs, menus, and popovers as blocking', () => {
    stubPortal([portalChild(null)]);
    expect(hasBlockingPortalOverlay()).toBe(true);
    stubPortal([portalChild('dialog')]);
    expect(hasBlockingPortalOverlay()).toBe(true);
  });

  it('ignores hover tooltips, which never take input', () => {
    stubPortal([portalChild('tooltip')]);
    expect(hasBlockingPortalOverlay()).toBe(false);
    stubPortal([portalChild('tooltip'), portalChild(null)]);
    expect(hasBlockingPortalOverlay()).toBe(true);
  });
});
