import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadAudioPostcard } from '@/core/api/downloadAudioPostcard';
import { loadOwliBrandingLogo } from '@/core/api/loadOwliBrandingLogo';
import type {
  AudioPostcardOptions,
  AudioPostcardReadyResult,
} from '@/core/api/remoteAudioPostcardContracts';
import { StagingBrandedVideoDiagnostic } from '@/features/remote/StagingBrandedVideoDiagnostic';
import { canStartStagingBrandedVideoExport } from '@/features/remote/stagingBrandedVideoAvailability';
import type { NormalizedSceneImage } from '@/platform/image/browserSceneImageNormalizer';
import { renderBrandedVideo } from '@/platform/media/browserBrandedVideoRenderer';
import { canShareFile, shareFile } from '@/platform/share/browserShare';
import {
  asUnknownBrandedVideoExportError,
  isExpectedBrandedVideoAbort,
  type BrandedVideoExportErrorCode,
  withBrandedVideoExportError,
} from '@/shared/media/brandedVideoExportError';

const CANCELLED_MESSAGE = 'Videoerstellung wurde abgebrochen. Die Audio-Postcard bleibt verfügbar.';
const EXPIRED_MESSAGE =
  'Die Audio-Postcard ist abgelaufen. Für ein neues Video muss zuerst eine neue Audio-Postcard erstellt werden.';
const EXPORT_ERROR_MESSAGE =
  'Das Video konnte nicht sicher erstellt oder geprüft werden. Die Audio-Postcard bleibt verfügbar.';
const SHARE_PENDING_MESSAGE = 'Teilen wird geöffnet …';
const SHARE_SUCCESS_MESSAGE = 'Video wurde zum Teilen übergeben.';
const SHARE_CANCELLED_MESSAGE =
  'Teilen wurde abgebrochen. Video, Wiedergabe und Download bleiben verfügbar.';
const SHARE_ERROR_MESSAGE =
  'Video konnte nicht geteilt werden. Wiedergabe und Download bleiben verfügbar.';
const SHARE_TITLE = 'Owli-AI Audio-Postcard';
const SHARE_TEXT = 'Mit Owli-AI Assist erstellt';

type ExportState =
  | { status: 'idle'; message: string }
  | { status: 'downloading'; message: string }
  | { status: 'local_rendering'; message: string }
  | { status: 'cancelled'; message: string }
  | { status: 'ready'; message: string; file: File; url: string }
  | { status: 'error'; message: string; code: BrandedVideoExportErrorCode }
  | { status: 'expired'; message: string };

interface StagingBrandedVideoExportProps {
  enabled: boolean;
  image: NormalizedSceneImage;
  result: AudioPostcardReadyResult;
  options: AudioPostcardOptions;
  apiBaseUrl: string;
}

