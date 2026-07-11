import {
  ConditionKind,
  PushRuleActionName,
  PushRuleKind,
  TweakName,
  type MatrixClient,
  type PushRuleAction,
  type PushRuleCondition,
} from 'matrix-js-sdk';
import { getMxIdServer } from '../../utils/matrix';

type PushRuleClient = Pick<MatrixClient, 'addPushRule' | 'getSafeUserId'>;

type StreamPushRule = {
  ruleId: string;
  status: string;
  actions: PushRuleAction[];
};

const STREAM_STATUS_EVENT_PATH = 'content.io\\.mindroom\\.stream_status';
const MINDROOM_AGENT_LOCALPART_GLOB = 'mindroom_*';
const NOTIFY_WITH_SOUND: PushRuleAction[] = [
  PushRuleActionName.Notify,
  { set_tweak: TweakName.Sound, value: 'default' },
];
const pushRuleInstallations = new WeakMap<PushRuleClient, Promise<void>>();

const escapeGlobLiteral = (value: string): string => value.replace(/[\\*?[\]]/g, '\\$&');

const agentSenderGlob = (mx: PushRuleClient): string => {
  const server = getMxIdServer(mx.getSafeUserId());
  if (!server) throw new Error('Cannot install MindRoom push rules without a valid Matrix user ID');
  return `@${MINDROOM_AGENT_LOCALPART_GLOB}:${escapeGlobLiteral(server)}`;
};

const streamStatusConditions = (status: string, senderGlob: string): PushRuleCondition[] => [
  {
    kind: ConditionKind.EventMatch,
    key: 'type',
    pattern: 'm.room.message',
  },
  {
    kind: ConditionKind.EventMatch,
    key: 'sender',
    pattern: senderGlob,
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
    actions: NOTIFY_WITH_SOUND,
  },
  {
    ruleId: 'io.mindroom.notify_stream_cancelled',
    status: 'cancelled',
    actions: NOTIFY_WITH_SOUND,
  },
  {
    ruleId: 'io.mindroom.notify_stream_interrupted',
    status: 'interrupted',
    actions: NOTIFY_WITH_SOUND,
  },
  {
    ruleId: 'io.mindroom.notify_stream_error',
    status: 'error',
    actions: NOTIFY_WITH_SOUND,
  },
];

export const ensureMindroomStreamingPushRules = async (mx: PushRuleClient): Promise<void> => {
  const existingInstallation = pushRuleInstallations.get(mx);
  if (existingInstallation) return existingInstallation;

  const senderGlob = agentSenderGlob(mx);
  const installation = Promise.all(
    MINDROOM_STREAM_PUSH_RULES.map((rule) =>
      mx.addPushRule('global', PushRuleKind.Override, rule.ruleId, {
        conditions: streamStatusConditions(rule.status, senderGlob),
        actions: rule.actions,
      })
    )
  ).then(() => undefined);
  pushRuleInstallations.set(mx, installation);

  try {
    await installation;
  } catch (error) {
    pushRuleInstallations.delete(mx);
    throw error;
  }
};
