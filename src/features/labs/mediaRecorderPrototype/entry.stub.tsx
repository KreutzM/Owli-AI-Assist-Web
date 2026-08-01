interface MediaRecorderPrototypeLabProps {
  enabled: boolean;
}

export function MediaRecorderPrototypeLab({ enabled: _enabled }: MediaRecorderPrototypeLabProps) {
  void _enabled;
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