export function StagingBrandedVideoExport({
  enabled,
  image,
  result,
  options,
  apiBaseUrl,
}: StagingBrandedVideoExportProps) {
  const initialCapabilityUsable = canStartStagingBrandedVideoExport({
    result,
    options,
    apiBaseUrl,
  });
  const [state, setState] = useState<ExportState>(
    initialCapabilityUsable
      ? { status: 'idle', message: '' }
      : { status: 'expired', message: EXPIRED_MESSAGE },
  );
  const [capabilityUsable, setCapabilityUsable] = useState(initialCapabilityUsable);
  const [sharePending, setSharePending] = useState(false);
  const localWorkControllerRef = useRef<AbortController | undefined>(undefined);
  const downloadControllerRef = useRef<AbortController | undefined>(undefined);
  const capabilityUsableRef = useRef(initialCapabilityUsable);
  const outputUrlRef = useRef<string | undefined>(undefined);
  const attemptRef = useRef(0);
  const shareAttemptRef = useRef(0);
  const shareInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const activeAttemptRef = useRef(false);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);

  const abortActiveAttempt = useCallback((publishCancellation: boolean) => {
    attemptRef.current += 1;
    activeAttemptRef.current = false;
    const reason = new DOMException('Video export invalidated.', 'AbortError');
    downloadControllerRef.current?.abort(reason);
    downloadControllerRef.current = undefined;
    localWorkControllerRef.current?.abort(reason);
    localWorkControllerRef.current = undefined;
    if (publishCancellation && mountedRef.current) {
      setState((current) =>
        isExportActive(current.status)
          ? { status: 'cancelled', message: CANCELLED_MESSAGE }
          : current,
      );
    }
  }, []);

  const releaseReadyOutput = useCallback(() => {
    const url = outputUrlRef.current;
    if (!url) return;
    outputUrlRef.current = undefined;
    URL.revokeObjectURL(url);
  }, []);

  const releaseAllResources = useCallback(() => {
    abortActiveAttempt(false);
    shareAttemptRef.current += 1;
    shareInFlightRef.current = false;
    releaseReadyOutput();
  }, [abortActiveAttempt, releaseReadyOutput]);

  const expireCapability = useCallback(() => {
    capabilityUsableRef.current = false;
    setCapabilityUsable(false);
    downloadControllerRef.current?.abort(
      new DOMException('Audio capability expired during download.', 'TimeoutError'),
    );
    setState((current) => {
      if (
        current.status === 'local_rendering' ||
        current.status === 'ready' ||
        current.status === 'cancelled'
      ) {
        return current;
      }
      return { status: 'expired', message: EXPIRED_MESSAGE };
    });
  }, []);

  useEffect(() => {
    if (!capabilityUsableRef.current) return;
    const remainingMs = Date.parse(result.expiresAt) - Date.now();
    const timeoutMs = Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : 0;
    const timer = window.setTimeout(expireCapability, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [expireCapability, result.expiresAt]);

  useEffect(() => {
    mountedRef.current = true;
    const abortActiveLifecycleAttempt = () => {
      if (activeAttemptRef.current) abortActiveAttempt(true);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') abortActiveLifecycleAttempt();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', abortActiveLifecycleAttempt);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', abortActiveLifecycleAttempt);
      releaseAllResources();
    };
  }, [abortActiveAttempt, releaseAllResources]);

  useEffect(() => {
    if (isExportActive(state.status)) cancelRef.current?.focus();
    if (state.status === 'ready') downloadRef.current?.focus();
    if (state.status === 'error' && capabilityUsable) primaryActionRef.current?.focus();
  }, [capabilityUsable, state.status]);

  if (!enabled) return null;

  const createVideo = async () => {
    if (
      isExportActive(state.status) ||
      localWorkControllerRef.current ||
      downloadControllerRef.current
    ) {
      return;
    }
    if (!canStartStagingBrandedVideoExport({ result, options, apiBaseUrl })) {
      expireCapability();
      return;
    }
    abortActiveAttempt(false);
    releaseReadyOutput();
    const attempt = attemptRef.current;
    const localWorkController = new AbortController();
    const downloadController = new AbortController();
    const attemptProgress: { audioDownloaded: boolean } = { audioDownloaded: false };
    localWorkControllerRef.current = localWorkController;
    downloadControllerRef.current = downloadController;
    activeAttemptRef.current = true;
    setState({ status: 'downloading', message: 'Audio-Postcard wird sicher geladen …' });
    try {
      const audioPromise = withBrandedVideoExportError(
        'VIDEO_CAPABILITY_DOWNLOAD_FAILED',
        'capability_download',
        () =>
          downloadAudioPostcard({
            result,
            options,
            apiBaseUrl,
            signal: downloadController.signal,
          }),
      ).then((audioBlob) => {
        attemptProgress.audioDownloaded = true;
        if (downloadControllerRef.current === downloadController) {
          downloadControllerRef.current = undefined;
        }
        if (attempt === attemptRef.current && !localWorkController.signal.aborted) {
          setState({
            status: 'local_rendering',
            message: 'Audio ist lokal geprüft. Gebrandetes Staging-Video wird erstellt …',
          });
        }
        return audioBlob;
      });
      const logoPromise = withBrandedVideoExportError(
        'VIDEO_BRANDING_ASSET_LOAD_FAILED',
        'branding_asset_load',
        () => loadOwliBrandingLogo(localWorkController.signal),
      );
      const [audioBlob, logoBlob] = await Promise.all([audioPromise, logoPromise]);
      if (attempt !== attemptRef.current || localWorkController.signal.aborted) return;
      setState({
        status: 'local_rendering',
        message: 'Gebrandetes Staging-Video wird lokal erstellt und geprüft …',
      });
      const file = await withBrandedVideoExportError(
        'VIDEO_UNKNOWN_EXPORT_FAILURE',
        'unknown',
        () =>
          renderBrandedVideo({
            imageBlob: image.blob,
            logoBlob,
            audioBlob,
            signal: localWorkController.signal,
          }),
      );
      if (attempt !== attemptRef.current) return;
      const url = URL.createObjectURL(file);
      if (outputUrlRef.current && outputUrlRef.current !== url) {
        URL.revokeObjectURL(outputUrlRef.current);
      }
      outputUrlRef.current = url;
      setState({
        status: 'ready',
        message: 'Gebrandetes Video ist geprüft und bereit.',
        file,
        url,
      });
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      if (downloadControllerRef.current === downloadController) {
        downloadController.abort(new DOMException('Video export failed.', 'AbortError'));
        downloadControllerRef.current = undefined;
      }
      localWorkController.abort(new DOMException('Video export failed.', 'AbortError'));
      if (
        !attemptProgress.audioDownloaded &&
        (!capabilityUsableRef.current || Date.now() >= Date.parse(result.expiresAt))
      ) {
        expireCapability();
        return;
      }
      if (isExpectedBrandedVideoAbort(error)) {
        setState({ status: 'cancelled', message: CANCELLED_MESSAGE });
        return;
      }
      const diagnostic = asUnknownBrandedVideoExportError(error);
      setState({ status: 'error', message: EXPORT_ERROR_MESSAGE, code: diagnostic.code });
    } finally {
      if (downloadControllerRef.current === downloadController) {
        downloadControllerRef.current = undefined;
      }
      if (localWorkControllerRef.current === localWorkController) {
        localWorkControllerRef.current = undefined;
      }
      if (attempt === attemptRef.current) activeAttemptRef.current = false;
    }
  };

  const cancelVideo = () => {
    abortActiveAttempt(false);
    setState({ status: 'cancelled', message: CANCELLED_MESSAGE });
    window.setTimeout(() => primaryActionRef.current?.focus(), 0);
  };

  const publishShareResult = (file: File, url: string, message: string) => {
    if (!mountedRef.current || outputUrlRef.current !== url) return;
    setState((current) =>
      current.status === 'ready' && current.file === file && current.url === url
        ? { ...current, message }
        : current,
    );
  };

  const shareVideo = async () => {
    if (state.status !== 'ready' || shareInFlightRef.current) return;
    const sharedFile = state.file;
    const sharedUrl = state.url;
    const shareAttempt = shareAttemptRef.current + 1;
    shareAttemptRef.current = shareAttempt;
    shareInFlightRef.current = true;
    setSharePending(true);
    setState((current) =>
      current.status === 'ready' && current.file === sharedFile && current.url === sharedUrl
        ? { ...current, message: SHARE_PENDING_MESSAGE }
        : current,
    );
    try {
      await shareFile(sharedFile, SHARE_TITLE, SHARE_TEXT);
      publishShareResult(sharedFile, sharedUrl, SHARE_SUCCESS_MESSAGE);
    } catch (error) {
      publishShareResult(
        sharedFile,
        sharedUrl,
        error instanceof DOMException && error.name === 'AbortError'
          ? SHARE_CANCELLED_MESSAGE
          : SHARE_ERROR_MESSAGE,
      );
    } finally {
      if (shareAttempt === shareAttemptRef.current) {
        shareInFlightRef.current = false;
        if (mountedRef.current) {
          setSharePending(false);
          if (outputUrlRef.current === sharedUrl) {
            window.setTimeout(() => {
              if (
                mountedRef.current &&
                !shareInFlightRef.current &&
                outputUrlRef.current === sharedUrl
              ) {
                shareRef.current?.focus();
              }
            }, 0);
          }
        }
      }
    }
  };

  const active = isExportActive(state.status);
  const canShare = state.status === 'ready' && canShareFile(state.file, SHARE_TITLE, SHARE_TEXT);
  const primaryLabel =
    state.status === 'error' || state.status === 'cancelled'
      ? 'Video erneut erstellen'
      : 'Gebrandetes Video erstellen';

  return (
    <section
      className="audio-postcard-video-export"
      aria-labelledby="video-export-title"
      aria-busy={active}
    >
      <p className="eyebrow">Nur Staging · experimenteller Export</p>
      <h4 id="video-export-title">Gebrandetes Audio-Postcard-Video</h4>
      <p>
        Das Video wird ausschließlich lokal aus dem aktuellen Bild, der vorhandenen Audio-Postcard
        und dem kanonischen Owli-Logo erstellt. Es wird nicht hochgeladen oder gespeichert.
      </p>
      <div className="scene-actions audio-postcard-actions">
        {capabilityUsable && (
          <button
            ref={primaryActionRef}
            className="button button--secondary"
            type="button"
            disabled={active}
            onClick={() => void createVideo()}
          >
            {active ? 'Video wird erstellt …' : primaryLabel}
          </button>
        )}
        {active && (
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
      {state.status === 'error' && <StagingBrandedVideoDiagnostic code={state.code} />}
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
                setState((current) =>
                  current.status === 'ready'
                    ? { ...current, message: 'Video-Download wurde gestartet.' }
                    : current,
                )
              }
            >
              Video herunterladen
            </a>
            {canShare && (
              <button
                ref={shareRef}
                className="button button--secondary"
                type="button"
                disabled={sharePending}
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

function isExportActive(status: ExportState['status']): boolean {
  return status === 'downloading' || status === 'local_rendering';
}
