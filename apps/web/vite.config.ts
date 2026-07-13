import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export function findProjectRoot(cwd: string): string {
  if (existsSync(resolve(cwd, 'pnpm-workspace.yaml'))) return cwd;
  return resolve(cwd, '../..');
}

const projectRoot = findProjectRoot(process.cwd());

export function resolveApiTarget(
  mode: string,
  envDir: string,
  processEnv: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const fileEnv = loadEnv(mode, envDir, '');
  const explicitTarget = processEnv.VITE_API_TARGET || fileEnv.VITE_API_TARGET;
  if (explicitTarget) return explicitTarget;
  const port = processEnv.API_PORT || fileEnv.API_PORT || '3001';
  return `http://127.0.0.1:${port}`;
}

export default defineConfig(({ mode }) => {
  const apiTarget = resolveApiTarget(mode, projectRoot);
  return {
    envDir: projectRoot,
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: { '/api': apiTarget },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
    },
  };
});
