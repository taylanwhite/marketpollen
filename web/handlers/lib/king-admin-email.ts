/** The only account that can grant or remove organization admin. */
export const KING_ADMIN_EMAIL = 'taylanwhite@gmail.com';

export function isKingAdminEmail(email?: string | null): boolean {
  return (email || '').trim().toLowerCase() === KING_ADMIN_EMAIL;
}
