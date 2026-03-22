import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

export function checkAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return null; // no password configured = open access

  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null; // authorized
}
