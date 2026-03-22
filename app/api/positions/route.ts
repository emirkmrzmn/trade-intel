import { redis } from '@/app/lib/redis';
import { checkAuth } from '@/app/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

const VALID_PRODUCTS = ['FCPO', 'ZC', 'ZS', 'ZL', 'ZM', 'ZW', 'NG', 'HO', 'RB', 'KC', 'SB', 'CC', 'CT', 'HE', 'GF', 'LE'];

interface Position {
  instrument: string;
  direction: string;
  qty: string;
  entry: string;
  pnl: string;
}

interface ProductData {
  positions: Position[];
  [key: string]: unknown;
}

export async function POST(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;
  try {
    const { action, product: rawProduct, position, index } = await req.json();

    if (!rawProduct) {
      return NextResponse.json({ ok: false, error: 'Missing "product" field.' }, { status: 400 });
    }

    const product = rawProduct.toUpperCase();
    if (!VALID_PRODUCTS.includes(product)) {
      return NextResponse.json(
        { ok: false, error: `Unknown product: "${product}".` },
        { status: 400 }
      );
    }

    const key = `product:${product}`;
    const existing = (await redis.get<ProductData>(key)) || { positions: [] };
    const positions: Position[] = existing.positions || [];

    if (action === 'add') {
      if (!position || !position.instrument) {
        return NextResponse.json({ ok: false, error: 'Missing position data.' }, { status: 400 });
      }
      positions.push({
        instrument: position.instrument,
        direction: position.direction || 'Long',
        qty: position.qty || '1',
        entry: position.entry || '',
        pnl: position.pnl || '--',
      });
    } else if (action === 'remove') {
      if (index === undefined || index < 0 || index >= positions.length) {
        return NextResponse.json({ ok: false, error: 'Invalid position index.' }, { status: 400 });
      }
      positions.splice(index, 1);
    } else {
      return NextResponse.json({ ok: false, error: 'Invalid action. Use "add" or "remove".' }, { status: 400 });
    }

    existing.positions = positions;
    const now = new Date();
    existing.lastUpdated = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
    await redis.set(key, existing);

    return NextResponse.json({ ok: true, product, positions, updatedAt: now.toISOString() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
