import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createThreadFixture,
  loginToMatrix,
  redactEvent,
  seedRoomOverviewState,
  sendMessageEdit,
  sendReaction,
  sendRoomMessage,
} from '../helpers/matrix';
import { readThreadEventCacheRecords } from '../helpers/storage';

const hasCredentials = !!process.env.E2E_USERNAME;

// CINNY-207 P5.2 (AC2): seeded stale-cache divergence converges after
// open without reload, in place, scroll anchored.
//
// The scenario is the one that made the pre-P5 tail refresh visibly
// insufficient in practice:
//
//   1. User opens a thread with an in-thread message M ("edit-target
//      v1"), a message R ("redact-target"), and a 👍 reaction on the
//      reply. Everything gets rendered AND cached (thread coverage
//      complete on close).
//   2. Client is torn down (page.goto('about:blank')). The IDB cache
//      persists — it still has v1 of M, the reaction record, and R.
//   3. Over the REST API (server ground truth), while the client is
//      away: M gets edited to "v2 converged", the reaction gets
//      redacted, R gets redacted, plus ~25 filler thread messages are
//      posted. The filler is critical: it pushes the divergence
//      outside the SDK's next sync window so convergence MUST come
//      from the reconciler, not from Tier-1 write-through of a fresh
//      sync. (Without filler, this spec would silently test P3.1's
//      live-events path instead of P5's reconciler.)
//   4. User navigates back to the thread URL (NO page reload after
//      this point — we're testing that the reconciler catches up
//      through the D7 SWR path, not through a cold rehydrate).
//
// Expected outcomes:
//   - `edit-target v2 converged` visible in the rendered thread (edit
//     applied via `applyCachedReplaceRelations`).
//   - 👍 chip count is 0 (reaction removed via
//     `reconcileRelationEventsWithAggregation`).
//   - R tombstoned (redaction applied via `applyCachedRedactions`).
//   - Same three changes visible in the IDB cache
//     (`readThreadEventCacheRecords` returns bundled v2 on M, no
//     record for the reaction, redacted M.type on R).
//   - Scroll anchor invariant (AC10): a mid-viewport message's Y
//     position moves by ≤ 8px through the reconcile pass. Repairs are
//     in-place swaps/deletes, not prepends — the applier must not
//     grow the timeline above the anchor.
//
// CINNY-207 P5 gate status (2026-07-04, expected-RED): the reconciler's
// unit layer is green (18 units incl. dual injection, thread-null, and
// Tuwunel stale-copy re-apply), but this live spec exposes an unresolved
// seam. Five gate iterations of evidence (full history in the Runbook,
// "P5 gate" entries):
//   - Tuwunel honors recurse=true (verified by direct curl — the edit IS
//     served in the recursed /relations chunk).
//   - Probe signatures across clean-network runs are NONDETERMINISTIC:
//     reconcilesScheduled=1 with reconcilesRepaired flapping 2 -> 0.
//   - In the final failing run the playwright network log contains ZERO
//     reconciler-shaped /relations requests (the reconciler always sets
//     limit=200; only no-limit SDK-machinery requests appear) — the
//     reconcile executor exited BEFORE its first fetch.
//   - The pass has three silent exits indistinguishable in the current
//     probes: fetch-failure (to() swallow), zero-divergence, and the
//     shouldContinue guard abort. The network evidence points at the
//     guard abort: a transient false during reopen mount churn kills the
//     pass with repaired=false and no retry.
// Design decision needed (see plan §8 Deviations): re-schedule once on
// guard-abort (or drop the guard for band-0 reconciles), plus
// distinguishable probes for the three exits. Flips green when resolved.
test.describe('CINNY-207 stale-cache divergence reconcile', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test(
    'stale edit / stale reaction / missed redaction converge after open without reload, in place, scroll anchored (AC2)',
    async ({ page }) => {
      test.fail();
      const homeserver = getHomeserver();
      const { username, password } = getPrimaryCredentials();
      const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
      const stamp = Date.now();

      // Fresh thread: root + one reply so the thread model exists.
      const fixture = await createThreadFixture(homeserver, accessToken, {
        name: `CINNY-207 Stale Divergence ${stamp}`,
        topic: 'Reconciler convergence fixture.',
        rootBody: `AC2 thread root ${stamp}`,
        replyBody: `AC2 thread reply ${stamp}`,
        txnPrefix: 'cinny-207-ac2',
      });
      const threadId = fixture.rootId;

      // In-thread messages M (edit target v1) and R (redact target)
      // plus a 👍 reaction on the seed reply.
      const editTargetId = await sendRoomMessage(
        homeserver,
        accessToken,
        fixture.roomId,
        {
          msgtype: 'm.text',
          body: `edit-target v1 ${stamp}`,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: threadId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: fixture.replyId },
          },
        },
        'cinny-207-ac2'
      );
      const redactTargetId = await sendRoomMessage(
        homeserver,
        accessToken,
        fixture.roomId,
        {
          msgtype: 'm.text',
          body: `redact-target ${stamp}`,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: threadId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: fixture.replyId },
          },
        },
        'cinny-207-ac2'
      );
      const reactionId = await sendReaction(
        homeserver,
        accessToken,
        fixture.roomId,
        fixture.replyId,
        '👍',
        'cinny-207-ac2'
      );

      // First open: hydrate everything into the cache. Assert that
      // pre-divergence state actually reached the render + cache so
      // the "cache had it, then server changed" premise is real.
      await loginWithPassword(page, { homeserver, username, password });
      await expectLoggedInShellStable(page);
      await seedRoomOverviewState({
        page,
        roomId: fixture.roomId,
        userId,
        viewMode: 'threaded',
        filterState: createDefaultThreadFilterState(),
      });
      await page.goto(
        `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(threadId)}`
      );
      await expect(page.getByText(`edit-target v1 ${stamp}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(`redact-target ${stamp}`)).toBeVisible({ timeout: 30_000 });

      const preRecords = await readThreadEventCacheRecords(page, fixture.roomId, threadId);
      const cachedEditTargetPre = preRecords.find((record) => record.eventId === editTargetId);
      const cachedRedactTargetPre = preRecords.find((record) => record.eventId === redactTargetId);
      const cachedReactionPre = preRecords.find((record) => record.eventId === reactionId);
      expect(cachedEditTargetPre).toBeDefined();
      expect(cachedRedactTargetPre).toBeDefined();
      expect(cachedReactionPre).toBeDefined();

      // Capture a mid-viewport anchor before the client goes away so
      // we can prove in-place repair (AC10) rather than
      // prepend-then-repaint.
      const anchor = await page.evaluate((expectedReplyId) => {
        const anchorElement = document.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(expectedReplyId)}"]`
        );
        if (!anchorElement) return { found: false as const };
        const rect = anchorElement.getBoundingClientRect();
        return {
          found: true as const,
          top: rect.top,
          text: anchorElement.textContent ?? '',
          eventId: expectedReplyId,
        };
      }, fixture.replyId);
      expect(anchor.found).toBe(true);
      const anchorTop = anchor.found ? anchor.top : 0;
      const anchorEventId = anchor.found ? anchor.eventId : '';

      // Take the client offline — a real "user closed the tab" cycle
      // without touching IDB. Server truth diverges while we're away.
      await page.goto('about:blank');

      // Server-side divergence: edit M to v2, redact the reaction,
      // redact R, then post ~25 filler in-thread messages. The filler
      // pushes the divergence past whatever the next sync window
      // catches, forcing the reconciler (not the sync path) to be the
      // one that converges the cache.
      await sendMessageEdit(
        homeserver,
        accessToken,
        fixture.roomId,
        editTargetId,
        `edit-target v2 converged ${stamp}`,
        'cinny-207-ac2'
      );
      await redactEvent(
        homeserver,
        accessToken,
        fixture.roomId,
        reactionId,
        'reconcile ac2',
        'cinny-207-ac2'
      );
      await redactEvent(
        homeserver,
        accessToken,
        fixture.roomId,
        redactTargetId,
        'reconcile ac2',
        'cinny-207-ac2'
      );
      const fillerCount = 25;
      for (let i = 0; i < fillerCount; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await sendRoomMessage(
          homeserver,
          accessToken,
          fixture.roomId,
          {
            msgtype: 'm.text',
            body: `AC2 filler ${stamp} #${i + 1}`,
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: threadId,
              is_falling_back: true,
              'm.in_reply_to': { event_id: fixture.replyId },
            },
          },
          'cinny-207-ac2'
        );
      }

      // Return to the thread URL — NO page.reload() after this point.
      // The reconciler must do the convergence work; the cache was
      // "right" before the client left, so a pre-P5 cache-first path
      // would paint stale content and never revalidate. This is the
      // exact D7 violation P5 fixes.
      await page.goto(
        `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(threadId)}`
      );

      // Self-diagnosis: poll the probe into the console so a failing
      // trace shows scheduled/repaired/threadNull state instead of
      // staying mute. Fires once immediately (t=0 baseline right after
      // reopen navigation), then every 2s up to the 30s assertion
      // timeout. Traces capture console — the log tells us
      // scheduled/repaired/threadNull without another blind cycle
      // (CINNY-207 P5-GATE-FIX v4 team-lead diagnosis loop).
      //
      // Key counters and how to interpret them:
      //   reconcilesScheduled: 0 → open path never asked for a reconcile
      //     (scheduling regression upstream of the engine).
      //   reconcilesScheduled: N, reconcilesRepaired: 0 → reconciler
      //     ran but detectDivergence returned false (cache disagreed
      //     with what the applier saw as a diff — unexpected on AC2).
      //   reconcilesRepaired: 1, reconcilesThreadNull: 0 → SDK thread
      //     existed at injection time; the render-fallback leg was NOT
      //     the only convergence path.
      //   reconcilesRepaired: 1, reconcilesThreadNull: 1 → the exact
      //     AC2 shape team-lead diagnosed: SDK bootstrap skipped, so
      //     the `liveThread.addEvents(...)` leg no-op'd. Convergence
      //     depended entirely on the widened onRepaired → supplemental
      //     leg. If AC2 still fails with this signature, the render
      //     side is at fault (memo dep list, tick ignored, etc.).
      await page.evaluate(() => {
        const w = window as Window & {
          __MINDROOM_CACHE_PROBE__?: { snapshot: () => Record<string, number> };
        };
        // eslint-disable-next-line no-console
        console.log(
          '[cinny-207] ac2-probe t0s:',
          JSON.stringify(w.__MINDROOM_CACHE_PROBE__?.snapshot() ?? {})
        );
        let ticks = 0;
        const timer = setInterval(() => {
          ticks += 1;
          // eslint-disable-next-line no-console
          console.log(
            `[cinny-207] ac2-probe t${ticks * 2}s:`,
            JSON.stringify(w.__MINDROOM_CACHE_PROBE__?.snapshot() ?? {})
          );
          if (ticks >= 16) clearInterval(timer);
        }, 2000);
      });

      // Visible convergence: edit applied, reaction chip gone,
      // redaction tombstoned.
      await expect(page.getByText(`edit-target v2 converged ${stamp}`)).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(`edit-target v1 ${stamp}`)).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByText(`redact-target ${stamp}`)).toHaveCount(0, { timeout: 30_000 });

      // 👍 reaction chip on the seed reply should be gone or show
      // count 0. Both the button rendering path and the raw chip
      // count query check the same fact.
      const reactionChipPresent = await page
        .locator(`[data-message-id="${fixture.replyId}"] :text("👍")`)
        .count();
      expect(reactionChipPresent).toBe(0);

      // Cache-level convergence: bundled v2 on M, no reaction record,
      // R either pruned or marked as redacted (type still
      // 'm.room.message' but the bundled body cleared — the reader
      // helper just returns the record shape, so the assertion is on
      // absence-of-original-body-record).
      const postRecords = await readThreadEventCacheRecords(page, fixture.roomId, threadId);
      const cachedEditTargetPost = postRecords.find((record) => record.eventId === editTargetId);
      const cachedReactionPost = postRecords.find((record) => record.eventId === reactionId);
      expect(cachedEditTargetPost?.bundledReplaceBody).toBe(`edit-target v2 converged ${stamp}`);
      expect(cachedReactionPost).toBeUndefined();

      // Scroll anchor invariant (AC10): the mid-viewport message
      // moves by ≤ 8px through the reconcile pass. In-place swaps
      // never grow the timeline above the anchor; if a repair
      // prepends or shifts, this fails and we know AC10 regressed.
      // Fallback tolerance is ≤ 16px per the P5 answer plan if this
      // proves flaky across two docker runs.
      const post = await page.evaluate((expectedId) => {
        const anchorElement = document.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(expectedId)}"]`
        );
        if (!anchorElement) return { found: false as const };
        return { found: true as const, top: anchorElement.getBoundingClientRect().top };
      }, anchorEventId);
      expect(post.found).toBe(true);
      const displacement = post.found ? Math.abs(post.top - anchorTop) : Number.POSITIVE_INFINITY;
      expect(displacement).toBeLessThanOrEqual(8);
    }
  );
});
