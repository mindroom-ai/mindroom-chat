type AgentCallHeaderButtonProps = {
  /** The open thread; the call is offered to the agents that took part in it. */
  threadId?: string;
};

/**
 * The room header's button for calling the room's voice-capable agent. Calls ran in the
 * embedded Element Call widget, which this client does not include; they return on LiveKit, and
 * until then the button is not shown.
 */
export function AgentCallHeaderButton(_props: AgentCallHeaderButtonProps): null {
  return null;
}
