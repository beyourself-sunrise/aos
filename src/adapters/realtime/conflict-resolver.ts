/**
 * CrossDeviceConflictResolver — detects and resolves cross-device conflicts.
 *
 * Tracks the last known version for each device per thread.
 * When a device writes, it checks if another device has a newer version.
 *
 * P0 strategy: last-write-wins (simplest).
 * P1+ can add merge strategies or UI prompts.
 */

import type { DeviceConflict, ConflictResolverInterface } from '../../interfaces/realtime';

export class CrossDeviceConflictResolver implements ConflictResolverInterface {
  // threadId → Map<deviceId, version>
  private deviceVersions: Map<string, Map<string, number>> = new Map();

  recordDeviceVersion(threadId: string, deviceId: string, version: number): void {
    if (!this.deviceVersions.has(threadId)) {
      this.deviceVersions.set(threadId, new Map());
    }
    this.deviceVersions.get(threadId)!.set(deviceId, version);
  }

  detectConflict(threadId: string, deviceId: string, newVersion: number): DeviceConflict | null {
    const deviceMap = this.deviceVersions.get(threadId);
    if (!deviceMap) return null;

    // Check if any other device has a newer version
    for (const [otherDeviceId, otherVersion] of deviceMap.entries()) {
      if (otherDeviceId === deviceId) continue;
      if (otherVersion > newVersion) {
        return {
          threadId,
          deviceA: deviceId,
          deviceB: otherDeviceId,
          versionA: newVersion,
          versionB: otherVersion,
          timestamp: Date.now(),
        };
      }
    }
    return null;
  }

  resolveConflict(_conflict: DeviceConflict): 'retry' | 'last-write-wins' | 'merge' {
    // P0: last-write-wins (simplest strategy)
    // P1+: could add merge or UI prompt
    return 'last-write-wins';
  }
}
