import type { AudioPostcardQuota } from '@/core/api/remoteAudioPostcardContracts';

export type AudioPostcardErrorKind =
  | 'aborted'
  | 'timed_out'
  | 'network'
  | 'contract'
  | 'rate_limited'
  | 'failed'
  | 'forbidden'
  | 'rejected'
  | 'unavailable'
  | 'expired';

export class AudioPostcardClientError extends Error {
  constructor(
    readonly kind: AudioPostcardErrorKind,
    readonly details: {
      status?: number;
      category?: string;
      scope?: 'installation' | 'provider';
      retryable?: boolean;
      retryAt?: number;
      quota?: AudioPostcardQuota;
      ambiguousOutcome?: boolean;
    } = {},
  ) {
    super(kind);
    this.name = 'AudioPostcardClientError';
  }
}
