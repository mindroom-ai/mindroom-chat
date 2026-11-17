/**
 * The content key that tells MindRoom what to do with a message that arrives while an agent
 * replies in its thread (the backend's `mindroom/mid_turn.py`), one of `MID_TURN_MODES`:
 * `steer` ends the running reply after its current tool batch, and the agent carries on in a new
 * reply below the message; `queue` waits for the reply to finish; `auto`, like a missing or
 * unknown value, lets the agent's judge decide. The composer puts it on every text message.
 */
export const MID_TURN_MODE_KEY = 'io.mindroom.mid_turn';
