import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { migrateDatabase } from './db/migrate';
import { seedDatabase } from './db/seed';

const config = loadConfig();
const database = createDatabase(config.databasePath);
migrateDatabase(database);
if (config.seedDemo) await seedDatabase(database);

const app = await buildApp({
  database,
  jwtSecret: config.jwtSecret,
  webOrigin: config.webOrigin,
  logger: true,
});

const close = async () => {
  await app.close();
  database.close();
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

await app.listen({ host: '127.0.0.1', port: config.port });

