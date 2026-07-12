import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@/app/App';

describe('App', () => {
  it('renders the accessible MVP entry points', async () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Assist im Browser' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kamera starten' })).toBeEnabled();
    await waitFor(() =>
      expect(screen.getByLabelText('Beschreibungsprofil')).toHaveValue('gpt52-scene-brief'),
    );
  });
});
