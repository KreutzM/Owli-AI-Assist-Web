import {
  bootstrapResponseSchema,
  deltaEventSchema,
  errorPayloadSchema,
  followupDoneSchema,
  profilesResponseSchema,
  sceneDoneSchema,
  songGenerateResponseSchema,
} from '@/core/api/contracts';
import { parseSseStream } from '@/core/api/sse';
import type { RuntimeConfig } from '@/core/config/runtimeConfig';
import { SessionStore } from '@/core/session/sessionStore';
import type {
  AudioPostcardRequest,
  AudioPostcardResult,
  BootstrapSession,
  FollowupRequest,
  FollowupResult,
  OwliApi,
  PublicProfile,
  SceneRequest,
  SceneResult,
  SupportedImageMimeType,
  UsageSnapshot,
} from '@/core/types';

export class OwliApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'OwliApiError';
  }
}

export class RemoteOwliApi implements OwliApi {
  readonly #sessionStore = new SessionStore();

  constructor(
    private readonly config: RuntimeConfig,
    private readonly installationId: string,
  ) {}

  async listProfiles(signal?: AbortSignal): Promise<PublicProfile[]> {
    const response = await fetch(this.url('/api/v1/profiles'), {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    const payload = profilesResponseSchema.parse(await this.readJson(response));
    return payload.profiles
      .filter((profile) => profile.transports.backend?.available !== false)
      .map((profile) => ({
        id: profile.id,
        label: profile.label,
        description: profile.description,
        availability: profile.availability,
        supportsStreaming: profile.transports.backend?.supportsStreaming ?? false,
        supportsFollowup: profile.transports.backend?.supportsFollowup ?? false,
      }));
  }

  async describeScene(request: SceneRequest): Promise<SceneResult> {
    const session = await this.ensureSession(request.locale, request.signal);
    const image = await encodeImage(request.image);
    const result = await this.streamJsonResult(
      '/api/v1/scene/describe',
      {
        sessionToken: session.sessionToken,
        installationId: this.installationId,
        imageBase64: image.base64,
        imageMimeType: image.mimeType,
        sceneMode: 'describe',
        stream: true,
        ...(request.profileId ? { profileId: request.profileId } : {}),
        locale: request.locale,
      },
      sceneDoneSchema,
      request.onDelta,
      request.signal,
    );
    return {
      answerText: result.answerText,
      mode: result.mode,
      sceneToken: result.sceneToken,
      ...(result.modelAlias ? { modelAlias: result.modelAlias } : {}),
      ...(result.requestId ? { requestId: result.requestId } : {}),
      ...(result.sceneTokenExpiresAt ? { sceneTokenExpiresAt: result.sceneTokenExpiresAt } : {}),
      ...(result.profileId ? { profileId: result.profileId } : {}),
      ...(result.locale ? { locale: result.locale } : {}),
    };
  }

  async askFollowup(request: FollowupRequest): Promise<FollowupResult> {
    const session = await this.ensureSession(request.locale, request.signal);
    const image = request.originalImage ? await encodeImage(request.originalImage) : undefined;
    const result = await this.streamJsonResult(
      '/api/v1/scene/followup',
      {
        sessionToken: session.sessionToken,
        installationId: this.installationId,
        sceneToken: request.sceneToken,
        questionText: request.questionText,
        stream: true,
        ...(image ? { imageBase64: image.base64, imageMimeType: image.mimeType } : {}),
        ...(request.profileId ? { profileId: request.profileId } : {}),
        locale: request.locale,
      },
      followupDoneSchema,
      request.onDelta,
      request.signal,
    );
    return {
      answerText: result.answerText,
      mode: result.mode,
      ...(result.modelAlias ? { modelAlias: result.modelAlias } : {}),
      ...(result.requestId ? { requestId: result.requestId } : {}),
      ...(result.profileId ? { profileId: result.profileId } : {}),
      ...(result.locale ? { locale: result.locale } : {}),
    };
  }

  async generateAudioPostcard(request: AudioPostcardRequest): Promise<AudioPostcardResult> {
    const session = await this.ensureSession(request.locale, request.signal);
    const image = await encodeImage(request.image);
    const response = await fetch(this.url('/api/v1/song/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sessionToken: session.sessionToken,
        installationId: this.installationId,
        imageBase64: image.base64,
        imageMimeType: image.mimeType,
        locale: request.locale,
        durationSec: 30,
        stylePreset: request.profileId ?? 'warm_postcard',
        promptProfile: request.profileId ?? 'warm_postcard',
        voiceMode: request.modeId ?? 'lyria_sung_hook',
        vocals: 'auto',
        shareVideo: request.shareVideo,
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    const payload = songGenerateResponseSchema.parse(await this.readJson(response));
    return {
      status: payload.status,
      ...(payload.songId ? { songId: payload.songId } : {}),
      ...(payload.audio?.url ? { audioUrl: payload.audio.url } : {}),
      ...(payload.video?.url ? { videoUrl: payload.video.url } : {}),
      ...(payload.audio?.durationMs ? { durationMs: payload.audio.durationMs } : {}),
      ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
      ...(payload.pollAfterMs ? { pollAfterMs: payload.pollAfterMs } : {}),
      ...(payload.accessibility?.sceneCaption
        ? { sceneCaption: payload.accessibility.sceneCaption }
        : {}),
      ...(payload.accessibility?.musicalMapping
        ? { musicalMapping: payload.accessibility.musicalMapping }
        : {}),
    };
  }

  getUsage(): Promise<UsageSnapshot | undefined> {
    // Planned cross-platform entitlement endpoint. Until the backend contract exists,
    // remote clients rely on 429 responses and Retry-After.
    return Promise.resolve(undefined);
  }

  private async ensureSession(locale: string, signal?: AbortSignal): Promise<BootstrapSession> {
    const current = this.#sessionStore.getValid();
    if (current) return current;

    const response = await fetch(this.url('/api/v1/session/bootstrap'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        appVersion: this.config.appVersion,
        versionCode: this.config.versionCode,
        platform: 'web',
        installationId: this.installationId,
        locale,
      }),
      ...(signal ? { signal } : {}),
    });
    const session = bootstrapResponseSchema.parse(await this.readJson(response));
    this.#sessionStore.set(session);
    return session;
  }

  private async streamJsonResult<T>(
    path: string,
    body: unknown,
    schema: { parse(value: unknown): T },
    onDelta?: (textDelta: string) => void,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(this.url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      await this.throwResponseError(response);
    }
    const stream = response.body;
    if (!stream) {
      throw new OwliApiError('Streaming response has no body.', 'STREAM_MISSING', 502);
    }

    for await (const event of parseSseStream(stream)) {
      const data: unknown = JSON.parse(event.data);
      if (event.event === 'delta') {
        onDelta?.(deltaEventSchema.parse(data).textDelta);
      } else if (event.event === 'done') {
        return schema.parse(data);
      } else if (event.event === 'error') {
        const error = errorPayloadSchema.parse(data);
        throw new OwliApiError(error.message, error.error, response.status, error.details);
      }
    }
    throw new OwliApiError(
      'Streaming response ended before a done event.',
      'STREAM_INCOMPLETE',
      502,
    );
  }

  private url(path: string): string {
    return new URL(path, this.config.apiBaseUrl).toString();
  }

  private async readJson(response: Response): Promise<unknown> {
    if (!response.ok) await this.throwResponseError(response);
    return response.json();
  }

  private async throwResponseError(response: Response): Promise<never> {
    const raw: unknown = await response.json().catch(() => undefined);
    const parsed = errorPayloadSchema.safeParse(raw);
    if (parsed.success) {
      throw new OwliApiError(
        parsed.data.message,
        parsed.data.error,
        response.status,
        parsed.data.details,
      );
    }
    throw new OwliApiError(
      `Owli API request failed with HTTP ${response.status}.`,
      'HTTP_ERROR',
      response.status,
    );
  }
}

async function encodeImage(blob: Blob): Promise<{
  base64: string;
  mimeType: SupportedImageMimeType;
}> {
  const mimeType = normalizeMimeType(blob.type);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return { base64: btoa(binary), mimeType };
}

function normalizeMimeType(value: string): SupportedImageMimeType {
  if (value === 'image/png' || value === 'image/webp') return value;
  return 'image/jpeg';
}
