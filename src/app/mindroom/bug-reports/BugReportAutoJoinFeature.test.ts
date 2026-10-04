import { describe, expect, it } from 'vitest';
import { shouldAutoJoinBugReportInvite } from './BugReportAutoJoinFeature';

const mx = (userId = '@admin:example.com') => ({ getUserId: () => userId });

/** `type: null` leaves the invite without an m.room.create event. */
const invitedRoom = (
  opts: { type?: string | null; inviter?: string; membership?: string } = {}
) => ({
  getMyMembership: () => opts.membership ?? 'invite',
  getLiveTimeline: () => ({
    getState: () => ({
      getStateEvents: (eventType: string) =>
        eventType === 'm.room.create' && opts.type !== null
          ? { getContent: () => ({ type: opts.type ?? 'io.mindroom.bug_reports' }) }
          : null,
    }),
  }),
  getMember: () => ({
    events: { member: { getSender: () => opts.inviter ?? '@alice:example.com' } },
  }),
});

const admins = ['@admin:example.com'];

describe('shouldAutoJoinBugReportInvite', () => {
  it('joins report rooms from reporters on the same homeserver', () => {
    expect(shouldAutoJoinBugReportInvite(mx() as never, invitedRoom() as never, admins)).toBe(true);
  });

  it('ignores users who are not configured admins', () => {
    expect(
      shouldAutoJoinBugReportInvite(mx('@bob:example.com') as never, invitedRoom() as never, admins)
    ).toBe(false);
  });

  it('ignores other room types', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ type: 'm.space' }) as never,
        admins
      )
    ).toBe(false);
  });

  it('ignores invites without a create event', () => {
    expect(
      shouldAutoJoinBugReportInvite(mx() as never, invitedRoom({ type: null }) as never, admins)
    ).toBe(false);
  });

  it('ignores inviters from other homeservers', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ inviter: '@mallory:evil.example' }) as never,
        admins
      )
    ).toBe(false);
  });

  it('ignores rooms that are not pending invites', () => {
    expect(
      shouldAutoJoinBugReportInvite(
        mx() as never,
        invitedRoom({ membership: 'join' }) as never,
        admins
      )
    ).toBe(false);
    expect(shouldAutoJoinBugReportInvite(mx() as never, null, admins)).toBe(false);
  });
});
