/** Why an AI could not answer. The assistant then answers what it can by itself. */
export type AiFailure =
  | 'off'
  | 'no-key'
  | 'offline'
  | 'timeout'
  | 'bad-key'
  | 'rate-limit'
  | 'no-model'
  | 'bad-answer'
  | 'not-allowed';

export class AiError extends Error {
  constructor(
    message: string,
    readonly reason: AiFailure,
  ) {
    super(message);
  }
}
