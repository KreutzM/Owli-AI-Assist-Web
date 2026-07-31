import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaRecorderPrototypeLab } from '@/features/labs/mediaRecorderPrototype/MediaRecorderPrototypeLab';

const harnessMocks = vi.hoisted(() => ({
  createHarnessRun: vi.fn(),
  createInitialEvidence: vi.fn(),
  pickPreferredCandidate: vi.fn(),
  probeRecorderCandidates: vi.fn(),
}));

vi.mock('@/features/labs/mediaRecorderPrototype/harness', () => ({
  createHarnessRun: harnessMocks.createHarnessRun,
  createInitialEvidence: harnessMocks.createInitialEvidence,
  pickPreferredCandidate: harnessMocks.pickPreferredCandidate,
  probeRecorderCandidates: harnessMocks.probeRecorderCandidates,
}));

describe('MediaRecorderPrototypeLab', () => {
  beforeEach(() => {
    harnessMocks.createInitialEvidence.mockReturnValue({
      generatedAt: '2026-07-31T00:00:00.000Z',
      routePath: '/lab/mediarecorder-prototype',
      prototypeConfigEnabled: true,
      preferredCandidateId: 'webm-vp8-opus',
      probes: [],
      results: [],
      normalFlowUnchanged: true,
      notes: [],
    });
    harnessMocks.probeRecorderCandidates.mockReturnValue([
      {
        candidate: {
          id: 'webm-vp8-opus',
          mimeType: 'video/webm;codecs=vp8,opus',
          fileExtension: 'webm',
        },
        supported: true,
      },
    ]);
    harnessMocks.pickPreferredCandidate.mockReturnValue({
      id: 'webm-vp8-opus',
      mimeType: 'video/webm;codecs=vp8,opus',
      fileExtension: 'webm',
    });
    harnessMocks.createHarnessRun.mockReset();
  });

  it('fails closed without the explicit staging prototype flag', () => {
    render(<MediaRecorderPrototypeLab enabled={false} />);

    expect(screen.getByRole('heading', { name: 'MediaRecorder-Lab ist fail-closed' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'VITE_OWLI_STAGING_PROTOTYPE_MEDIARECORDER=enabled',
    );
  });

  it('runs a single scenario through the harness and surfaces evidence', async () => {
    harnessMocks.createHarnessRun.mockReturnValue({
      controller: { cancel: vi.fn(), attemptId: 1 },
      promise: Promise.resolve({
        generatedAt: '2026-07-31T00:00:10.000Z',
        routePath: '/lab/mediarecorder-prototype',
        prototypeConfigEnabled: true,
        preferredCandidateId: 'webm-vp8-opus',
        probes: [],
        results: [
          {
            scenarioId: 'scenario-01',
            scenarioOrder: 1,
            imageId: 'landscape-jpeg',
            audioId: 'audio-mpeg-10s',
            candidateId: 'webm-vp8-opus',
            requestedMimeType: 'video/webm;codecs=vp8,opus',
            status: 'PASS',
          },
        ],
        normalFlowUnchanged: true,
        notes: ['local only'],
      }),
    });

    render(<MediaRecorderPrototypeLab enabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Ausgewaehltes Szenario ausfuehren' }));

    await waitFor(() => {
      expect(harnessMocks.createHarnessRun).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioIds: ['scenario-01'] }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId('mediarecorder-prototype-evidence')).toHaveTextContent(
        '"scenarioId": "scenario-01"',
      ),
    );
  });
});
