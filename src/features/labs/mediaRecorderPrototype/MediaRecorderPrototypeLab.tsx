import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { mediaRecorderFixtureManifest } from '@/features/labs/mediaRecorderPrototype/fixtureManifest';
import {
  createHarnessRun,
  createInitialEvidence,
  pickPreferredCandidate,
  probeRecorderCandidates,
} from '@/features/labs/mediaRecorderPrototype/harness';
import type { PrototypeMeasurementEvidence } from '@/features/labs/mediaRecorderPrototype/types';
import type { PrototypeHarnessController } from '@/features/labs/mediaRecorderPrototype/harness';

interface MediaRecorderPrototypeLabProps {
  enabled: boolean;
}

export function MediaRecorderPrototypeLab({ enabled }: MediaRecorderPrototypeLabProps) {
  const [evidence, setEvidence] = useState<PrototypeMeasurementEvidence>(() =>
    createInitialEvidence(enabled),
  );
  const [running, setRunning] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('scenario-01');
  const [attemptCounter, setAttemptCounter] = useState(0);
  const [statusMessage, setStatusMessage] = useState(
    enabled
      ? 'Das Staging-Harness ist bereit. Der normale Audio-Postcard-Flow bleibt unveraendert.'
      : 'Die Prototyp-Konfiguration ist nicht freigegeben. Die Route bleibt fail-closed.',
  );
  const controllerRef = useRef<PrototypeHarnessController | undefined>(undefined);
  const runTokenRef = useRef(0);
  const probes = useMemo(() => probeRecorderCandidates(), []);
  const preferredCandidate = useMemo(
    () => pickPreferredCandidate(probes, selectedCandidateId),
    [probes, selectedCandidateId],
  );

  useEffect(() => {
    if (!enabled) return;
    const cancelOnHidden = () => {
      if (document.visibilityState === 'hidden') {
        controllerRef.current?.cancel();
        setStatusMessage(
          'Der laufende Versuch wird beim Verlassen des Tabs abgebrochen und bereinigt.',
        );
      }
    };
    const cancelOnPageHide = () => {
      controllerRef.current?.cancel();
      setStatusMessage('Der laufende Versuch wird vor dem Verlassen der Seite bereinigt.');
    };
    document.addEventListener('visibilitychange', cancelOnHidden);
    window.addEventListener('pagehide', cancelOnPageHide);
    return () => {
      document.removeEventListener('visibilitychange', cancelOnHidden);
      window.removeEventListener('pagehide', cancelOnPageHide);
      controllerRef.current?.cancel();
    };
  }, [enabled]);

  const runHarness = async (scope: 'manifest' | 'single') => {
    if (!enabled || running) return;
    const runToken = ++runTokenRef.current;
    setRunning(true);
    setStatusMessage(
      'Die Prototyp-Messung laeuft. Die angeforderte Chunk-Cadence betraegt 1000 ms ohne Liefergarantie.',
    );
    const run = createHarnessRun({
      selectedCandidateId,
      ...(scope === 'single' ? { scenarioIds: [selectedScenarioId] } : {}),
      onProgress: setEvidence,
      onAttemptStart: (attemptId) => setAttemptCounter(attemptId),
      onAttemptRecordingStart: (attemptId) => {
        if (runTokenRef.current === runToken) {
          setStatusMessage(`Renderer-Aufnahme laeuft fuer Versuch ${attemptId}.`);
        }
      },
    });
    controllerRef.current = run.controller;
    try {
      const result = await run.promise;
      if (runTokenRef.current !== runToken) return;
      setEvidence(result);
      setStatusMessage(
        'Die Prototyp-Messung wurde lokal abgeschlossen. Ergebnisse verbleiben ausschliesslich in dieser Lab-Route.',
      );
    } catch (error) {
      if (runTokenRef.current !== runToken) return;
      setStatusMessage(
        error instanceof Error ? error.message : 'Die Prototyp-Messung ist fehlgeschlagen.',
      );
    } finally {
      if (runTokenRef.current === runToken) {
        controllerRef.current = undefined;
        setRunning(false);
      }
    }
  };

  const cancelHarness = () => {
    const controller = controllerRef.current;
    controller?.cancel();
    flushSync(() => {
      setStatusMessage(
        'Der laufende Versuch wird abgebrochen. Ein neuer Lauf ist erst nach vollstaendigem Cleanup verfuegbar.',
      );
    });
    controller?.reportCancelVisible();
  };

  const exportEvidence = () => {
    const blob = new Blob([`${JSON.stringify(evidence, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'mediarecorder-prototype-evidence.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!enabled) {
    return (
      <section className="panel" aria-labelledby="mediarecorder-lab-closed-title">
        <p className="eyebrow">Staging-Prototyp</p>
        <h2 id="mediarecorder-lab-closed-title">MediaRecorder-Lab ist fail-closed</h2>
        <p className="live-status" role="alert">
          Diese isolierte Lab-Route erfordert die explizite Staging-Konfiguration
          `VITE_OWLI_STAGING_PROTOTYPE_MEDIARECORDER=enabled`. Ohne diese Freigabe bleibt sie aus
          normaler Navigation und aus dem Audio-Postcard-Flow ausgeschlossen.
        </p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="mediarecorder-lab-title">
      <p className="eyebrow">Staging-Prototyp / Slice 6 Candidate A</p>
      <h2 id="mediarecorder-lab-title">
        MediaRecorder-Renderer und deterministisches Mess-Harness
      </h2>
      <p>
        Diese Route ist nur fuer explizite Staging-/Preview-Messungen gedacht. Sie verwendet
        statische Canvas-Bilder und lokale Audio-Fixtures, ruft kein Backend auf und veraendert den
        normalen Audio-Postcard-Nutzerfluss nicht.
      </p>
      <div className="workspace-grid">
        <section className="panel" aria-labelledby="mediarecorder-lab-config-title">
          <h3 id="mediarecorder-lab-config-title">Konfiguration</h3>
          <p className="field-hint">
            Route: <code>{mediaRecorderFixtureManifest.routePath}</code>
          </p>
          <label htmlFor="mediarecorder-candidate">Bevorzugter MIME-Kandidat</label>
          <select
            id="mediarecorder-candidate"
            value={selectedCandidateId}
            disabled={running}
            onChange={(event) => setSelectedCandidateId(event.currentTarget.value)}
          >
            <option value="">Ersten unterstuetzten Kandidaten verwenden</option>
            {probes.map((probe) => (
              <option key={probe.candidate.id} value={probe.candidate.id}>
                {probe.candidate.mimeType} {probe.supported ? '(unterstuetzt)' : '(unsupported)'}
              </option>
            ))}
          </select>
          <p className="field-hint">
            Aktuelle Wahl fuer den naechsten Lauf:{' '}
            {preferredCandidate?.mimeType ?? 'kein unterstuetzter Kandidat'}
          </p>
          <label htmlFor="mediarecorder-scenario">Einzelszenario</label>
          <select
            id="mediarecorder-scenario"
            value={selectedScenarioId}
            disabled={running}
            onChange={(event) => setSelectedScenarioId(event.currentTarget.value)}
          >
            {mediaRecorderFixtureManifest.scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.order}. {scenario.imageId} + {scenario.audioId}
              </option>
            ))}
          </select>
          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              disabled={running}
              onClick={() => void runHarness('manifest')}
            >
              Manifest in deterministischer Reihenfolge ausfuehren
            </button>
            <button
              className="button button--secondary"
              type="button"
              disabled={running}
              onClick={() => void runHarness('single')}
            >
              Ausgewaehltes Szenario ausfuehren
            </button>
            <button
              className="button button--secondary"
              type="button"
              disabled={!running}
              onClick={cancelHarness}
            >
              Lauf abbrechen
            </button>
            <button className="button button--secondary" type="button" onClick={exportEvidence}>
              Evidence exportieren
            </button>
          </div>
          <p className="live-status" role="status">
            {statusMessage}
          </p>
        </section>
        <section className="panel" aria-labelledby="mediarecorder-lab-manifest-title">
          <h3 id="mediarecorder-lab-manifest-title">Fixture-Manifest</h3>
          <p>
            {mediaRecorderFixtureManifest.images.length} Bild-Fixtures,{' '}
            {mediaRecorderFixtureManifest.audio.length} Audio-Fixtures,{' '}
            {mediaRecorderFixtureManifest.scenarios.length} deterministische Szenarien.
          </p>
          <ul>
            {mediaRecorderFixtureManifest.scenarios.map((scenario) => (
              <li key={scenario.id}>
                {scenario.order}. {scenario.imageId} + {scenario.audioId}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="panel" aria-labelledby="mediarecorder-lab-probe-title">
        <h3 id="mediarecorder-lab-probe-title">MIME-Probing</h3>
        <ul>
          {probes.map((probe) => (
            <li key={probe.candidate.id}>
              <code>{probe.candidate.mimeType}</code>:{' '}
              {probe.supported ? 'supported' : 'UNSUPPORTED'}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel" aria-labelledby="mediarecorder-lab-results-title">
        <h3 id="mediarecorder-lab-results-title">Mess-Ergebnisse</h3>
        <p>
          Laufender Versuch: {attemptCounter}. Ergebnisse werden ausschliesslich in diesem
          Prototyp-Harness gehalten.
        </p>
        <div className="answer-box" data-testid="mediarecorder-prototype-evidence">
          <pre>{JSON.stringify(evidence, null, 2)}</pre>
        </div>
      </section>
    </section>
  );
}
