import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const expected = process.env.DASHBOARD_PASSWORD;

    if (!expected) {
      return NextResponse.json({ ok: true });
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const a = Buffer.from(password);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
