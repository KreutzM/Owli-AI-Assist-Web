import { describe, expect, it } from 'vitest';
import { webBootstrapResponseV2Schema } from '@/core/api/remoteCatalogContracts';

const valid = {
  sessionToken: 'token',
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  featureFlags: { sceneDescribe: false, followup: false },
  bootstrapInfo: {
    environment: 'staging',
    sessionTtlSeconds: 120,
    sessionSchemaVersion: 2,
    platform: 'web',
    trust: {
      kind: 'browser_public_client',
      status: 'unattested_public_client',
      enforced: false,
      note: 'public browser client',
    },
  },
};

describe('Web bootstrap v2 contract', () => {
  it('requires sceneDescribe and followup boolean flags', () => {
    expect(
      webBootstrapResponseV2Schema.safeParse({ ...valid, featureFlags: { followup: false } }).success,
    ).toBe(false);
    expect(
      webBootstrapResponseV2Schema.safeParse({ ...valid, featureFlags: { sceneDescribe: false } })
        .success,
    ).toBe(false);
  });

  it('accepts boolean future flags and rejects non-boolean values', () => {
    expect(
      webBootstrapResponseV2Schema.safeParse({
        ...valid,
        featureFlags: { ...valid.featureFlags, future: true },
      }).success,
    ).toBe(true);
    expect(
      webBootstrapResponseV2Schema.safeParse({
        ...valid,
        featureFlags: { ...valid.featureFlags, future: 'yes' },
      }).success,
    ).toBe(false);
  });

  it('rejects Web attestation and Android trust values', () => {
    expect(
      webBootstrapResponseV2Schema.safeParse({
        ...valid,
        bootstrapInfo: { ...valid.bootstrapInfo, attestation: {} },
      }).success,
    ).toBe(false);
    expect(
      webBootstrapResponseV2Schema.safeParse({
        ...valid,
        bootstrapInfo: { ...valid.bootstrapInfo, platform: 'android' },
      }).success,
    ).toBe(false);
  });
});
