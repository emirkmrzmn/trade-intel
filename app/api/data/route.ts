import { redis } from '@/app/lib/redis';
import { NextResponse } from 'next/server';

const PRODUCTS = ['FCPO', 'ZC', 'ZS', 'ZL', 'ZM', 'ZW', 'NG', 'HO', 'RB', 'KC', 'SB', 'CC', 'CT', 'HE', 'GF', 'LE'];

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
    lastUpdated: null,
  };
}

export async function GET() {
  const products: Record<string, unknown> = {};

  const keys = PRODUCTS.map((p) => `product:${p}`);
  const values = await redis.mget(...keys);

  PRODUCTS.forEach((p, i) => {
    products[p] = values[i] || defaultProduct();
  });

  return NextResponse.json({ products });
}
