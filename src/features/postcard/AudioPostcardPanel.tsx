import { useEffect, useRef, useState } from 'react';
import type { AudioPostcardResult, OwliApi, UsageSnapshot } from '@/core/types';
import type { ShareGateway } from '@/platform/share/browserShare';
import { LiveStatus } from '@/shared/components/LiveStatus';
import { PrimaryButton } from '@/shared/components/PrimaryButton';

interface AudioPostcardPanelProps {
  api: OwliApi;
  share: ShareGateway;
  image: Blob;
  locale: string;
}

export function AudioPostcardPanel({ api, share, image, locale }: AudioPostcardPanelProps) {
  const [status, setStatus] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [result, setResult] = useState<AudioPostcardResult>();
  const [usage, setUsage] = useState<UsageSnapshot>();
  const [message, setMessage] = useState('');
  const activeRequest = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void api
      .getUsage(controller.signal)
      .then(setUsage)
      .catch(() => undefined);
    return () => controller.abort();
  }, [api]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const generate = async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStatus('generating');
    setMessage('Audio-Postcard wird erstellt. Das kann einen Moment dauern.');
    try {
      const next = await api.generateAudioPostcard({
        image,
        locale,
        shareVideo: true,
        signal: controller.signal,
      });
      if (activeRequest.current !== controller) return;
      setResult(next);
      if (next.status === 'pending') {
        setMessage('Die Audio-Postcard wird im Backend weiter verarbeitet.');
        setStatus('idle');
      } else {
        setMessage('Audio-Postcard ist fertig.');
        setStatus('ready');
      }
    } catch (error) {
      if (!isAbortError(error) && activeRequest.current === controller) {
        setMessage(
          error instanceof Error ? error.message : 'Audio-Postcard konnte nicht erstellt werden.',
        );
        setStatus('error');
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = undefined;
    }
  };

  const shareResult = async () => {
    const url = result?.videoUrl ?? result?.audioUrl;
    if (!url) return;
    try {
      await share.shareUrl(url, 'Owli-AI Audio-Postcard', 'Mit Owli-AI Assist erstellt');
      setMessage('Teilen-Dialog wurde geöffnet oder der Link wurde kopiert.');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setMessage('Teilen wurde nicht abgeschlossen.');
      }
    }
  };

  const daily = usage?.audioPostcards?.daily;
  return (
    <section className="panel" aria-labelledby="postcard-title">
      <h2 id="postcard-title">Audio-Postcard</h2>
      <p>Verwandle das aktuelle Foto in eine kurze musikalische Postkarte.</p>
      {daily && (
        <p>
          Heute verfügbar:{' '}
          <strong>
            {daily.remaining} von {daily.limit}
          </strong>
        </p>
      )}
      <PrimaryButton
        disabled={status === 'generating' || daily?.remaining === 0}
        onClick={() => void generate()}
      >
        {status === 'generating' ? 'Audio-Postcard wird erstellt …' : 'Audio-Postcard erstellen'}
      </PrimaryButton>
      <LiveStatus message={message} assertive={status === 'error'} />
      {result?.audioUrl && (
        <div className="postcard-result">
          {/* Audio-only media has an adjacent textual scene and musical description. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls preload="metadata" src={result.audioUrl}>
            Dein Browser kann die Audio-Postcard nicht wiedergeben.
          </audio>
          {result.sceneCaption && <p>{result.sceneCaption}</p>}
          {result.musicalMapping && <p>{result.musicalMapping}</p>}
          <div className="button-row">
            <PrimaryButton onClick={() => void shareResult()}>
              {result.videoUrl ? 'Video teilen' : 'Audio-Postcard teilen'}
            </PrimaryButton>
            <a
              className="button button--secondary"
              href={result.videoUrl ?? result.audioUrl}
              download
            >
              Herunterladen
            </a>
          </div>
        </div>
      )}
    </section>
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
