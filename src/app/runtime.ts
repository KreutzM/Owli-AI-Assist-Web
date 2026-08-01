import { MockOwliApi } from '@/core/api/mockOwliApi';
import { RemoteAssistClient } from '@/core/api/remoteAssistClient';
import { readRuntimeConfig, type RuntimeConfigurationErrorCode } from '@/core/config/runtimeConfig';

export type AppRuntime =
  | {
      mode: 'mock';
      api: MockOwliApi;
      defaultLocale: string;
      prototype: { mediaRecorderLabEnabled: boolean };
    }
  | {
      mode: 'remote';
      target: 'staging' | 'production';
      assistClient: RemoteAssistClient;
      defaultLocale: string;
      prototype: { mediaRecorderLabEnabled: boolean };
    }
  | {
      mode: 'invalid_configuration';
      reason: RuntimeConfigurationErrorCode;
      prototype: { mediaRecorderLabEnabled: boolean };
    };

export function createAppRuntime(env: ImportMetaEnv = import.meta.env): AppRuntime {
  const config = readRuntimeConfig(env);
  const prototype = config.prototype ?? { mediaRecorderLabEnabled: false };
  if (config.mode === 'invalid_configuration') {
    return { ...config, prototype };
  }
  if (config.mode === 'mock') {
    return {
      mode: 'mock',
      api: new MockOwliApi(),
      defaultLocale: config.defaultLocale,
      prototype,
    };
  }
  return {
    mode: 'remote',
    target: config.target,
    assistClient: new RemoteAssistClient(config),
    defaultLocale: config.defaultLocale,
    prototype,
  };
}
