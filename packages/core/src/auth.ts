/**
 * Auth types shared between @partnerscope/api and @partnerscope/web.
 *
 * Kept small on purpose — the API is the source of truth for what the JWT
 * actually carries. Web code only reads the pre-parsed `AuthUser` returned
 * by /v1/auth/login and /v1/auth/me.
 */

export type UserRole = 'viewer' | 'admin' | 'analyst' | 'qa';

/** Claims carried inside the JWT. */
export interface JWTPayload {
  sub: string; // user.id (UUID)
  org: string; // organization.id (UUID)
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

/** Public-facing user shape returned by auth endpoints. Never includes hashes. */
export interface AuthUser {
  id: string;
  organizationId: string | null;
  email: string;
  fullName: string | null;
  role: UserRole;
  /**
   * Platform-staff flag. True when the user's email is in the server's
   * STAFF_EMAILS allowlist. Optional so older cached blobs (in localStorage)
   * don't fail type checks; consumers should treat `undefined` as false.
   */
  isStaff?: boolean;
}

/** Wire format for /v1/auth/login and /v1/auth/register success. */
export interface AuthSuccessResponse {
  token: string;
  user: AuthUser;
}
