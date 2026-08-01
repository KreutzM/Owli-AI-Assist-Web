import { describe, expect, it } from 'vitest';
import { readAppRoute } from '@/app/appRoute';

describe('app route selection', () => {
  it('keeps the main application on the root route', () => {
    expect(readAppRoute('/')).toEqual({ kind: 'main' });
    expect(readAppRoute('/remote')).toEqual({ kind: 'main' });
  });

  it('matches the isolated media recorder lab path exactly', () => {
    expect(readAppRoute('/lab/mediarecorder-prototype')).toEqual({
      kind: 'mediarecorder-lab',
      pathname: '/lab/mediarecorder-prototype',
    });
    expect(readAppRoute('/lab/mediarecorder-prototype/')).toEqual({
      kind: 'mediarecorder-lab',
      pathname: '/lab/mediarecorder-prototype',
    });
  });
});
