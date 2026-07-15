import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteClientError, type RemoteCatalogClient } from '@/core/api/remoteCatalogClient';
import type { RemoteProfileCatalog } from '@/core/api/remoteCatalogContracts';
import { RemoteCatalog } from '@/features/remote/RemoteCatalog';

const catalog: RemoteProfileCatalog = {
  defaultProfileId: 'basic',
  profiles: [
    {
      id: 'basic',
      label: 'Basic',
      description: 'Readiness profile',
      supportsStreaming: false,
      supportsFollowup: false,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function asClient(value: {
  initialize: (signal?: AbortSignal) => Promise<RemoteProfileCatalog>;
  refresh: (signal?: AbortSignal) => Promise<RemoteProfileCatalog>;
}): RemoteCatalogClient {
  return value as unknown as RemoteCatalogClient;
}

function pendingUntilAbort(signal: AbortSignal | undefined): Promise<RemoteProfileCatalog> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new RemoteClientError('REQUEST_ABORTED')), {
      once: true,
    });
  });
}

describe('RemoteCatalog attempts', () => {
  it('aborts the active request when the runtime client is replaced', async () => {
    let firstSignal: AbortSignal | undefined;
    const firstClient = asClient({
      initialize: vi.fn<(signal?: AbortSignal) => Promise<RemoteProfileCatalog>>((signal) => {
        firstSignal = signal;
        return pendingUntilAbort(signal);
      }),
      refresh: vi.fn(async () => catalog),
    });
    const secondClient = asClient({
      initialize: vi.fn(async () => catalog),
      refresh: vi.fn(async () => catalog),
    });

    const view = render(<RemoteCatalog client={firstClient} />);
    await waitFor(() => expect(firstSignal).toBeDefined());
    view.rerender(<RemoteCatalog client={secondClient} />);

    await waitFor(() => expect(firstSignal?.aborted).toBe(true));
    expect(await view.findByRole('heading', { name: 'Basic' })).toBeVisible();
  });

  it('disables retry while the replacement attempt is active and aborts it on unmount', async () => {
    let retrySignal: AbortSignal | undefined;
    const initialize = vi
      .fn<(signal?: AbortSignal) => Promise<RemoteProfileCatalog>>()
      .mockRejectedValueOnce(new RemoteClientError('NETWORK_UNAVAILABLE'))
      .mockImplementationOnce((signal) => {
        retrySignal = signal;
        return pendingUntilAbort(signal);
      });
    const client = asClient({ initialize, refresh: vi.fn(async () => catalog) });

    const view = render(<RemoteCatalog client={client} />);
    fireEvent.click(await view.findByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Erneut versuchen' })).toBeDisabled(),
    );
    expect(initialize).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(retrySignal?.aborted).toBe(true);
  });

  it('keeps the catalog visible and disables refresh while an abortable refresh is active', async () => {
    let refreshSignal: AbortSignal | undefined;
    const client = asClient({
      initialize: vi.fn(async () => catalog),
      refresh: vi.fn<(signal?: AbortSignal) => Promise<RemoteProfileCatalog>>((signal) => {
        refreshSignal = signal;
        return pendingUntilAbort(signal);
      }),
    });

    const view = render(<RemoteCatalog client={client} />);
    expect(await view.findByRole('heading', { name: 'Basic' })).toBeVisible();
    fireEvent.click(view.getByRole('button', { name: 'Profilkatalog aktualisieren' }));

    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Profilkatalog aktualisieren' })).toBeDisabled(),
    );
    expect(view.getByRole('heading', { name: 'Basic' })).toBeVisible();
    expect(view.getByRole('status')).toHaveTextContent('wird aktualisiert');

    view.unmount();
    expect(refreshSignal?.aborted).toBe(true);
  });
});
