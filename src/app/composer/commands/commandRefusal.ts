/** Why a command did not run, for the composer to explain in the person's language. */
export type CommandRefusal = { code: 'usage' } | { code: 'ownServer'; server: string };

/** Thrown by a command that refuses to run; any other error carries the server's reason. */
export class CommandRefusedError extends Error {
  constructor(readonly refusal: CommandRefusal) {
    super(refusal.code);
    this.name = 'CommandRefusedError';
  }
}

export const usage = () => new CommandRefusedError({ code: 'usage' });
