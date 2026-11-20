import type { ReactNode } from 'react';
import classNames from 'classnames';
import { Icon, Icons } from 'folds';
import type { AiRunModelInfo } from '../matrix/protocol/aiRun';
import type { SubagentMeta } from '../matrix/protocol/subagentFrame';
import { isRestartInterrupted } from '../matrix/protocol/subagentFrame';
import { ProviderModelIcon } from '../models/ProviderModelIcon';
import { AgentAvatar, type AgentProfile } from './SubagentRunCard';
import * as css from './RunLogo.css';

export type RunLogoState = keyof typeof css.Dot;

/** How a run stands, as its logo's dot shows it. */
export const runLogoState = (meta: SubagentMeta): RunLogoState => {
  if (meta.status === 'running') return 'running';
  if (meta.status === 'awaiting_approval') return 'waiting';
  if (isRestartInterrupted(meta)) return 'finished';
  if (meta.status === 'failed' || meta.status === 'denied' || meta.status === 'cancelled') {
    return 'stopped';
  }
  return 'finished';
};

/**
 * A run's logo: its model's, else its agent's picture, else a terminal, on a tile with a dot that
 * says how it stands. The dot is decoration; the words beside it say it too.
 */
export function RunLogo({
  model,
  agent,
  state,
  small = false,
  dot = true,
  className,
  kind,
}: {
  model?: AiRunModelInfo;
  agent?: AgentProfile;
  state: RunLogoState;
  small?: boolean;
  dot?: boolean;
  className?: string;
  // What the tile shows when it has no model: the agent's picture, or a tool's terminal.
  kind: 'agent' | 'tool';
}) {
  let logo: ReactNode = <Icon src={Icons.Terminal} size={small ? '50' : '100'} aria-hidden />;
  if (model) {
    logo = (
      <ProviderModelIcon provider={model.modelProvider} id={model.modelId} size={small ? 12 : 16} />
    );
  } else if (kind === 'agent' && agent) {
    logo = <AgentAvatar agent={agent} size="200" />;
  }
  return (
    <span
      className={classNames(css.Logo, className)}
      data-job-logo={model ? 'model' : kind}
      data-model-provider={model?.modelProvider}
      aria-hidden
    >
      {logo}
      {dot && <span className={css.Dot[state]} data-job-state={state} />}
    </span>
  );
}
