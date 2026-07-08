import React from 'react';
import { Box, Icon, Icons, Text, Tooltip, TooltipProvider, color } from 'folds';
import { useAgentDeviceCrossSigned } from './useAgentDeviceTrust';

type AgentVerifiedBadgeProps = {
  userId: string;
  size?: '50' | '100' | '200' | '300' | '400';
};

/**
 * A small shield shown next to a MindRoom agent whose device identity is
 * cross-signed. Renders nothing for non-agents, agents that have not
 * bootstrapped cross-signing, or when crypto is unavailable, keeping the
 * baseline visually quiet.
 */
export function AgentVerifiedBadge({ userId, size = '50' }: AgentVerifiedBadgeProps) {
  const crossSigned = useAgentDeviceCrossSigned(userId);
  if (!crossSigned) return null;

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
        <Box as="span" ref={triggerRef} shrink="No" alignItems="Center">
          <Icon size={size} src={Icons.ShieldUser} style={{ color: color.Success.Main }} />
        </Box>
      )}
    </TooltipProvider>
  );
}
