import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FollowupStreamCallbacks,
  RemoteFollowupInput,
  RemoteFollowupResult,
} from '@/core/api/remoteFollowupContracts';
import {
  RemoteClientError,
  type RemoteAssistClient,
  type RemoteReadiness,
} from '@/core/api/remoteAssistClient';
import type {
  NormalizedSceneInput,
  RemoteSceneResult,
  SceneStreamCallbacks,
} from '@/core/api/remoteSceneContracts';
import { RemoteAssist } from '@/features/remote/RemoteAssist';
import type { RemoteCamera } from '@/platform/camera/remoteCamera';
import type { BrowserSceneImageNormalizer } from '@/platform/image/browserSceneImageNormalizer';
import type {
  SpeechLifecycleGateway,
  SpeechState,
} from '@/platform/speech/browserSpeech';

const readiness: RemoteReadiness = {
  sceneDescribeEnabled: true,
  followupEnabled: true,
  catalog: {
    defaultProfileId: 'brief',
    profiles: [
      {
        id: 'brief',
        label: 'Kurz',
        description: 'Kurze Beschreibung',
        supportsStreaming: true,
        supportsFollowup: true,
      },
    ],
  },
};

beforeEach(() => {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RemoteAssist', () => {
  it('gates capture controls until all readiness signals pass', async () => {
    const disabled = { ...readiness, sceneDescribeEnabled: false };
    renderRemote({ initialize: vi.fn(async () => disabled) });
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Rückkamera öffnen' })).toBeDisabled();
    expect(screen.getByLabelText('Oder ein Bild auswählen')).toBeDisabled();
  });

  it('keeps visible deltas quiet and completes only after clean EOF resolution', async () => {
    let resolveStream: ((value: RemoteSceneResult) => void) | undefined;
    const describeScene = vi.fn(
      async (_input: NormalizedSceneInput, callbacks: SceneStreamCallbacks) => {
        callbacks.onMetadata?.({
          mode: 'describe',
          modelAlias: 'scene-describe-v1',
          profileId: 'brief',
          locale: 'de-DE',
        });
        callbacks.onDelta?.('Eine helle Straße.');
        callbacks.onTerminal?.();
        return await new Promise<RemoteSceneResult>((resolve) => {
          resolveStream = resolve;
        });
      },
    );
    renderRemote({ describeScene });

    const fileInput = await screen.findByLabelText('Oder ein Bild auswählen');
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array([1])], 'scene.png', { type: 'image/png' })] },
    });
    await screen.findByRole('button', { name: 'Szene beschreiben' });
    expect(fileInput).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Szene beschreiben' }));
    await screen.findByText('Die Antwort wird sicher abgeschlossen …');
    const visibleResult = screen.getByRole('heading', {
      name: 'Laufende Beschreibung',
    }).parentElement;
    expect(visibleResult).not.toHaveAttribute('aria-live');
    expect(screen.queryByRole('heading', { name: 'Szenenbeschreibung' })).not.toBeInTheDocument();

    resolveStream?.(sceneResult());
    const completedHeading = await screen.findByRole('heading', {
      name: 'Szenenbeschreibung',
    });
    const completedResult = completedHeading.closest('section');
    if (!completedResult) throw new Error('Missing completed scene result');
    expect(within(completedResult).getByText('Eine helle Straße.')).toBeInTheDocument();
    expect(describeScene).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Rückfrage zur aktuellen Szene')).toHaveFocus();
  });

  it('commits a follow-up only after clean EOF and reads only completed answers', async () => {
    let resolveFollowup: ((value: RemoteFollowupResult) => void) | undefined;
    const followupScene = vi.fn(
      async (_input: RemoteFollowupInput, callbacks: FollowupStreamCallbacks) => {
        callbacks.onMetadata?.({
          mode: 'followup',
          modelAlias: 'scene-followup-v1',
          profileId: 'brief',
          locale: 'de-DE',
        });
        callbacks.onDelta?.('Auf dem Schild steht Ausgang.');
        callbacks.onTerminal?.();
        return await new Promise<RemoteFollowupResult>((resolve) => {
          resolveFollowup = resolve;
        });
      },
    );
    const speech = createSpeech();
    renderRemote({ followupScene }, speech);
    await prepareAndDescribe();

    fireEvent.change(screen.getByLabelText('Rückfrage zur aktuellen Szene'), {
      target: { value: 'Was steht auf dem Schild?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rückfrage senden' }));

    await screen.findByText('Die Antwort wird sicher abgeschlossen …');
    const partial = screen.getByRole('heading', { name: 'Laufende Antwort' }).closest('section');
    expect(partial).not.toHaveAttribute('aria-live');
    expect(screen.queryByRole('heading', { name: 'Abgeschlossene Rückfragen' })).not.toBeInTheDocument();

    resolveFollowup?.(followupResult());
    const transcript = await screen.findByRole('heading', { name: 'Abgeschlossene Rückfragen' });
    expect(transcript).toBeInTheDocument();
    expect(screen.getByText('Was steht auf dem Schild?')).toBeInTheDocument();
    expect(screen.getByText('Auf dem Schild steht Ausgang.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Antwort vorlesen' }));
    expect(speech.speak).toHaveBeenCalledWith('Auf dem Schild steht Ausgang.', 'de-DE');
  });

  it('cancels follow-up neutrally and retains the draft without committing partial text', async () => {
    const followupScene = vi.fn(
      async (
        _input: RemoteFollowupInput,
        callbacks: FollowupStreamCallbacks,
        signal?: AbortSignal,
      ) => {
        callbacks.onMetadata?.({
          mode: 'followup',
          modelAlias: 'scene-followup-v1',
          profileId: 'brief',
          locale: 'de-DE',
        });
        callbacks.onDelta?.('Nicht vollständig');
        return await new Promise<RemoteFollowupResult>((_, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      },
    );
    renderRemote({ followupScene });
    await prepareAndDescribe();

    const question = screen.getByLabelText('Rückfrage zur aktuellen Szene');
    fireEvent.change(question, { target: { value: 'Welche Farbe hat die Tür?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rückfrage senden' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rückfrage abbrechen' }));

    await screen.findByText('Die Rückfrage wurde abgebrochen. Dein Entwurf bleibt erhalten.');
    expect(question).toHaveValue('Welche Farbe hat die Tür?');
    expect(screen.queryByText('Nicht vollständig')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Abgeschlossene Rückfragen' })).not.toBeInTheDocument();
    expect(question).toHaveFocus();
  });

  it('cancels scene describe neutrally, aborts the attempt, and keeps explicit retry available', async () => {
    const describeScene = vi.fn(
      async (
        _input: NormalizedSceneInput,
        callbacks: SceneStreamCallbacks,
        signal?: AbortSignal,
      ) => {
        callbacks.onMetadata?.({
          mode: 'describe',
          modelAlias: 'scene-describe-v1',
          profileId: 'brief',
          locale: 'de-DE',
        });
        return await new Promise<RemoteSceneResult>((_, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      },
    );
    renderRemote({ describeScene });
    const fileInput = await screen.findByLabelText('Oder ein Bild auswählen');
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array([1])], 'scene.webp', { type: 'image/webp' })] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Szene beschreiben' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }));

    const retry = await screen.findByRole('button', { name: 'Erneut senden' });
    expect(screen.getByText('Der Vorgang wurde abgebrochen.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(retry).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rückkamera öffnen' })).toHaveFocus();
  });

  it('retains the normalized image and unlocks explicit retry after Retry-After', async () => {
    let firstImage: Blob | undefined;
    const describeScene = vi
      .fn()
      .mockImplementationOnce(async (input: NormalizedSceneInput) => {
        firstImage = input.image;
        throw new RemoteClientError('RATE_LIMITED', Date.now() + 50, 429);
      })
      .mockImplementationOnce(async (input: NormalizedSceneInput) => {
        expect(input.image).toBe(firstImage);
        return sceneResult();
      });
    renderRemote({ describeScene });

    fireEvent.change(await screen.findByLabelText('Oder ein Bild auswählen'), {
      target: { files: [new File([new Uint8Array([1])], 'scene.png', { type: 'image/png' })] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Szene beschreiben' }));

    const retry = await screen.findByRole('button', {
      name: 'Erneut versuchen, sobald freigegeben',
    });
    expect(retry).toBeDisabled();
    expect(screen.getByText(/Erneut möglich/)).toBeInTheDocument();
    await waitFor(() => expect(retry).toBeEnabled(), { timeout: 1_000 });
    fireEvent.click(retry);

    await screen.findByRole('heading', { name: 'Szenenbeschreibung' });
    expect(describeScene).toHaveBeenCalledTimes(2);
  });
});

function renderRemote(
  overrides: Partial<RemoteAssistClient> = {},
  speech = createSpeech(),
) {
  const client = {
    initialize: vi.fn(async () => readiness),
    refreshCatalog: vi.fn(async () => readiness),
    describeScene: vi.fn(async () => sceneResult()),
    followupScene: vi.fn(async () => followupResult()),
    ...overrides,
  } as unknown as RemoteAssistClient;
  const camera = {
    active: false,
    start: vi.fn(async () => undefined),
    capture: vi.fn(async () => new Blob([], { type: 'image/jpeg' })),
    stop: vi.fn(),
  } as unknown as RemoteCamera;
  const normalizedBlob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
  const normalizer = {
    normalize: vi.fn(async () => ({
      blob: normalizedBlob,
      width: 640,
      height: 480,
      byteLength: 1,
      previewUrl: 'blob:normalized-scene',
    })),
  } as unknown as BrowserSceneImageNormalizer;
  return render(
    <RemoteAssist
      client={client}
      camera={camera}
      normalizer={normalizer}
      speech={speech}
      locale="de-DE"
    />,
  );
}

async function prepareAndDescribe(): Promise<void> {
  fireEvent.change(await screen.findByLabelText('Oder ein Bild auswählen'), {
    target: { files: [new File([new Uint8Array([1])], 'scene.png', { type: 'image/png' })] },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Szene beschreiben' }));
  await screen.findByRole('heading', { name: 'Szenenbeschreibung' });
}

function createSpeech(): SpeechLifecycleGateway & {
  speak: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  let state: SpeechState = 'idle';
  const listeners = new Set<(value: SpeechState) => void>();
  return {
    supported: true,
    get state() {
      return state;
    },
    speak: vi.fn(() => {
      state = 'speaking';
      for (const listener of listeners) listener(state);
    }),
    stop: vi.fn(() => {
      state = 'idle';
      for (const listener of listeners) listener(state);
    }),
    subscribe: vi.fn((listener: (value: SpeechState) => void) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    }),
    dispose: vi.fn(),
  };
}

function sceneResult(): RemoteSceneResult {
  return {
    answerText: 'Eine helle Straße.',
    sceneToken: 'scene-token',
    sceneTokenExpiresAt: '2099-07-17T12:00:00.000Z',
    profileId: 'brief',
    locale: 'de-DE',
    modelAlias: 'scene-describe-v1',
    requestId: 'request-1',
  };
}

function followupResult(): RemoteFollowupResult {
  return {
    answerText: 'Auf dem Schild steht Ausgang.',
    profileId: 'brief',
    locale: 'de-DE',
    modelAlias: 'scene-followup-v1',
    requestId: 'followup-request-1',
  };
}
