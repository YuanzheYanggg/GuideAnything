export type UserRole = 'AUTHOR' | 'EDITOR' | 'LEARNER';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface Session {
  token: string;
  user: AuthUser;
}

