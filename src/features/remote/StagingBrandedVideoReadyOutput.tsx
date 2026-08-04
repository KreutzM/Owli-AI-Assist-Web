import { useEffect, useRef, useState } from 'react';
import { canShareFile, shareFile } from '@/platform/share/browserShare';

const SHARE_PENDING_MESSAGE = 'Teilen wird geöffnet …';
const SHARE_SUCCESS_MESSAGE = 'Video wurde zum Teilen übergeben.';
const SHARE_CANCELLED_MESSAGE =
  'Teilen wurde abgebrochen. Video, Wiedergabe und Download bleiben verfügbar.';
const SHARE_ERROR_MESSAGE =
  'Video konnte nicht geteilt werden. Wiedergabe und Download bleiben verfügbar.';
const SHARE_TITLE = 'Owli-AI Audio-Postcard';
const SHARE_TEXT = 'Mit Owli-AI Assist erstellt';

interface StagingBrandedVideoReadyOutputProps {
  file: File;
  url: string;
  onMessage: (file: File, url: string, message: string) => void;
}

export function StagingBrandedVideoReadyOutput({
  file,
  url,
  onMessage,
}: StagingBrandedVideoReadyOutputProps) {
  const [sharePending, setSharePending] = useState(false);
  const shareAttemptRef = useRef(0);
  const shareInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    downloadRef.current?.focus();
    return () => {
      mountedRef.current = false;
      shareAttemptRef.current += 1;
      shareInFlightRef.current = false;
    };
  }, []);

  const shareVideo = async () => {
    if (shareInFlightRef.current) return;
    const shareAttempt = shareAttemptRef.current + 1;
    shareAttemptRef.current = shareAttempt;
    shareInFlightRef.current = true;
    setSharePending(true);
    onMessage(file, url, SHARE_PENDING_MESSAGE);
    try {
      await shareFile(file, SHARE_TITLE, SHARE_TEXT);
      if (mountedRef.current && shareAttempt === shareAttemptRef.current) {
        onMessage(file, url, SHARE_SUCCESS_MESSAGE);
      }
    } catch (error) {
      if (mountedRef.current && shareAttempt === shareAttemptRef.current) {
        onMessage(
          file,
          url,
          error instanceof DOMException && error.name === 'AbortError'
            ? SHARE_CANCELLED_MESSAGE
            : SHARE_ERROR_MESSAGE,
        );
      }
    } finally {
      if (shareAttempt === shareAttemptRef.current) {
        shareInFlightRef.current = false;
        if (mountedRef.current) {
          setSharePending(false);
          window.setTimeout(() => {
            if (
              mountedRef.current &&
              !shareInFlightRef.current &&
              shareAttempt === shareAttemptRef.current
            ) {
              shareRef.current?.focus();
            }
          }, 0);
        }
      }
    }
  };

  const canShare = canShareFile(file, SHARE_TITLE, SHARE_TEXT);

  return (
    <div className="audio-postcard-result">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        aria-label="Gebrandetes Owli Audio-Postcard-Video abspielen"
        controls
        playsInline
        preload="metadata"
        src={url}
      >
        Dein Browser unterstützt die Video-Wiedergabe nicht.
      </video>
      <div className="scene-actions audio-postcard-actions">
        <a
          ref={downloadRef}
          className="button button--secondary"
          href={url}
          download={file.name}
          onClick={() => onMessage(file, url, 'Video-Download wurde gestartet.')}
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
  );
}
