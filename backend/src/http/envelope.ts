export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'ML_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  ML_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown[];
  constructor(code: ErrorCode, message: string, details: unknown[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
  static validation(message: string, details: unknown[] = []): ApiError {
    return new ApiError('VALIDATION_ERROR', message, details);
  }
  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError('UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have access to this resource'): ApiError {
    return new ApiError('FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError('NOT_FOUND', message);
  }
  static mlUnavailable(message = 'The analytics service is currently unavailable'): ApiError {
    return new ApiError('ML_UNAVAILABLE', message);
  }
}

export interface Meta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  [k: string]: unknown;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: Meta;
}

export interface FailureEnvelope {
  success: false;
  error: { code: ErrorCode; message: string; details: unknown[] };
}

export function ok<T>(data: T, meta?: Meta): SuccessEnvelope<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function fail(code: ErrorCode, message: string, details: unknown[] = []): FailureEnvelope {
  return { success: false, error: { code, message, details } };
}
