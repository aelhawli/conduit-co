export class AppError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const unavailable = () => new AppError(503, 'SERVICE_UNAVAILABLE', 'The audit service is temporarily unavailable. Please try again shortly.');
