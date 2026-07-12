import type {
  AudioPostcardRequest,
  AudioPostcardResult,
  FollowupRequest,
  FollowupResult,
  OwliApi,
  PublicProfile,
  SceneRequest,
  SceneResult,
  UsageSnapshot,
} from '@/core/types';

const DEFAULT_PROFILE_ID = 'gpt52-scene-brief';

const PROFILES: PublicProfile[] = [
  {
    id: 'gpt52-scene-brief',
    label: 'Szene kurz',
    description: 'Kurze, vorlesefreundliche Beschreibung mit Orientierung.',
    availability: 'both',
    supportsStreaming: true,
    supportsFollowup: true,
  },
  {
    id: 'gpt52-ocr-reader',
    label: 'Text lesen',
    description: 'Konzentriert sich auf sichtbare Texte und Schilder.',
    availability: 'both',
    supportsStreaming: true,
    supportsFollowup: true,
  },
];

export class MockOwliApi implements OwliApi {
  async listProfiles(): Promise<PublicProfile[]> {
    await delay(80);
    return PROFILES;
  }

  async describeScene(request: SceneRequest): Promise<SceneResult> {
    const chunks = [
      'Vor dir steht ein heller Tisch. ',
      'Darauf liegen eine Tasse und ein Smartphone. ',
      'Rechts neben dem Tisch befindet sich ein Stuhl.',
    ];
    for (const chunk of chunks) {
      await delay(120, request.signal);
      request.onDelta?.(chunk);
    }
    return {
      answerText: chunks.join(''),
      mode: 'describe',
      requestId: 'mock-scene-request',
      sceneToken: 'mock-scene-token',
      sceneTokenExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      profileId: request.profileId ?? DEFAULT_PROFILE_ID,
      locale: request.locale,
    };
  }

  async askFollowup(request: FollowupRequest): Promise<FollowupResult> {
    await delay(180, request.signal);
    const answer = `Mock-Antwort auf „${request.questionText}“: Die Tasse steht links vom Smartphone.`;
    request.onDelta?.(answer);
    return {
      answerText: answer,
      mode: 'followup',
      requestId: 'mock-followup-request',
      profileId: request.profileId ?? DEFAULT_PROFILE_ID,
      locale: request.locale,
    };
  }

  async generateAudioPostcard(request: AudioPostcardRequest): Promise<AudioPostcardResult> {
    await delay(600, request.signal);
    return {
      status: 'ready',
      songId: 'mock-postcard',
      audioUrl: '/demo/postcard-demo.wav',
      durationMs: 1800,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      sceneCaption: 'Eine freundliche musikalische Postkarte aus der aktuellen Szene.',
      musicalMapping: 'Warme Töne greifen die ruhige Tischszene auf.',
    };
  }

  getUsage(): Promise<UsageSnapshot> {
    return Promise.resolve({
      audioPostcards: {
        daily: {
          limit: 3,
          remaining: 2,
          resetAt: tomorrowUtc(),
        },
      },
    });
  }
}

function tomorrowUtc(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
