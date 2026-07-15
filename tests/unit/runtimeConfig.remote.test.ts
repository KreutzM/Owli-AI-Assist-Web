import { describe, expect, it } from 'vitest';
import { readRuntimeConfig, STAGING_API_ROOT } from '@/core/config/runtimeConfig';

function env(values: Record<string, string | undefined>): ImportMetaEnv {
  return values as ImportMetaEnv;
}

describe('remote runtime configuration', () => {
  it('defaults to mock without validating a remote URL', () => {
    expect(readRuntimeConfig(env({ VITE_OWLI_API_BASE_URL: 'not a url' })).mode).toBe('mock');
  });

  it('requires the exact remote mode value', () => {
    expect(
      readRuntimeConfig(
        env({ VITE_OWLI_API_MODE: 'remtoe', VITE_OWLI_API_BASE_URL: STAGING_API_ROOT }),
      ),
    ).toEqual({ mode: 'invalid_configuration', reason: 'API_MODE_INVALID' });
  });

  it('accepts the exact staging root', () => {
    expect(
      readRuntimeConfig(
        env({ VITE_OWLI_API_MODE: 'remote', VITE_OWLI_API_BASE_URL: STAGING_API_ROOT }),
      ),
    ).toMatchObject({ mode: 'remote', target: 'staging' });
  });

  it.each(['', '1x', '0', '-1', '1.5', '   '])('rejects version code %j', (versionCode) => {
    expect(
      readRuntimeConfig(
        env({
          VITE_OWLI_API_MODE: 'remote',
          VITE_OWLI_API_BASE_URL: STAGING_API_ROOT,
          VITE_OWLI_VERSION_CODE: versionCode,
        }),
      ),
    ).toMatchObject({ mode: 'invalid_configuration', reason: 'VERSION_CODE_INVALID' });
  });

  it.each([
    'http://owli-ai-backend-staging.michael-kreutzer-77.workers.dev/',
    `${STAGING_API_ROOT}path`,
    `${STAGING_API_ROOT}?query=1`,
    'https://example.com/',
  ])('rejects unapproved or malformed roots', (baseUrl) => {
    expect(
      readRuntimeConfig(env({ VITE_OWLI_API_MODE: 'remote', VITE_OWLI_API_BASE_URL: baseUrl }))
        .mode,
    ).toBe('invalid_configuration');
  });
});
