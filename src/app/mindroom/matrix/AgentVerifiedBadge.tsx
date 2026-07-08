import React from 'react';
import { Box, Icon, Icons, Text, Tooltip, TooltipProvider, color } from 'folds';
import { isMindroomAgentUserId } from './agentIdentity';
import { useAgentDeviceCrossSigned } from './useAgentDeviceTrust';

type ShieldSize = '50' | '100' | '200' | '300' | '400';

type AgentVerifiedBadgeProps = {
  userId: string;
  size?: ShieldSize;
};

function AgentVerifiedShield({ size }: { size: ShieldSize }) {
  return (
    <TooltipProvider
      position="Top"
      tooltip={
        <Tooltip>
          <Text size="T200">Verified agent · cross-signed device</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <Box
          as="span"
          ref={triggerRef}
          shrink="No"
          alignItems="Center"
          role="img"
          aria-label="Verified agent"
        >
          <Icon size={size} src={Icons.ShieldUser} style={{ color: color.Success.Main }} />
        </Box>
      )}
    </TooltipProvider>
  );
}

function AgentVerifiedBadgeInner({ userId, size }: { userId: string; size: ShieldSize }) {
  const crossSigned = useAgentDeviceCrossSigned(userId);
  if (!crossSigned) return null;

  return <AgentVerifiedShield size={size} />;
}

/**
 * A small shield shown next to a MindRoom agent whose device identity is
 * cross-signed. Non-agents short-circuit before any crypto hook runs (so member
 * rows for humans do no crypto work and register no device-list listeners);
 * agents that have not bootstrapped cross-signing, or clients without crypto,
 * render nothing, keeping the baseline visually quiet.
 */
export function AgentVerifiedBadge({ userId, size = '50' }: AgentVerifiedBadgeProps) {
  if (!isMindroomAgentUserId(userId)) return null;

  return <AgentVerifiedBadgeInner userId={userId} size={size} />;
}
