import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadAudioPostcard } from '@/core/api/downloadAudioPostcard';
import type { AudioPostcardReadyResult } from '@/core/api/remoteAudioPostcardContracts';
import type { NormalizedSceneImage } from '@/platform/image/browserSceneImageNormalizer';
import { renderBrandedVideo } from '@/platform/media/browserBrandedVideoRenderer';
import { canShareFile, shareFile } from '@/platform/share/browserShare';

type ExportState =
  | { status: 'idle'; message: string }
  | { status: 'rendering'; message: string }
  | { status: 'ready'; message: string; file: File; url: string }
  | { status: 'error'; message: string };

export function StagingBrandedVideoExport({
  enabled,
  image,
  result,
}: {
  enabled: boolean;
  image: NormalizedSceneImage;
  result: AudioPostcardReadyResult;
}) {
  const [state, setState] = useState<ExportState>({ status: 'idle', message: '' });
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const attemptRef = useRef(0);
  const actionRef = useRef<HTMLButtonElement>(null);

  const release = useCallback(() => {
    attemptRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = undefined;
    setState((current) => {
      if (current.status === 'ready') URL.revokeObjectURL(current.url);
      return { status: 'idle', message: '' };
    });
  }, []);

  useEffect(() => release, [release]);

  if (!enabled) return null;

  const createVideo = async () => {
    release();
    const attempt = attemptRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'rendering', message: 'Gebrandetes Staging-Video wird erstellt …' });
    try {
      const audioBlob = await downloadAudioPostcard(result, controller.signal);
      const file = await renderBrandedVideo({
        imageBlob: image.blob,
        audioBlob,
        expectedDurationMs: result.audio.durationMs,
        signal: controller.signal,
      });
      if (attempt !== attemptRef.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(file);
      setState({ status: 'ready', message: 'Gebrandetes Video ist bereit.', file, url });
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      setState({
        status: 'error',
        message:
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Videoerstellung wurde abgebrochen. Die Audio-Postcard bleibt verfügbar.'
            : 'Das Video konnte nicht erstellt werden. Die Audio-Postcard bleibt verfügbar.',
      });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = undefined;
      actionRef.current?.focus();
    }
  };

  const shareVideo = async () => {
    if (state.status !== 'ready') return;
    try {
      await shareFile(state.file, 'Owli-AI Audio-Postcard', 'Mit Owli-AI Assist erstellt');
      setState({ ...state, message: 'Teilen-Dialog wurde geöffnet.' });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setState({ ...state, message: 'Video konnte nicht geteilt werden.' });
      }
    } finally {
      actionRef.current?.focus();
    }
  };

  const canShare = state.status === 'ready' && canShareFile(state.file);

  return (
    <section className="audio-postcard-video-export" aria-labelledby="video-export-title">
      <p className="eyebrow">Nur Staging · experimenteller Export</p>
      <h4 id="video-export-title">Gebrandetes Audio-Postcard-Video</h4>
      <p>Das Video wird ausschließlich lokal im Browser aus dem aktuellen Bild und Audio erstellt.</p>
      <div className="scene-actions audio-postcard-actions">
        <button
          ref={actionRef}
          className="button button--secondary"
          type="button"
          disabled={state.status === 'rendering'}
          onClick={() => void createVideo()}
        >
          {state.status === 'rendering' ? 'Video wird erstellt …' : 'Gebrandetes Video erstellen'}
        </button>
        {state.status === 'rendering' && (
          <button className="button button--secondary" type="button" onClick={release}>
            Videoerstellung abbrechen
          </button>
        )}
      </div>
      <p className="live-status" role={state.status === 'error' ? 'alert' : 'status'}>
        {state.message}
      </p>
      {state.status === 'ready' && (
        <div className="audio-postcard-result">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video controls playsInline preload="metadata" src={state.url}>
            Dein Browser unterstützt die Video-Wiedergabe nicht.
          </video>
          <div className="scene-actions audio-postcard-actions">
            <a className="button button--secondary" href={state.url} download={state.file.name}>
              Video herunterladen
            </a>
            {canShare && (
              <button
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
