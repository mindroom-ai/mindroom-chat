import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../matrix/types/accountData';
import { commitSidebarReorder, type SidebarFolder } from '../../spaces/sidebarReorder';
import { getShownSidebarItems } from '../../spaces/sidebarSpaces';

const ALPHA = '!alpha:example.org';
const BRAVO = '!bravo:example.org';
const CHARLIE = '!charlie:example.org';
const DELTA = '!delta:example.org';

const makeMatrixClient = (sidebar: unknown): MatrixClient =>
  ({
    getAccountData: vi.fn(() => ({
      getContent: () => ({
        existing: true,
        sidebar,
      }),
    })),
    setAccountData: vi.fn(async () => ({})),
  }) as unknown as MatrixClient;

const joined = (...ids: string[]) => {
  const set = new Set(ids);
  return (roomId: string) => set.has(roomId);
};

describe('SpaceTabs sidebar reorder persistence', () => {
  it('writes io.mindroom.spaces account data for plain top-level space reorders', () => {
    const mx = makeMatrixClient([ALPHA, BRAVO]);

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: [],
      savedItems: [ALPHA, BRAVO],
      item: ALPHA,
      containerItem: BRAVO,
      instructionType: 'reorder-below',
    });

    expect(result.items).toEqual([BRAVO, ALPHA]);
    expect(result.changed).toBe(true);
    expect(result.save).toBeDefined();
    expect(mx.setAccountData).toHaveBeenCalledWith(AccountDataEvent.MindroomSpaces, {
      existing: true,
      sidebar: [BRAVO, ALPHA],
    });
  });

  it('writes io.mindroom.spaces account data for top-level folder reorders', () => {
    const folder: SidebarFolder = { id: 'folder-1', content: [ALPHA] };
    const mx = makeMatrixClient([folder, BRAVO]);

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: [],
      savedItems: [folder, BRAVO],
      item: { folder },
      containerItem: BRAVO,
      instructionType: 'reorder-below',
    });

    expect(result.items).toEqual([BRAVO, folder]);
    expect(result.changed).toBe(true);
    expect(mx.setAccountData).toHaveBeenCalledWith(AccountDataEvent.MindroomSpaces, {
      existing: true,
      sidebar: [BRAVO, folder],
    });
  });

  it('writes io.mindroom.spaces account data for in-folder content reorders', () => {
    const folder: SidebarFolder = { id: 'folder-1', content: [ALPHA, BRAVO] };
    const mx = makeMatrixClient([folder, CHARLIE]);

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: [],
      savedItems: [folder, CHARLIE],
      item: { folder, spaceId: ALPHA },
      containerItem: { folder, spaceId: BRAVO },
      instructionType: 'reorder-below',
    });

    const expected = [{ id: 'folder-1', content: [BRAVO, ALPHA] }, CHARLIE];
    expect(result.items).toEqual(expected);
    expect(result.changed).toBe(true);
    expect(mx.setAccountData).toHaveBeenCalledWith(AccountDataEvent.MindroomSpaces, {
      existing: true,
      sidebar: expected,
    });
  });

  it('writes io.mindroom.spaces account data and notifies onEmptyFolder when ungrouping the last space', () => {
    const folder: SidebarFolder = { id: 'folder-1', content: [ALPHA] };
    const mx = makeMatrixClient([folder, BRAVO]);
    const onEmptyFolder = vi.fn();

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: [],
      savedItems: [folder, BRAVO],
      item: { folder, spaceId: ALPHA },
      containerItem: BRAVO,
      instructionType: 'reorder-below',
      onEmptyFolder,
    });

    expect(result.items).toEqual([BRAVO, ALPHA]);
    expect(result.changed).toBe(true);
    expect(onEmptyFolder).toHaveBeenCalledWith('folder-1');
    expect(mx.setAccountData).toHaveBeenCalledWith(AccountDataEvent.MindroomSpaces, {
      existing: true,
      sidebar: [BRAVO, ALPHA],
    });
  });

  it('round-trips plain reorders, dragging a folder below the lowest space, and dragging the lowest space above the folder', () => {
    const topLevelSpaces = [ALPHA, BRAVO, CHARLIE];
    const isJoinedSpace = joined(ALPHA, BRAVO, CHARLIE);
    const mx = makeMatrixClient([ALPHA, BRAVO, CHARLIE]);

    // Plain-space reorder: move Charlie above Alpha.
    const afterPlain = commitSidebarReorder({
      mx,
      orphanSpaces: topLevelSpaces,
      savedItems: [ALPHA, BRAVO, CHARLIE],
      item: CHARLIE,
      containerItem: ALPHA,
      instructionType: 'reorder-above',
    });
    expect(
      getShownSidebarItems({ saved: afterPlain.items, topLevelSpaces, isJoinedSpace })
    ).toEqual([CHARLIE, ALPHA, BRAVO]);

    // Group Alpha onto Charlie into a folder, leaving Bravo as the lowest standalone space.
    const afterGroup = commitSidebarReorder({
      mx,
      orphanSpaces: topLevelSpaces,
      savedItems: afterPlain.items,
      item: ALPHA,
      containerItem: CHARLIE,
      instructionType: 'make-child',
    });
    const folder = afterGroup.items[0];
    expect(folder && typeof folder !== 'string' ? folder.content : undefined).toEqual([
      CHARLIE,
      ALPHA,
    ]);
    if (!folder || typeof folder === 'string') throw new Error('Expected created folder');
    expect(
      getShownSidebarItems({ saved: afterGroup.items, topLevelSpaces, isJoinedSpace })
    ).toEqual([folder, BRAVO]);

    // Drag the folder below the lowest space.
    const afterFolderBelow = commitSidebarReorder({
      mx,
      orphanSpaces: topLevelSpaces,
      savedItems: afterGroup.items,
      item: { folder },
      containerItem: BRAVO,
      instructionType: 'reorder-below',
    });
    expect(
      getShownSidebarItems({ saved: afterFolderBelow.items, topLevelSpaces, isJoinedSpace })
    ).toEqual([BRAVO, folder]);

    // Move the folder back to the top, then drag the lowest space above the folder.
    const afterFolderAbove = commitSidebarReorder({
      mx,
      orphanSpaces: topLevelSpaces,
      savedItems: afterFolderBelow.items,
      item: { folder },
      containerItem: BRAVO,
      instructionType: 'reorder-above',
    });
    expect(
      getShownSidebarItems({ saved: afterFolderAbove.items, topLevelSpaces, isJoinedSpace })
    ).toEqual([folder, BRAVO]);

    const afterSpaceAbove = commitSidebarReorder({
      mx,
      orphanSpaces: topLevelSpaces,
      savedItems: afterFolderAbove.items,
      item: BRAVO,
      containerItem: { folder },
      instructionType: 'reorder-above',
    });
    expect(
      getShownSidebarItems({ saved: afterSpaceAbove.items, topLevelSpaces, isJoinedSpace })
    ).toEqual([BRAVO, folder]);
  });

  it('preserves unjoined spaces in saved data when dragging a folder below the lowest joined space', () => {
    const folder: SidebarFolder = { id: 'folder-1', content: [ALPHA, BRAVO] };
    const saved = [folder, CHARLIE, DELTA];
    const topLevelSpaces = [ALPHA, BRAVO, CHARLIE];
    const isJoinedSpace = joined(ALPHA, BRAVO, CHARLIE);
    const mx = makeMatrixClient(saved);

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: topLevelSpaces,
      savedItems: saved,
      item: { folder },
      containerItem: CHARLIE,
      instructionType: 'reorder-below',
    });

    expect(result.changed).toBe(true);
    expect(result.items).toEqual([CHARLIE, folder, DELTA]);
    expect(mx.setAccountData).toHaveBeenCalledWith(AccountDataEvent.MindroomSpaces, {
      existing: true,
      sidebar: [CHARLIE, folder, DELTA],
    });
    expect(getShownSidebarItems({ saved: result.items, topLevelSpaces, isJoinedSpace })).toEqual([
      CHARLIE,
      folder,
    ]);
  });

  it('returns changed: false without writing account data on a no-op drag', () => {
    const mx = makeMatrixClient([ALPHA, BRAVO]);
    const onEmptyFolder = vi.fn();

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: [ALPHA, BRAVO],
      savedItems: [ALPHA, BRAVO],
      item: ALPHA,
      containerItem: BRAVO,
      instructionType: 'reorder-above',
      onEmptyFolder,
    });

    expect(result).toEqual({ items: [ALPHA, BRAVO], changed: false });
    expect(mx.setAccountData).not.toHaveBeenCalled();
    expect(onEmptyFolder).not.toHaveBeenCalled();
  });

  it('treats dropping a sole space inside a folder onto its own folder header as make-child as a no-op', () => {
    const folder: SidebarFolder = { id: 'folder-1', content: [ALPHA] };
    const topLevelSpaces = [ALPHA, BRAVO];
    const isJoinedSpace = joined(ALPHA, BRAVO);
    const mx = makeMatrixClient([folder, BRAVO]);
    const onEmptyFolder = vi.fn();

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: topLevelSpaces,
      savedItems: [folder, BRAVO],
      item: { folder, spaceId: ALPHA },
      containerItem: { folder },
      instructionType: 'make-child',
      onEmptyFolder,
    });

    expect(result).toEqual({ items: [folder, BRAVO], changed: false });
    expect(mx.setAccountData).not.toHaveBeenCalled();
    expect(onEmptyFolder).not.toHaveBeenCalled();
    expect(getShownSidebarItems({ saved: result.items, topLevelSpaces, isJoinedSpace })).toEqual([
      folder,
      BRAVO,
    ]);
  });

  it('treats dragging an open folder onto its own child as a no-op', () => {
    const folder: SidebarFolder = { id: 'folder-1', content: [ALPHA, BRAVO] };
    const topLevelSpaces = [ALPHA, BRAVO, CHARLIE];
    const isJoinedSpace = joined(ALPHA, BRAVO, CHARLIE);
    const mx = makeMatrixClient([folder, CHARLIE]);

    const result = commitSidebarReorder({
      mx,
      orphanSpaces: topLevelSpaces,
      savedItems: [folder, CHARLIE],
      item: { folder },
      containerItem: { folder, spaceId: ALPHA },
      instructionType: 'reorder-below',
    });

    expect(result).toEqual({ items: [folder, CHARLIE], changed: false });
    expect(mx.setAccountData).not.toHaveBeenCalled();
    expect(getShownSidebarItems({ saved: result.items, topLevelSpaces, isJoinedSpace })).toEqual([
      folder,
      CHARLIE,
    ]);
  });
});
