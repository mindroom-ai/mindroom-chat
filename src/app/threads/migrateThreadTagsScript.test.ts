import { describe, expect, it } from 'vitest';
import {
  buildMigrationPlans,
  changesVisibleTags,
  collectRoomState,
  predictMergedStateAfterMigration,
} from '../../../scripts/migrate-thread-tags.mjs';
import { MINDROOM_THREAD_TAGS_EVENT } from '../event-store/threads/threadTags';

describe('migrate-thread-tags script helpers', () => {
  it('tombstones malformed legacy state keys even when no valid tags survive parsing', () => {
    const collectedState = collectRoomState(
      [
        {
          type: MINDROOM_THREAD_TAGS_EVENT,
          state_key: '$root',
          content: {
            tags: {
              urgent: { set_by: '@alice:example.org' },
              'bad tag': {
                set_by: '@alice:example.org',
                set_at: '2026-04-07T00:00:01.000Z',
              },
            },
          },
        },
      ],
      '@alice:example.org'
    );

    expect(collectedState.legacyStateKeys).toEqual(['$root']);
    expect(collectedState.legacyStates).toEqual([]);
    expect(collectedState.warnings).toEqual([
      'Skipping invalid urgent payload in legacy state "$root".',
      'Skipping invalid tag name "bad tag" in legacy state "$root".',
    ]);

    const migrationPlans = buildMigrationPlans(collectedState);

    expect(migrationPlans.plans).toEqual([
      {
        threadRootId: '$root',
        writes: [],
        tombstoneLegacy: true,
        skipped: [],
      },
    ]);
    expect(migrationPlans.totalWrites).toBe(0);
    expect(migrationPlans.totalLegacyTombstones).toBe(1);

    const predictedMergedState = predictMergedStateAfterMigration(collectedState, migrationPlans);

    expect(Array.from(predictedMergedState.entries())).toEqual(
      Array.from(collectedState.merged.entries())
    );
  });

  // The client names a tag's sender unless the sender is the person the tag names or a MindRoom
  // agent on the viewer's homeserver, and the migration's writes come from the account running it,
  // so the migration may write only what that account's view of the room keeps unchanged.
  describe('whose writes keep the tags a room shows', () => {
    const ALICE = '@alice:example.org';
    const OPERATOR = '@operator:example.org';
    const legacyResolved = (sender: string, setBy: string) => ({
      type: MINDROOM_THREAD_TAGS_EVENT,
      state_key: '$root',
      sender,
      content: { tags: { resolved: { set_by: setBy, set_at: '2026-04-07T00:00:01.000Z' } } },
    });
    const resolvers = (events: ReturnType<typeof legacyResolved>[], runAs: string) => {
      const collected = collectRoomState(events, runAs);
      const predicted = predictMergedStateAfterMigration(collected, buildMigrationPlans(collected));
      return [collected.merged, predicted].map(
        (merged) => merged.get('$root')?.tags.resolved?.set_by
      );
    };

    it("would name the account running it on another person's tag", () => {
      expect(resolvers([legacyResolved(ALICE, ALICE)], OPERATOR)).toEqual([ALICE, OPERATOR]);
    });

    it('keeps the person when a MindRoom agent of the homeserver runs it', () => {
      expect(resolvers([legacyResolved(ALICE, ALICE)], '@mindroom_router:example.org')).toEqual([
        ALICE,
        ALICE,
      ]);
    });

    it('keeps the tags when every write names the account running it', () => {
      expect(resolvers([legacyResolved(OPERATOR, OPERATOR)], OPERATOR)).toEqual([
        OPERATOR,
        OPERATOR,
      ]);
    });

    it.each([OPERATOR, '@mindroom_helper:elsewhere.example'])(
      'would name the person a tag from %s claims, where the room shows its sender, even run by an agent',
      (sender) => {
        expect(resolvers([legacyResolved(sender, ALICE)], '@mindroom_router:example.org')).toEqual([
          sender,
          ALICE,
        ]);
      }
    );

    it('would name the agent running it to the members of another homeserver', () => {
      const runAs = '@mindroom_router:example.org';
      const refuses = (events: Parameters<typeof collectRoomState>[0]) => {
        const collected = collectRoomState(events, runAs);
        return changesVisibleTags(collected, buildMigrationPlans(collected));
      };
      const member = (userId: string, membership: string) => ({
        type: 'm.room.member',
        state_key: userId,
        sender: userId,
        content: { membership },
      });
      const tag = legacyResolved(ALICE, ALICE);
      const bob = '@bob:elsewhere.example';
      expect(refuses([tag, member(ALICE, 'join')])).toBe(false);
      expect(refuses([tag, member(bob, 'leave')])).toBe(false);
      expect(refuses([tag, member(bob, 'join')])).toBe(true);
    });
  });
});
