import { describe, expect, it } from 'vitest';
import { initialSceneState, sceneReducer } from '@/features/scene/sceneReducer';

describe('sceneReducer', () => {
  it('accumulates streaming deltas and replaces them with the final answer', () => {
    const streaming = sceneReducer(sceneReducer(initialSceneState, { type: 'analysisStarted' }), {
      type: 'analysisDelta',
      delta: 'Teil ',
    });
    const ready = sceneReducer(streaming, {
      type: 'analysisReady',
      scene: {
        answerText: 'Teil fertig',
        mode: 'describe',
        sceneToken: 'token',
      },
    });

    expect(ready.requestStatus).toBe('ready');
    expect(ready.streamedText).toBe('Teil fertig');
  });
});
