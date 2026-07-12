import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OwliApi } from '@/core/types';
import { AudioPostcardPanel } from '@/features/postcard/AudioPostcardPanel';
import type { ShareGateway } from '@/platform/share/browserShare';

function createApi(): OwliApi {
  return {
    listProfiles: vi.fn(),
    describeScene: vi.fn(),
    askFollowup: vi.fn(),
    getUsage: vi.fn().mockResolvedValue({
      audioPostcards: {
        daily: { limit: 3, remaining: 2, resetAt: '2026-07-13T00:00:00.000Z' },
      },
    }),
    generateAudioPostcard: vi.fn().mockResolvedValue({
      status: 'ready',
      audioUrl: 'https://api.owli-ai.com/demo.wav',
      sceneCaption: 'Eine ruhige Szene.',
      musicalMapping: 'Warme Töne.',
    }),
  };
}

describe('AudioPostcardPanel', () => {
  it('shows quota context and renders a completed postcard', async () => {
    const user = userEvent.setup();
    const api = createApi();
    const share: ShareGateway = { shareUrl: vi.fn() };
    const { container } = render(
      <AudioPostcardPanel
        api={api}
        share={share}
        image={new Blob(['image'], { type: 'image/jpeg' })}
        locale="de-DE"
      />,
    );

    expect(await screen.findByText(/2 von 3/u)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Audio-Postcard erstellen' }));

    expect(await screen.findByText('Audio-Postcard ist fertig.')).toBeInTheDocument();
    expect(screen.getByText('Eine ruhige Szene.')).toBeInTheDocument();
    expect(container.querySelector('audio')).toHaveAttribute(
      'src',
      'https://api.owli-ai.com/demo.wav',
    );
  });
});
