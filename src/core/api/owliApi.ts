import { MockOwliApi } from '@/core/api/mockOwliApi';
import { RemoteOwliApi } from '@/core/api/remoteOwliApi';
import type { RuntimeConfig } from '@/core/config/runtimeConfig';
import { getOrCreateInstallationId } from '@/core/identity/installationId';
import type { OwliApi } from '@/core/types';

export function createOwliApi(config: RuntimeConfig): OwliApi {
  if (config.apiMode === 'mock') return new MockOwliApi();
  return new RemoteOwliApi(config, getOrCreateInstallationId());
}
