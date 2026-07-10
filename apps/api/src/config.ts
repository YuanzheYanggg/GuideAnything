import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));

export interface AppConfig {
  port: number;
  webOrigin: string;
  databasePath: string;
  uploadDir: string;
  jwtSecret: string;
  seedDemo: boolean;
}

export function loadConfig(): AppConfig {
  const envPath = resolve(projectRoot, '.env');
  if (existsSync(envPath)) loadEnvFile(envPath);
  const port = Number(process.env.API_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('API_PORT must be a valid TCP port');
  return {
    port,
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    databasePath: resolve(projectRoot, process.env.DATABASE_PATH ?? 'data/guideanything.sqlite'),
    uploadDir: resolve(projectRoot, process.env.UPLOAD_DIR ?? 'data/uploads'),
    jwtSecret: process.env.JWT_SECRET ?? 'guideanything-local-development-secret-change-me',
    seedDemo: process.env.SEED_DEMO !== 'false',
  };
}

