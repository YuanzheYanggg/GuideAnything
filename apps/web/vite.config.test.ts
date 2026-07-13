import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { findProjectRoot, resolveApiTarget } from './vite.config';

describe('Vite API proxy configuration', () => {
  const directories: string[] = [];
  afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

  it('reads API_PORT from the repository env directory', () => {
    const envDir = mkdtempSync(join(tmpdir(), 'guideanything-env-'));
    directories.push(envDir);
    writeFileSync(join(envDir, '.env'), 'API_PORT=3002\n');
    expect(resolveApiTarget('development', envDir, {})).toBe('http://127.0.0.1:3002');
  });

  it('finds the repository env directory from the web package cwd', () => {
    expect(findProjectRoot(process.cwd())).toBe(resolve(process.cwd(), '../..'));
  });

  it('prefers process VITE_API_TARGET over file values', () => {
    const envDir = mkdtempSync(join(tmpdir(), 'guideanything-env-'));
    directories.push(envDir);
    writeFileSync(join(envDir, '.env'), 'VITE_API_TARGET=http://127.0.0.1:4000\nAPI_PORT=4001\n');
    expect(resolveApiTarget('development', envDir, {
      VITE_API_TARGET: 'http://127.0.0.1:5000', API_PORT: '5001',
    })).toBe('http://127.0.0.1:5000');
  });
});
