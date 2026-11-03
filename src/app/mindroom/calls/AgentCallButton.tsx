type AgentCallButtonProps = {
  /** The room the profile was opened from; a call started here remembers it as its origin. */
  roomId: string;
  userId: string;
  displayName?: string;
  /** The agent's presence status message, which advertises voice calls. */
  presenceStatus?: string;
};

/**
 * The profile's "Call" button for a voice-capable MindRoom agent. Calls ran in the embedded
 * Element Call widget, which this client does not include; they return on LiveKit, and until
 * then the button is not shown.
 */
export function AgentCallButton(_props: AgentCallButtonProps): null {
  return null;
}
