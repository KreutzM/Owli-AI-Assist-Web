import { useState } from 'react';
import { copyTextToClipboard } from '@/platform/clipboard/browserClipboard';
import type { BrandedVideoExportErrorCode } from '@/shared/media/brandedVideoExportError';

interface StagingBrandedVideoDiagnosticProps {
  code: BrandedVideoExportErrorCode;
}

export function StagingBrandedVideoDiagnostic({ code }: StagingBrandedVideoDiagnosticProps) {
  const [copyStatus, setCopyStatus] = useState('');

  const copyCode = async () => {
    const copied = await copyTextToClipboard(code);
    setCopyStatus(
      copied
        ? 'Fehlercode wurde kopiert.'
        : 'Fehlercode konnte nicht kopiert werden und bleibt sichtbar.',
    );
  };

  return (
    <section className="audio-postcard-result" aria-labelledby="staging-video-diagnostic-title">
      <h5 id="staging-video-diagnostic-title">Staging-Diagnose</h5>
      <p>
        Fehlercode: <code>{code}</code>
      </p>
      <button className="button button--secondary" type="button" onClick={() => void copyCode()}>
        Fehlercode kopieren
      </button>
      <p className="live-status" role="status" aria-live="polite" aria-atomic="true">
        {copyStatus}
      </p>
    </section>
  );
}
