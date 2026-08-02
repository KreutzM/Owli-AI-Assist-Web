import { useCallback, useEffect, useRef, useState } from 'react';
import { FOLLOWUP_QUESTION_MAX_LENGTH } from '@/core/api/remoteFollowupContracts';
import type { RemoteAssistClient } from '@/core/api/remoteAssistClient';
import type { RemoteCamera } from '@/platform/camera/remoteCamera';
import type { BrowserSceneImageNormalizer } from '@/platform/image/browserSceneImageNormalizer';
import type { SpeechLifecycleGateway } from '@/platform/speech/browserSpeech';
import {
  isAudioPostcardActive,
  readyAudioPostcardResult,
} from '@/features/remote/audioPostcardState';
import { isFollowupActive } from '@/features/remote/followupState';
import { RemoteAudioPostcardPanel } from '@/features/remote/RemoteAudioPostcardPanel';
import { RemoteFollowupPanel } from '@/features/remote/RemoteFollowupPanel';
import { RemoteSceneContent } from '@/features/remote/RemoteSceneContent';
import {
  isStagingBrandedVideoExportAvailable,
  StagingBrandedVideoExport,
} from '@/features/remote/StagingBrandedVideoExport';
import { useAudioPostcard } from '@/features/remote/useAudioPostcard';
import { useFollowupAnnouncements } from '@/features/remote/useFollowupAnnouncements';
import { useRemoteScene } from '@/features/remote/useRemoteScene';
import { useSceneAnnouncements } from '@/features/remote/useSceneAnnouncements';
import '@/features/remote/remote.css';

interface RemoteAssistProps {
  client: RemoteAssistClient;
  camera: RemoteCamera;
  normalizer: BrowserSceneImageNormalizer;
  speech: SpeechLifecycleGateway;
  locale: string;
}

