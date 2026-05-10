/**
 * src/http/errors.ts — API 用 HTTP エラー
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError;
}
