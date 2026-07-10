import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import type { UserRole } from '@guideanything/contracts';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const DUMMY_HASH = `scrypt:${'00'.repeat(16)}:${'00'.repeat(KEY_LENGTH)}`;

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8 || password.length > 128) {
    throw new Error('password must contain between 8 and 128 characters');
  }
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltHex, keyHex] = encoded.split(':');
  if (algorithm !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH) as Buffer;
  return timingSafeEqual(actual, expected);
}

export async function authenticate(
  database: DatabaseSync,
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const row = database.prepare(
    `SELECT id, email, password_hash, display_name, role
     FROM users WHERE email = ? COLLATE NOCASE`,
  ).get(email.trim()) as unknown as UserRow | undefined;
  const valid = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !valid) return null;
  return toAuthenticatedUser(row);
}

export function findUserById(database: DatabaseSync, id: string): AuthenticatedUser | null {
  const row = database.prepare(
    `SELECT id, email, password_hash, display_name, role FROM users WHERE id = ?`,
  ).get(id) as unknown as UserRow | undefined;
  return row ? toAuthenticatedUser(row) : null;
}

function toAuthenticatedUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

