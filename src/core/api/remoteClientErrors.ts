import { SceneStreamError } from '@/core/api/sceneSse';
import { RemoteHttpError } from '@/core/session/remoteSessionManager';

export type RemoteClientErrorCode =
  | 'NETWORK_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'SCENE_CONTEXT_INVALID'
  | 'SCENE_CONTEXT_EXPIRED'
  | 'REQUEST_REJECTED'
  | 'REMOTE_CONTRACT_INVALID'
  | 'PROFILE_CACHE_INVALID'
  | 'REQUEST_ABORTED';

export class RemoteClientError extends Error {
  constructor(
    readonly code: RemoteClientErrorCode,
    readonly retryAt?: number,
    readonly status?: number,
  ) {
    super(code);
    this.name = 'RemoteClientError';
  }
}

export function statusError(status: number): RemoteClientError {
  if (status >= 500) return new RemoteClientError('SERVICE_UNAVAILABLE', undefined, status);
  return new RemoteClientError('REQUEST_REJECTED', undefined, status);
}

export function rateLimitError(response: Response): RemoteClientError {
  return new RemoteClientError(
    'RATE_LIMITED',
    parseRetryAfter(response.headers.get('Retry-After')),
    429,
  );
}

export function mapClientError(error: unknown, signal?: AbortSignal): Error {
  if (error instanceof RemoteHttpError) {
    return error.status === 403
      ? new RemoteClientError('FORBIDDEN', undefined, 403)
      : new RemoteClientError('UNAUTHORIZED', undefined, 401);
  }
  if (error instanceof RemoteClientError || error instanceof SceneStreamError) return error;
  if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
    return new RemoteClientError('REQUEST_ABORTED');
  }
  return new RemoteClientError('NETWORK_UNAVAILABLE');
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) && date >= Date.now() ? date : undefined;
}
