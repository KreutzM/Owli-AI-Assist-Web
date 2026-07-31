import { describe, expect, it } from 'vitest';
import {
  audioPostcardReducer,
  INITIAL_AUDIO_POSTCARD_STATE,
  isAudioPostcardActive,
} from '@/features/remote/audioPostcardState';
import { audioPostcardOptions, readyAudioPostcard } from './audioPostcardFixtures';

describe('Audio-Postcard state machine', () => {
  it('loads options and moves through exactly one active request to ready', () => {
    const options = audioPostcardOptions();
    let state = audioPostcardReducer(INITIAL_AUDIO_POSTCARD_STATE, {
      type: 'OPTIONS_LOADING',
      imageKey: 'blob:scene-1',
      requestRun: 1,
    });
    state = audioPostcardReducer(state, {
      type: 'OPTIONS_READY',
      imageKey: 'blob:scene-1',
      requestRun: 1,
      options,
      profileId: 'warm_audio_postcard',
      modeId: 'lyria_sung_hook',
    });
    state = audioPostcardReducer(state, { type: 'PREPARE', requestRun: 2, startedAt: 100 });
    expect(state.status).toBe('preparing');
    expect(isAudioPostcardActive(state.status)).toBe(true);
    state = audioPostcardReducer(state, { type: 'SUBMIT', requestRun: 2 });
    state = audioPostcardReducer(state, { type: 'GENERATE', requestRun: 2 });
    state = audioPostcardReducer(state, {
      type: 'TERMINAL',
      requestRun: 2,
      result: readyAudioPostcard(),
    });
    expect(state).toMatchObject({
      status: 'ready',
      playerState: 'metadata_ready',
      quota: { charged: true },
    });
  });

  it('ignores stale callbacks after cancel and reset', () => {
    const active = activeState();
    const cancelled = audioPostcardReducer(active, {
      type: 'ERROR',
      requestRun: 3,
      status: 'cancelled',
      ambiguousOutcome: true,
    });
    const stale = audioPostcardReducer(cancelled, {
      type: 'TERMINAL',
      requestRun: 2,
      result: readyAudioPostcard(),
    });
    expect(stale).toBe(cancelled);
    expect(stale).toMatchObject({ status: 'cancelled', ambiguousOutcome: true });

    const reset = audioPostcardReducer(stale, { type: 'RESET', requestRun: 4 });
    expect(reset).toEqual({
      ...INITIAL_AUDIO_POSTCARD_STATE,
      requestRun: 4,
    });
  });

  it('retains text alternatives and quota after expiry', () => {
    const ready = audioPostcardReducer(activeState(), {
      type: 'TERMINAL',
      requestRun: 2,
      result: readyAudioPostcard(),
    });
    const expired = audioPostcardReducer(ready, { type: 'EXPIRE' });
    expect(expired.status).toBe('expired');
    expect(expired.result?.status).toBe('ready');
    expect(expired.quota).toMatchObject({
      charged: true,
      windows: [{ scope: 'installation', remaining: 4 }],
    });
  });
});

function activeState() {
  const options = audioPostcardOptions();
  const loading = audioPostcardReducer(INITIAL_AUDIO_POSTCARD_STATE, {
    type: 'OPTIONS_LOADING',
    imageKey: 'blob:scene-1',
    requestRun: 1,
  });
  const idle = audioPostcardReducer(loading, {
    type: 'OPTIONS_READY',
    imageKey: 'blob:scene-1',
    requestRun: 1,
    options,
    profileId: 'warm_audio_postcard',
    modeId: 'lyria_sung_hook',
  });
  return audioPostcardReducer(idle, {
    type: 'PREPARE',
    requestRun: 2,
    startedAt: 100,
  });
}
