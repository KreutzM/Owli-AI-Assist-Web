import { PROTOTYPE_LIMITS } from '@/features/labs/mediaRecorderPrototype/constants';
import { assertAdmission } from '@/features/labs/mediaRecorderPrototype/attemptSupport';
import type {
  PrototypeAudioFixture,
  PrototypeImageFixture,
} from '@/features/labs/mediaRecorderPrototype/types';

export function validatePrototypeAdmission(
  image: PrototypeImageFixture,
  audio: PrototypeAudioFixture,
): void {
  assertAdmission(
    image.longEdgePx <= PROTOTYPE_LIMITS.maxSourceLongEdgePx,
    `${image.id} exceeds the 1280px long-edge limit.`,
  );
  assertAdmission(
    audio.durationMs <= PROTOTYPE_LIMITS.maxDurationMs,
    `${audio.id} exceeds the 30-second duration limit.`,
  );
  assertAdmission(
    audio.sizeBytes <= PROTOTYPE_LIMITS.maxCompressedAudioBytes,
    `${audio.id} exceeds the 16 MiB compressed audio limit.`,
  );
  assertAdmission(
    image.sizeBytes <= PROTOTYPE_LIMITS.hardCompressedInputBytes,
    `${image.id} exceeds the hard compressed input limit.`,
  );
  assertAdmission(
    audio.sizeBytes <= PROTOTYPE_LIMITS.hardCompressedInputBytes,
    `${audio.id} exceeds the hard compressed input limit.`,
  );
  assertAdmission(
    audio.channels <= PROTOTYPE_LIMITS.maxChannels,
    `${audio.id} exceeds the channel limit.`,
  );
  assertAdmission(
    audio.sampleRateHz <= PROTOTYPE_LIMITS.maxSampleRateHz,
    `${audio.id} exceeds the sample-rate limit.`,
  );
}
