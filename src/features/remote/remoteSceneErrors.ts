import { RemoteClientError } from '@/core/api/remoteAssistClient';
import { SceneStreamError } from '@/core/api/sceneSse';
import { SceneImageError } from '@/core/image/sceneImageInspection';
import { CameraError } from '@/platform/camera/remoteCamera';
import type { RemoteSceneStatus } from '@/features/remote/useRemoteScene';

export function isRemoteSceneAbort(error: unknown): boolean {
  return (
    (error instanceof RemoteClientError && error.code === 'REQUEST_ABORTED') ||
    (error instanceof SceneStreamError && error.code === 'REQUEST_ABORTED') ||
    (error instanceof SceneImageError && error.code === 'REQUEST_ABORTED') ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

export function remoteSceneErrorStatus(error: unknown): RemoteSceneStatus {
  if (error instanceof RemoteClientError && error.code === 'RATE_LIMITED') return 'rate_limited';
  if (error instanceof SceneStreamError && error.code === 'STREAM_CONTRACT_INVALID') {
    return 'contract_error';
  }
  if (error instanceof RemoteClientError && error.code === 'REMOTE_CONTRACT_INVALID') {
    return 'contract_error';
  }
  return 'recoverable_error';
}

export function imageErrorIsContract(error: unknown): boolean {
  return (
    error instanceof SceneImageError && ['MIME_MISMATCH', 'MALFORMED_IMAGE'].includes(error.code)
  );
}

export function readinessMessage(error: unknown): string {
  return error instanceof RemoteClientError && error.code === 'RATE_LIMITED'
    ? 'Der Dienst ist vorübergehend ausgelastet.'
    : 'Die Online-Vorbereitung ist derzeit nicht verfügbar.';
}

export function cameraMessage(error: unknown): string {
  const code = error instanceof CameraError ? error.code : undefined;
  if (code === 'CAMERA_UNSUPPORTED') return 'Dieser Browser unterstützt keinen Kamerazugriff.';
  if (code === 'CAMERA_DENIED')
    return 'Der Kamerazugriff wurde nicht erlaubt. Die Dateiauswahl bleibt verfügbar.';
  if (code === 'CAMERA_MISSING')
    return 'Es wurde keine Kamera gefunden. Die Dateiauswahl bleibt verfügbar.';
  if (code === 'CAMERA_BUSY')
    return 'Die Kamera wird gerade von einer anderen Anwendung verwendet.';
  if (code === 'CAMERA_NOT_READY') return 'Die Kamera ist noch nicht bereit.';
  return 'Die Kamera konnte nicht gestartet oder ausgelöst werden.';
}

export function imageMessage(error: unknown): string {
  const code = error instanceof SceneImageError ? error.code : undefined;
  if (code === 'SOURCE_TOO_LARGE') return 'Die Quelldatei ist größer als 20 MiB.';
  if (code === 'SOURCE_READ_FAILED') return 'Die ausgewählte Bilddatei konnte nicht gelesen werden.';
  if (code === 'DIMENSIONS_TOO_LARGE' || code === 'PIXEL_LIMIT_EXCEEDED') {
    return 'Das Bild überschreitet die lokalen Abmessungsgrenzen.';
  }
  if (code === 'IMAGE_TOO_LARGE') return 'Das Bild konnte nicht unter 4 MiB normalisiert werden.';
  if (code === 'UNSUPPORTED_IMAGE' || code === 'MIME_MISMATCH') {
    return 'Bitte wähle ein gültiges JPEG-, PNG- oder WebP-Bild.';
  }
  return 'Das Bild konnte lokal nicht verarbeitet werden.';
}

export function sceneMessage(error: unknown): string {
  if (error instanceof RemoteClientError && error.code === 'RATE_LIMITED') {
    return 'Der Dienst ist vorübergehend ausgelastet. Bitte versuche es später erneut.';
  }
  if (error instanceof RemoteClientError && error.code === 'FORBIDDEN') {
    return 'Diese Anfrage ist derzeit nicht freigegeben.';
  }
  if (error instanceof SceneStreamError && error.code === 'REMOTE_STREAM_ERROR') {
    return error.payload?.message ?? 'Die Szenenbeschreibung ist fehlgeschlagen.';
  }
  if (error instanceof SceneStreamError && error.code.includes('TIMEOUT')) {
    return 'Die Szenenbeschreibung hat das Zeitlimit überschritten.';
  }
  if (remoteSceneErrorStatus(error) === 'contract_error') {
    return 'Die Streaming-Antwort entsprach nicht dem freigegebenen Vertrag.';
  }
  return 'Die Szenenbeschreibung konnte nicht abgeschlossen werden.';
}
