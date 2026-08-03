import { MEDIA_RECORDER_LIMITS } from '@/platform/media/mediaRecorderLimits';

export const PROTOTYPE_ROUTE_PATH = '/lab/mediarecorder-prototype' as const;

export const PROTOTYPE_LIMITS = MEDIA_RECORDER_LIMITS;

export const RECORDER_CANDIDATE_ORDER = [
  'mp4-h264-aac',
  'webm-vp8-opus',
  'webm-default',
  'webm-vp9-opus',
] as const;

export const PROTOTYPE_FFT_SIZE = 4096;
export const PROTOTYPE_AUDIO_SAMPLE_INTERVAL_MS = 100;

export const PROTOTYPE_AUDIO_MARKERS = {
  floorDb: -160,
  start: {
    left: { targetHz: 1760, backgroundHz: [440, 660] },
    right: { targetHz: 1320, backgroundHz: [330, 550] },
  },
  end: {
    left: { targetHz: 880, backgroundHz: [440, 660] },
    right: { targetHz: 660, backgroundHz: [330, 550] },
  },
  minOverallRms: 0.01,
  minMarkerRms: 0.035,
  minMarkerLeadDb: 8,
} as const;