export function RemoteAssist({ client, camera, normalizer, speech, locale }: RemoteAssistProps) {
  const workflow = useRemoteScene(client, camera, normalizer, speech, locale);
  const { state, followup, speechState, reset } = workflow;
  const sceneAnnouncement = useSceneAnnouncements(state);
  const followupAnnouncement = useFollowupAnnouncements(followup);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const newSceneButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterResetRef = useRef(false);
  const previousSceneStatus = useRef(state.status);
  const [videoReady, setVideoReady] = useState(false);
  const [retryClock, setRetryClock] = useState(() => Date.now());

  const readinessEnabled =
    state.readiness?.sceneDescribeEnabled === true && state.selectedProfileId !== undefined;
  const sceneActive = [
    'camera_starting',
    'normalizing',
    'requesting',
    'streaming',
    'terminal_waiting_for_eof',
  ].includes(state.status);
  const followupActive = isFollowupActive(followup.status);
  const postcard = useAudioPostcard(client, {
    enabled: state.readiness?.audioPostcardEnabled === true,
    sceneComplete: state.status === 'complete',
    ...(state.image ? { image: state.image } : {}),
    locale: state.resultLocale ?? locale,
    conflictingRequest: sceneActive || followupActive,
  });
  const postcardActive = isAudioPostcardActive(postcard.state.status);
  const readyPostcard = readyAudioPostcardResult(postcard.state);
  const stagingVideoEnabled = isStagingBrandedVideoExportAvailable({
    buildFlag: import.meta.env.VITE_OWLI_STAGING_BRANDED_VIDEO_EXPORT,
    apiBaseUrl: import.meta.env.VITE_OWLI_API_BASE_URL,
    image: state.image,
    result: readyPostcard,
    options: postcard.state.options,
  });
  const active = sceneActive || followupActive || postcardActive;
  const cameraVisible = state.status === 'camera_starting' || state.status === 'camera_ready';
  const sceneRetrySeconds =
    state.status === 'rate_limited' && state.retryAt !== undefined
      ? Math.max(0, Math.ceil((state.retryAt - retryClock) / 1000))
      : 0;
  const followupRetrySeconds =
    followup.status === 'rate_limited' && followup.retryAt !== undefined
      ? Math.max(0, Math.ceil((followup.retryAt - retryClock) / 1000))
      : 0;
  const sceneRetryReady =
    state.status !== 'rate_limited' || state.retryAt === undefined || retryClock >= state.retryAt;
  const followupRetryReady =
    followup.status !== 'rate_limited' ||
    followup.retryAt === undefined ||
    retryClock >= followup.retryAt;
  const retryableImage =
    state.image !== undefined &&
    ['prepared', 'cancelled', 'recoverable_error', 'rate_limited'].includes(state.status);
  const canDescribe = retryableImage && sceneRetryReady && !followupActive;
  const profileLocked = state.image !== undefined;
  const followupVisible = state.status === 'complete' && followup.status !== 'unavailable';
  const canSubmitFollowup =
    followupVisible &&
    followup.status !== 'context_expired' &&
    !followupActive &&
    followupRetryReady &&
    Boolean(followup.questionDraft.trim()) &&
    !postcardActive;
  const remainingQuestionCharacters = FOLLOWUP_QUESTION_MAX_LENGTH - followup.questionDraft.length;

  const resetScene = useCallback(() => {
    focusAfterResetRef.current = true;
    postcard.reset();
    reset();
  }, [postcard, reset]);

  useEffect(() => {
    const unlockAt = [state.retryAt, followup.retryAt]
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right)[0];
    if (unlockAt === undefined || retryClock >= unlockAt) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setRetryClock(current);
      if (current >= unlockAt) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [followup.retryAt, retryClock, state.retryAt]);

  useEffect(() => {
    if (
      state.status === 'recoverable_error' ||
      state.status === 'contract_error' ||
      state.status === 'cancelled'
    ) {
      cameraButtonRef.current?.focus();
    }
  }, [state.status]);

  useEffect(() => {
    if (!focusAfterResetRef.current || state.status !== 'ready_idle') return;
    focusAfterResetRef.current = false;
    cameraButtonRef.current?.focus();
  }, [state.status]);

  useEffect(() => {
    if (followup.focusTarget === 'question') questionRef.current?.focus();
    if (followup.focusTarget === 'new_scene') newSceneButtonRef.current?.focus();
  }, [followup.focusRun, followup.focusTarget]);

  useEffect(() => {
    if (
      previousSceneStatus.current !== 'complete' &&
      state.status === 'complete' &&
      followup.status === 'idle'
    ) {
      questionRef.current?.focus();
    }
    previousSceneStatus.current = state.status;
  }, [followup.status, state.status]);

  return (
    <section className="panel remote-scene" aria-labelledby="remote-scene-title" aria-busy={active}>
      <p className="eyebrow">Sichere Online-Beschreibung</p>
      <h2 id="remote-scene-title">Eine Szene aufnehmen oder auswählen</h2>
      <p>
        Kamera und Datei werden erst nach deiner Aktion verwendet. Das Bild wird lokal geprüft, als
        JPEG verkleinert und nicht im Browser gespeichert.
      </p>

      <RemoteSceneContent
        workflow={workflow}
        videoRef={videoRef}
        cameraButtonRef={cameraButtonRef}
        readinessEnabled={readinessEnabled}
        active={active}
        cameraVisible={cameraVisible}
        profileLocked={profileLocked}
        videoReady={videoReady}
        setVideoReady={setVideoReady}
        retryableImage={retryableImage}
        canDescribe={canDescribe}
        sceneRetrySeconds={sceneRetrySeconds}
        sceneRetryReady={sceneRetryReady}
        onReset={resetScene}
      />

      <RemoteFollowupPanel
        workflow={workflow}
        questionRef={questionRef}
        visible={followupVisible}
        active={followupActive}
        canSubmit={canSubmitFollowup}
        retrySeconds={followupRetrySeconds}
        retryReady={followupRetryReady}
        remainingQuestionCharacters={remainingQuestionCharacters}
        blocked={postcardActive}
      />

      {state.status === 'complete' && (
        <RemoteAudioPostcardPanel
          workflow={postcard}
          conflictingRequest={sceneActive || followupActive}
          onNewImage={resetScene}
        />
      )}

      {stagingVideoEnabled && state.image && readyPostcard && postcard.state.options && (
        <StagingBrandedVideoExport
          key={`${state.image.previewUrl}:${readyPostcard.requestId}`}
          enabled
          image={state.image}
          result={readyPostcard}
          options={postcard.state.options}
          apiBaseUrl={import.meta.env.VITE_OWLI_API_BASE_URL}
        />
      )}

      {state.status === 'complete' && (
        <section className="speech-disclosure" aria-labelledby="speech-title">
          <h3 id="speech-title">Lokale Sprachausgabe</h3>
          <p>
            Owli sendet keine zusätzliche Sprachanfrage an das Owli-Backend. Der Browser oder das
            Betriebssystem übernimmt die Sprachsynthese; Plattformstimmen können dabei ein eigenes
            Verarbeitungsverhalten haben. Eine vollständig offline oder ausschließlich auf dem Gerät
            ausgeführte Sprachausgabe wird nicht garantiert.
          </p>
          {speechState === 'unsupported' && (
            <p role="status">Sprachausgabe wird in diesem Browser nicht unterstützt.</p>
          )}
          {speechState === 'speaking' && <p role="status">Sprachausgabe läuft.</p>}
          {speechState === 'error' && (
            <p className="live-status" role="alert">
              Die lokale Sprachausgabe konnte nicht gestartet oder abgeschlossen werden.
            </p>
          )}
        </section>
      )}

      {(state.status === 'complete' || followup.status === 'context_expired') && (
        <button
          ref={newSceneButtonRef}
          className="button button--secondary"
          type="button"
          onClick={resetScene}
        >
          {followup.status === 'context_expired' ? 'Neue Szene beginnen' : 'Neues Bild'}
        </button>
      )}

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {sceneAnnouncement}
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {followupAnnouncement}
      </p>
    </section>
  );
}
