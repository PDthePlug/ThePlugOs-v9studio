import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDomain } from '../commands/create';
import { certifyDomain } from '../commands/certify';
import * as fs from 'fs';
import * as path from 'path';

describe('CLI Commands', () => {
  const testDir = 'test-domain';

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should scaffold a new domain', () => {
    createDomain(testDir);
    expect(fs.existsSync(testDir)).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'plugos-manifest.json'))).toBe(true);
  });

  it('should pass certification for a valid domain', () => {
    createDomain(testDir);
    
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    certifyDomain(testDir);
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CERTIFIED'));
    consoleSpy.mockRestore();
  });
});
