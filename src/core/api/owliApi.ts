import { MockOwliApi } from '@/core/api/mockOwliApi';
import { RemoteOwliApi } from '@/core/api/remoteOwliApi';
import type { RuntimeConfig } from '@/core/config/runtimeConfig';
import { getOrCreateInstallationId } from '@/core/identity/installationId';
import type { OwliApi } from '@/core/types';

type ActiveRuntimeConfig = Exclude<RuntimeConfig, { mode: 'invalid_configuration' }>;

export function createOwliApi(config: ActiveRuntimeConfig): OwliApi {
  if (config.mode === 'mock') return new MockOwliApi();
  return new RemoteOwliApi(config, getOrCreateInstallationId());
}
