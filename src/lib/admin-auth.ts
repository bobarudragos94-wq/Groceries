import type { NextRequest } from 'next/server';

/** Gardă simplă pentru panoul de admin: antetul x-admin-password. */
export function isAdmin(req: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD || 'admin';
  return req.headers.get('x-admin-password') === expected;
}
