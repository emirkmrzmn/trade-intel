import { redis } from '@/app/lib/redis';
import { checkAuth } from '@/app/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

const VALID_PRODUCTS = ['FCPO', 'ZC', 'ZS', 'ZL', 'ZM', 'ZW', 'NG', 'HO', 'RB', 'KC', 'SB', 'CC', 'CT', 'HE', 'GF', 'LE'];
const MERGE_FIELDS = ['regime', 'regimeType', 'percentiles', 'outlook', 'ideas', 'dates', 'positions', 'risks', 'spreadPercentiles'] as const;

function defaultProduct() {
  return {
    regime: null,
    regimeType: 'neutral',
    percentiles: [],
    outlook: [],
    ideas: [],
    dates: [],
    positions: [],
    risks: [],
    spreadPercentiles: null,
    lastUpdated: null,
  };
}

export async function POST(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;
  try {
    const payload = await req.json();

    if (!payload.product) {
      return NextResponse.json({ ok: false, error: 'Missing "product" field.' }, { status: 400 });
    }

    const product = payload.product.toUpperCase();
    if (!VALID_PRODUCTS.includes(product)) {
      return NextResponse.json(
        { ok: false, error: `Unknown product: "${product}". Valid: ${VALID_PRODUCTS.join(', ')}` },
        { status: 400 }
      );
    }

    const key = `product:${product}`;
    const existing = (await redis.get<Record<string, unknown>>(key)) || defaultProduct();

    for (const field of MERGE_FIELDS) {
      if (payload[field] !== undefined) {
        (existing as Record<string, unknown>)[field] = payload[field];
      }
    }

    const now = new Date();
    (existing as Record<string, unknown>).lastUpdated = now.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });

    await redis.set(key, existing);

    return NextResponse.json({ ok: true, product, updatedAt: now.toISOString() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
