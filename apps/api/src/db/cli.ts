import { rmSync } from 'node:fs';

import { loadConfig } from '../config';
import { createDatabase } from './client';
import { migrateDatabase } from './migrate';
import { seedDatabase } from './seed';
import { upgradeWorkspaceV1 } from './workspace-upgrade';

const command = process.argv[2] ?? 'migrate';
const config = loadConfig();

if (command === 'reset') {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${config.databasePath}${suffix}`, { force: true });
}

const database = createDatabase(config.databasePath);
try {
  migrateDatabase(database);
  upgradeWorkspaceV1(database);
  if (command === 'seed' || command === 'reset') await seedDatabase(database);
  const counts = database.prepare(
    `SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM guides) AS guides,
      (SELECT COUNT(*) FROM guide_versions) AS versions`,
  ).get();
  process.stdout.write(`GuideAnything database ${command} complete: ${JSON.stringify(counts)}\n`);
} finally {
  database.close();
}
