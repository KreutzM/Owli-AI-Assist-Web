import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteSceneState } from '@/features/remote/useRemoteScene';
import { useSceneAnnouncements } from '@/features/remote/useSceneAnnouncements';

afterEach(() => {
  vi.useRealTimers();
});

describe('useSceneAnnouncements', () => {
  it('does not replay the previous stream segment in a consecutive attempt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));
    const { result, rerender } = renderHook(
      ({ state }: { state: RemoteSceneState }) => useSceneAnnouncements(state),
      { initialProps: { state: sceneState('requesting', '', 1) } },
    );

    rerender({ state: sceneState('streaming', 'Erster Satz.', 1) });
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current).toBe('Erster Satz.');

    rerender({ state: sceneState('requesting', '', 2) });
    expect(result.current).toBe('Die Szenenbeschreibung wird angefordert.');
    rerender({ state: sceneState('streaming', '', 2) });
    expect(result.current).toBe('');
  });
});

function sceneState(
  status: RemoteSceneState['status'],
  streamedText: string,
  announcementRun: number,
): RemoteSceneState {
  return { status, streamedText, announcementRun };
}
