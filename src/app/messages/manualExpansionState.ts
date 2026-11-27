import { DISCLOSURE_KEY_PREFIX } from '../ui/manualExpansionState';

export {
  DISCLOSURE_KEY_PREFIX,
  ExpandAllInitContext,
  MANUAL_EXPANSION_STATE_LIMIT,
  ManualExpansionStateContext,
  clearBulkExpansionOverrides,
  rememberManualExpansionState,
  usePersistedDisclosure,
} from '../ui/manualExpansionState';

export const replyDisclosureScope = (
  roomId: string | undefined,
  eventId: string | undefined
): string | undefined =>
  eventId ? `${DISCLOSURE_KEY_PREFIX}${roomId ?? ''}:${eventId}:` : undefined;

// Disclosures rendered inside the tool-call cog (`ToolCallsFold`), hidden while the cog is closed.
const TOOL_FOLD_CHILD_PREFIXES = [
  'tool-run:',
  'tool-result:',
  'live-shell:',
  'live-subagent:',
  'secret:',
];

/**
 * Whether any inner disclosure inside the reply identified by `scope` is currently open.
 * When tool calls are hidden behind a closed cog (`toolsShown === false` and `tool-fold` is not
 * open), disclosures nested inside the cog are ignored so closing the cog lets finished work fold.
 */
export const hasOpenReplyDisclosure = (
  state: ReadonlyMap<string, boolean> | undefined,
  scope: string | undefined,
  opts?: { toolsShown?: boolean }
): boolean => {
  if (!state || !scope) return false;
  const ignoreToolFoldChildren =
    opts?.toolsShown === false && state.get(`${scope}tool-fold`) !== true;
  for (const [key, value] of state) {
    if (value !== true || !key.startsWith(scope)) continue;
    if (ignoreToolFoldChildren) {
      const suffix = key.slice(scope.length);
      if (TOOL_FOLD_CHILD_PREFIXES.some((prefix) => suffix.startsWith(prefix))) continue;
    }
    return true;
  }
  return false;
};
