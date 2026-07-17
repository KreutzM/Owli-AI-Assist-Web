import { MockOwliApi } from '@/core/api/mockOwliApi';
import { RemoteAssistClient } from '@/core/api/remoteAssistClient';
import { readRuntimeConfig, type RuntimeConfigurationErrorCode } from '@/core/config/runtimeConfig';

export type AppRuntime =
  | { mode: 'mock'; api: MockOwliApi; defaultLocale: string }
  | {
      mode: 'remote';
      target: 'staging' | 'production';
      assistClient: RemoteAssistClient;
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
    assistClient: new RemoteAssistClient(config),
    defaultLocale: config.defaultLocale,
  };
}
