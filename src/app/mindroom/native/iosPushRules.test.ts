import {
  ConditionKind,
  MatrixEvent,
  PushRuleActionName,
  PushRuleKind,
  type IPushRule,
  type MatrixClient,
} from 'matrix-js-sdk';
import { PushProcessor } from 'matrix-js-sdk/lib/pushprocessor';
import { describe, expect, it, vi } from 'vitest';
import { ensureMindroomStreamingPushRules } from './iosPushRules';

describe('ensureMindroomStreamingPushRules', () => {
  it('suppresses active stream events and notifies on terminal edits', async () => {
    const addPushRule = vi.fn().mockResolvedValue({});

    const pushRuleClient = {
      addPushRule,
      getSafeUserId: () => '@viewer:example.org',
    };

    await ensureMindroomStreamingPushRules(pushRuleClient);

    const expectedRules = [
      ['io.mindroom.suppress_stream_pending', 'pending', []],
      ['io.mindroom.suppress_stream_streaming', 'streaming', []],
      [
        'io.mindroom.notify_stream_completed',
        'completed',
        [PushRuleActionName.Notify, { set_tweak: 'sound', value: 'default' }],
      ],
      [
        'io.mindroom.notify_stream_cancelled',
        'cancelled',
        [PushRuleActionName.Notify, { set_tweak: 'sound', value: 'default' }],
      ],
      [
        'io.mindroom.notify_stream_interrupted',
        'interrupted',
        [PushRuleActionName.Notify, { set_tweak: 'sound', value: 'default' }],
      ],
      [
        'io.mindroom.notify_stream_error',
        'error',
        [PushRuleActionName.Notify, { set_tweak: 'sound', value: 'default' }],
      ],
    ] as const;

    expect(addPushRule).toHaveBeenCalledTimes(expectedRules.length);
    expectedRules.forEach(([ruleId, status, actions], index) => {
      expect(addPushRule).toHaveBeenNthCalledWith(
        index + 1,
        'global',
        PushRuleKind.Override,
        ruleId,
        {
          conditions: [
            {
              kind: ConditionKind.EventMatch,
              key: 'type',
              pattern: 'm.room.message',
            },
            {
              kind: ConditionKind.EventMatch,
              key: 'sender',
              pattern: '@mindroom_*:example.org',
            },
            {
              kind: ConditionKind.EventMatch,
              key: 'content.io\\.mindroom\\.stream_status',
              pattern: status,
            },
          ],
          actions,
        }
      );
    });

    const processor = new PushProcessor({
      supportsIntentionalMentions: () => false,
    } as MatrixClient);
    const eventForStatus = (status: string, sender = '@mindroom_agent:example.org') =>
      new MatrixEvent({
        event_id: `$${status}`,
        room_id: '!room:example.org',
        sender,
        origin_server_ts: 1,
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: 'Agent response',
          'io.mindroom.stream_status': status,
          'm.relates_to': {
            rel_type: 'm.replace',
            event_id: '$initial',
          },
        },
        unsigned: {},
      });
    const pendingRule = addPushRule.mock.calls[0][3];
    const completedRule = addPushRule.mock.calls[2][3];

    expect(processor.ruleMatchesEvent(pendingRule, eventForStatus('pending'))).toBe(true);
    expect(processor.ruleMatchesEvent(pendingRule, eventForStatus('completed'))).toBe(false);
    expect(processor.ruleMatchesEvent(completedRule, eventForStatus('completed'))).toBe(true);
    expect(processor.ruleMatchesEvent(completedRule, eventForStatus('streaming'))).toBe(false);
    expect(
      processor.ruleMatchesEvent(pendingRule, eventForStatus('pending', '@mallory:example.org'))
    ).toBe(false);
    expect(
      processor.ruleMatchesEvent(
        completedRule,
        eventForStatus('completed', '@mindroom_forged:evil.example')
      )
    ).toBe(false);

    const installedRules: IPushRule[] = expectedRules.map(([ruleId], index) => ({
      ...addPushRule.mock.calls[index][3],
      rule_id: ruleId,
      default: false,
      enabled: true,
    }));
    const suppressEditsRule: IPushRule = {
      rule_id: '.m.rule.suppress_edits',
      default: true,
      enabled: true,
      conditions: [
        {
          kind: ConditionKind.EventMatch,
          key: 'content.m\\.relates_to.rel_type',
          pattern: 'm.replace',
        },
      ],
      actions: [],
    };
    const pushRules = {
      global: { override: [...installedRules, suppressEditsRule] },
    };
    const priorityProcessor = new PushProcessor({
      pushRules,
      getSafeUserId: () => '@viewer:example.org',
      supportsIntentionalMentions: () => false,
    } as unknown as MatrixClient);

    expect(priorityProcessor.actionsAndRuleForEvent(eventForStatus('pending'))).toMatchObject({
      actions: { notify: false },
      rule: { rule_id: 'io.mindroom.suppress_stream_pending' },
    });
    expect(priorityProcessor.actionsAndRuleForEvent(eventForStatus('completed'))).toMatchObject({
      actions: { notify: true, tweaks: { sound: 'default' } },
      rule: { rule_id: 'io.mindroom.notify_stream_completed' },
    });

    await ensureMindroomStreamingPushRules(pushRuleClient);
    expect(addPushRule).toHaveBeenCalledTimes(6);
  });

  it('fails fast when a rule cannot be installed', async () => {
    const addPushRule = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('push rules unavailable'));

    await expect(
      ensureMindroomStreamingPushRules({
        addPushRule,
        getSafeUserId: () => '@viewer:example.org',
      })
    ).rejects.toThrow('push rules unavailable');
    expect(addPushRule).toHaveBeenCalledTimes(6);
  });
});
