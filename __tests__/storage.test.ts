import { describe, expect, it } from 'vitest';
import { exportBackupJSON, getInitialState, importBackupJSON } from '@/lib/storage';

describe('backup validation', () => {
  it('rejects malformed backup files', () => {
    expect(() => importBackupJSON('{"state":{"profile":{}}}')).toThrow();
  });

  it('round-trips a valid app state without writing to storage during parsing', () => {
    const state = getInitialState();
    const restored = importBackupJSON(exportBackupJSON(state));
    expect(restored.profile.name).toBe(state.profile.name);
    expect(restored.classes).toHaveLength(state.classes.length);
  });
});
