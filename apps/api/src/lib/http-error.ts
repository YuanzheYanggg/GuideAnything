export interface HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
}

export function httpError(statusCode: number, code: string, message: string, details?: unknown): HttpError {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    ...(details === undefined ? {} : { details }),
  });
}

