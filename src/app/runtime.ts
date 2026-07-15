import { MockOwliApi } from '@/core/api/mockOwliApi';
import { RemoteCatalogClient } from '@/core/api/remoteCatalogClient';
import { readRuntimeConfig, type RuntimeConfigurationErrorCode } from '@/core/config/runtimeConfig';

export type AppRuntime =
  | { mode: 'mock'; api: MockOwliApi; defaultLocale: string }
  | {
      mode: 'remote';
      target: 'staging' | 'production';
      catalogClient: RemoteCatalogClient;
      defaultLocale: string;
    }
  | { mode: 'invalid_configuration'; reason: RuntimeConfigurationErrorCode };

export function createAppRuntime(env: ImportMetaEnv = import.meta.env): AppRuntime {
  const config = readRuntimeConfig(env);
  if (config.mode === 'invalid_configuration') return config;
  if (config.mode === 'mock') {
    return { mode: 'mock', api: new MockOwliApi(), defaultLocale: config.defaultLocale };
  }
  return {
    mode: 'remote',
    target: config.target,
    catalogClient: new RemoteCatalogClient(config),
    defaultLocale: config.defaultLocale,
  };
}
