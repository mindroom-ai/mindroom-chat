import {
  ConditionKind,
  PushRuleActionName,
  PushRuleKind,
  type MatrixClient,
  type PushRuleAction,
  type PushRuleCondition,
} from 'matrix-js-sdk';

type PushRuleClient = Pick<MatrixClient, 'addPushRule'>;

type StreamPushRule = {
  ruleId: string;
  status: string;
  actions: PushRuleAction[];
};

const STREAM_STATUS_EVENT_PATH = 'content.io\\.mindroom\\.stream_status';

const streamStatusConditions = (status: string): PushRuleCondition[] => [
  {
    kind: ConditionKind.EventMatch,
    key: 'type',
    pattern: 'm.room.message',
  },
  {
    kind: ConditionKind.EventMatch,
    key: STREAM_STATUS_EVENT_PATH,
    pattern: status,
  },
];

const MINDROOM_STREAM_PUSH_RULES: StreamPushRule[] = [
  {
    ruleId: 'io.mindroom.suppress_stream_pending',
    status: 'pending',
    actions: [],
  },
  {
    ruleId: 'io.mindroom.suppress_stream_streaming',
    status: 'streaming',
    actions: [],
  },
  {
    ruleId: 'io.mindroom.notify_stream_completed',
    status: 'completed',
    actions: [PushRuleActionName.Notify],
  },
  {
    ruleId: 'io.mindroom.notify_stream_cancelled',
    status: 'cancelled',
    actions: [PushRuleActionName.Notify],
  },
  {
    ruleId: 'io.mindroom.notify_stream_interrupted',
    status: 'interrupted',
    actions: [PushRuleActionName.Notify],
  },
  {
    ruleId: 'io.mindroom.notify_stream_error',
    status: 'error',
    actions: [PushRuleActionName.Notify],
  },
];

export const ensureMindroomStreamingPushRules = async (mx: PushRuleClient): Promise<void> => {
  await Promise.all(
    MINDROOM_STREAM_PUSH_RULES.map((rule) =>
      mx.addPushRule('global', PushRuleKind.Override, rule.ruleId, {
        conditions: streamStatusConditions(rule.status),
        actions: rule.actions,
      })
    )
  );
};
