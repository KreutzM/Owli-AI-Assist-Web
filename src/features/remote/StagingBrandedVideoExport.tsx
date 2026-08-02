import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadAudioPostcard } from '@/core/api/downloadAudioPostcard';
import { loadOwliBrandingLogo } from '@/core/api/loadOwliBrandingLogo';
import {
  validateAudioCapability,
  type AudioPostcardOptions,
  type AudioPostcardReadyResult,
} from '@/core/api/remoteAudioPostcardContracts';
import type { NormalizedSceneImage } from '@/platform/image/browserSceneImageNormalizer';
import { renderBrandedVideo } from '@/platform/media/browserBrandedVideoRenderer';
import { canShareFile, shareFile } from '@/platform/share/browserShare';

const CANCELLED_MESSAGE = 'Videoerstellung wurde abgebrochen. Die Audio-Postcard bleibt verfügbar.';
const SHARE_TITLE = 'Owli-AI Audio-Postcard';
const SHARE_TEXT = 'Mit Owli-AI Assist erstellt';

type ExportState =
  | { status: 'idle'; message: string }
  | { status: 'rendering'; message: string }
  | { status: 'cancelled'; message: string }
  | { status: 'ready'; message: string; file: File; url: string }
  | { status: 'error'; message: string };

interface StagingBrandedVideoExportProps {
  enabled: boolean;
  image: NormalizedSceneImage;
  result: AudioPostcardReadyResult;
  options: AudioPostcardOptions;
  apiBaseUrl: string;
}

export function isStagingBrandedVideoExportAvailable(input: {
  buildFlag: string | undefined;
  apiBaseUrl: string | undefined;
  image: NormalizedSceneImage | undefined;
  result: AudioPostcardReadyResult | undefined;
  options: AudioPostcardOptions | undefined;
  now?: number;
}): boolean {
  if (
    input.buildFlag !== 'enabled' ||
    input.apiBaseUrl !== 'https://api-staging.owli-ai.com/' ||
    !input.image ||
    !input.result ||
    !input.options
  ) {
    return false;
  }
  try {
    validateAudioCapability(input.result, input.options, input.apiBaseUrl, input.now ?? Date.now());
    return true;
  } catch {
    return false;
  }
}

