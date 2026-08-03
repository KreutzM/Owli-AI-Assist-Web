import {
  validateAudioCapability,
  type AudioPostcardOptions,
  type AudioPostcardReadyResult,
} from '@/core/api/remoteAudioPostcardContracts';
import type { NormalizedSceneImage } from '@/platform/image/browserSceneImageNormalizer';

export function isStagingBrandedVideoExportAvailable(input: {
  buildFlag: string | undefined;
  apiBaseUrl: string | undefined;
  image: NormalizedSceneImage | undefined;
  result: AudioPostcardReadyResult | undefined;
  options: AudioPostcardOptions | undefined;
}): boolean {
  return (
    input.buildFlag === 'enabled' &&
    input.apiBaseUrl === 'https://api-staging.owli-ai.com/' &&
    input.image !== undefined &&
    input.result !== undefined &&
    input.options !== undefined
  );
}

export function canStartStagingBrandedVideoExport(input: {
  result: AudioPostcardReadyResult;
  options: AudioPostcardOptions;
  apiBaseUrl: string;
  now?: number;
}): boolean {
  try {
    validateAudioCapability(input.result, input.options, input.apiBaseUrl, input.now ?? Date.now());
    return true;
  } catch {
    return false;
  }
}
