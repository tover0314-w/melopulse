export class MeloPulseError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MeloPulseError';
  }
}