export function StagingBrandedVideoExport({
  enabled,
  image,
  result,
  options,
  apiBaseUrl,
}: StagingBrandedVideoExportProps) {
  const [state, setState] = useState<ExportState>({
    status: 'idle',
    message: '',
  });
  const [capabilityUsable, setCapabilityUsable] = useState(
    () => Date.now() < Date.parse(result.expiresAt),
  );
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const outputUrlRef = useRef<string | undefined>(undefined);
  const attemptRef = useRef(0);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);

  const releaseResources = useCallback((publishIdle: boolean) => {
    attemptRef.current += 1;
    controllerRef.current?.abort(new DOMException('Video export invalidated.', 'AbortError'));
    controllerRef.current = undefined;
    if (outputUrlRef.current) {
      URL.revokeObjectURL(outputUrlRef.current);
      outputUrlRef.current = undefined;
    }
    if (publishIdle) setState({ status: 'idle', message: '' });
  }, []);

  useEffect(() => {
    const remainingMs = Math.max(0, Date.parse(result.expiresAt) - Date.now());
    const timer = window.setTimeout(() => {
      releaseResources(true);
      setCapabilityUsable(false);
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [releaseResources, result.expiresAt]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') releaseResources(true);
    };
    const onPageHide = () => releaseResources(true);
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      releaseResources(false);
    };
  }, [releaseResources]);

  useEffect(() => {
    if (state.status === 'rendering') cancelRef.current?.focus();
    if (state.status === 'ready') downloadRef.current?.focus();
    if (state.status === 'error') primaryActionRef.current?.focus();
  }, [state.status]);

  if (!enabled || !capabilityUsable) return null;

  const createVideo = async () => {
    releaseResources(false);
    const attempt = attemptRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({
      status: 'rendering',
      message: 'Gebrandetes Staging-Video wird lokal erstellt …',
    });
    try {
      const [audioBlob, logoBlob] = await Promise.all([
        downloadAudioPostcard({
          result,
          options,
          apiBaseUrl,
          signal: controller.signal,
        }),
        loadOwliBrandingLogo(controller.signal),
      ]);
      const file = await renderBrandedVideo({
        imageBlob: image.blob,
        logoBlob,
        audioBlob,
        expectedDurationMs: result.audio.durationMs,
        signal: controller.signal,
      });
      if (attempt !== attemptRef.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(file);
      outputUrlRef.current = url;
      setState({
        status: 'ready',
        message: 'Gebrandetes Video ist geprüft und bereit.',
        file,
        url,
      });
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      setState({
        status: 'error',
        message:
          error instanceof DOMException && error.name === 'AbortError'
            ? CANCELLED_MESSAGE
            : 'Das Video konnte nicht sicher erstellt oder geprüft werden. Die Audio-Postcard bleibt verfügbar.',
      });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
      }
    }
  };

  const cancelVideo = () => {
    releaseResources(false);
    setState({ status: 'cancelled', message: CANCELLED_MESSAGE });
    window.setTimeout(() => primaryActionRef.current?.focus(), 0);
  };

  const shareVideo = async () => {
    if (state.status !== 'ready') return;
    try {
      await shareFile(state.file, SHARE_TITLE, SHARE_TEXT);
      setState({ ...state, message: 'Teilen-Dialog wurde geöffnet.' });
    } catch (error) {
      setState({
        ...state,
        message:
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Teilen wurde abgebrochen. Video, Wiedergabe und Download bleiben verfügbar.'
            : 'Video konnte nicht geteilt werden. Wiedergabe und Download bleiben verfügbar.',
      });
    } finally {
      shareRef.current?.focus();
    }
  };

  const canShare = state.status === 'ready' && canShareFile(state.file, SHARE_TITLE, SHARE_TEXT);
  const primaryLabel =
    state.status === 'error' || state.status === 'cancelled'
      ? 'Video erneut erstellen'
      : 'Gebrandetes Video erstellen';

  return (
    <section
      className="audio-postcard-video-export"
      aria-labelledby="video-export-title"
      aria-busy={state.status === 'rendering'}
    >
      <p className="eyebrow">Nur Staging · experimenteller Export</p>
      <h4 id="video-export-title">Gebrandetes Audio-Postcard-Video</h4>
      <p>
        Das Video wird ausschließlich lokal aus dem aktuellen Bild, der vorhandenen Audio-Postcard
        und dem kanonischen Owli-Logo erstellt. Es wird nicht hochgeladen oder gespeichert.
      </p>
      <div className="scene-actions audio-postcard-actions">
        <button
          ref={primaryActionRef}
          className="button button--secondary"
          type="button"
          disabled={state.status === 'rendering'}
          onClick={() => void createVideo()}
        >
          {state.status === 'rendering' ? 'Video wird erstellt …' : primaryLabel}
        </button>
        {state.status === 'rendering' && (
          <button
            ref={cancelRef}
            className="button button--secondary"
            type="button"
            onClick={cancelVideo}
          >
            Videoerstellung abbrechen
          </button>
        )}
      </div>
      <p
        className="live-status"
        role={state.status === 'error' ? 'alert' : 'status'}
        aria-live={state.status === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        {state.message}
      </p>
      {state.status === 'ready' && (
        <div className="audio-postcard-result">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            aria-label="Gebrandetes Owli Audio-Postcard-Video abspielen"
            controls
            playsInline
            preload="metadata"
            src={state.url}
          >
            Dein Browser unterstützt die Video-Wiedergabe nicht.
          </video>
          <div className="scene-actions audio-postcard-actions">
            <a
              ref={downloadRef}
              className="button button--secondary"
              href={state.url}
              download={state.file.name}
              onClick={() =>
                setState({
                  ...state,
                  message: 'Video-Download wurde gestartet.',
                })
              }
            >
              Video herunterladen
            </a>
            {canShare && (
              <button
                ref={shareRef}
                className="button button--secondary"
                type="button"
                onClick={() => void shareVideo()}
              >
                Video teilen
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
