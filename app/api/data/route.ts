import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

const PRODUCTS = ['FCPO', 'NG', 'ZM', 'ZL', 'HE', 'GF', 'LE', 'ZC', 'ZS', 'ZW'];

function defaultProduct() {
  return {
    regime: null,
    regimeType: 'neutral',
    percentiles: [],
    outlook: [],
    ideas: [],
    dates: [],
    positions: [],
    lastUpdated: null,
  };
}

export async function GET() {
  const products: Record<string, unknown> = {};

  const keys = PRODUCTS.map((p) => `product:${p}`);
  const values = await kv.mget(...keys);

  PRODUCTS.forEach((p, i) => {
    products[p] = values[i] || defaultProduct();
  });

  return NextResponse.json({ products });
}
