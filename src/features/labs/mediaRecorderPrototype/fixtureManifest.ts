import manifest from '@/features/labs/mediaRecorderPrototype/generated/mediaRecorderFixtureManifest.json';
import type {
  PrototypeAudioFixture,
  PrototypeFixtureManifest,
  PrototypeImageFixture,
  PrototypeScenario,
} from '@/features/labs/mediaRecorderPrototype/types';

export const mediaRecorderFixtureManifest = manifest as PrototypeFixtureManifest;

export const mediaRecorderImageFixtures = new Map(
  mediaRecorderFixtureManifest.images.map((image) => [image.id, image] as const),
);

export const mediaRecorderAudioFixtures = new Map(
  mediaRecorderFixtureManifest.audio.map((audio) => [audio.id, audio] as const),
);

export function getMediaRecorderScenarioFixtures(scenario: PrototypeScenario): {
  image: PrototypeImageFixture;
  audio: PrototypeAudioFixture;
} {
  const image = mediaRecorderImageFixtures.get(scenario.imageId);
  const audio = mediaRecorderAudioFixtures.get(scenario.audioId);
  if (!image || !audio) {
    throw new Error(`Fixture manifest is inconsistent for scenario ${scenario.id}.`);
  }
  return { image, audio };
}
