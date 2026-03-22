import { redis } from '@/app/lib/redis';
import { checkAuth } from '@/app/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import {
  YAHOO_SPREAD_PRODUCTS,
  ALL_SPREAD_PRODUCTS,
  generateActiveContracts,
  generateFCPOContracts,
  computeCalendarSpreads,
  computeButterflies,
  type ProductSpreads,
  type AllSpreadsData,
} from '@/app/lib/contracts';
import { fetchPrices } from '@/app/lib/yahoo';
import { fetchFCPOPrices } from '@/app/lib/bursa';

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

async function refreshSpreads() {
  try {
    const now = new Date();
    const productContracts: Record<string, ReturnType<typeof generateActiveContracts>> = {};
    const allTickers: string[] = [];

    for (const product of YAHOO_SPREAD_PRODUCTS) {
      const contracts = generateActiveContracts(product, now);
      productContracts[product] = contracts;
      for (const c of contracts) {
        if (!allTickers.includes(c.ticker)) allTickers.push(c.ticker);
      }
    }

    // FCPO contracts
    const fcpoContracts = generateFCPOContracts(now);
    productContracts['FCPO'] = fcpoContracts;

    // Fetch from both sources in parallel
    const [yahooPrices, fcpoPrices] = await Promise.all([
      fetchPrices(allTickers),
      fetchFCPOPrices(),
    ]);

    const prices: Record<string, number> = { ...yahooPrices, ...fcpoPrices };
    const fetchedAt = now.toISOString();
    const spreads: Record<string, ProductSpreads> = {};

    for (const product of ALL_SPREAD_PRODUCTS) {
      const contracts = productContracts[product];
      spreads[product] = {
        product,
        calendars: computeCalendarSpreads(contracts, prices),
        butterflies: computeButterflies(contracts, prices),
        contracts: contracts.map((c) => ({
          ticker: c.ticker,
          label: c.displayLabel,
          price: prices[c.ticker] ?? null,
        })),
        fetchedAt,
      };
    }

    const data: AllSpreadsData = { fetchedAt, spreads };
    await redis.set('spreads:all', JSON.stringify(data));
    await redis.expire('spreads:all', 86400);
    console.log(`[spreads] Background refresh complete: ${Object.keys(yahooPrices).length} Yahoo + ${Object.keys(fcpoPrices).length} Bursa prices`);
  } catch (err) {
    console.error('[spreads] Background refresh failed:', err);
  }
}

export async function GET(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  try {
    const raw = await redis.get('spreads:all');
    let data: AllSpreadsData | null = null;

    if (raw) {
      data = typeof raw === 'string' ? JSON.parse(raw) : (raw as AllSpreadsData);
    }

    const stale = !data || !data.fetchedAt ||
      (Date.now() - new Date(data.fetchedAt).getTime()) > STALE_THRESHOLD_MS;

    // Trigger background refresh if stale (non-blocking)
    if (stale) {
      after(refreshSpreads);
    }

    return NextResponse.json({
      spreads: data?.spreads ?? null,
      fetchedAt: data?.fetchedAt ?? null,
      stale,
    });
  } catch (err) {
    console.error('[spreads] GET error:', err);
    return NextResponse.json(
      { spreads: null, fetchedAt: null, stale: true, error: 'Failed to load spreads' },
      { status: 500 }
    );
  }
}
