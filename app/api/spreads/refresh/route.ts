import { redis } from '@/app/lib/redis';
import { checkAuth } from '@/app/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
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

export async function POST(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  try {
    const now = new Date();

    // 1. Generate tickers for Yahoo-based products
    const productContracts: Record<string, ReturnType<typeof generateActiveContracts>> = {};
    const allTickers: string[] = [];

    for (const product of YAHOO_SPREAD_PRODUCTS) {
      const contracts = generateActiveContracts(product, now);
      productContracts[product] = contracts;
      for (const c of contracts) {
        if (!allTickers.includes(c.ticker)) {
          allTickers.push(c.ticker);
        }
      }
    }

    // Generate FCPO contracts separately
    const fcpoContracts = generateFCPOContracts(now);
    productContracts['FCPO'] = fcpoContracts;

    console.log(`[spreads/refresh] Fetching ${allTickers.length} Yahoo tickers + FCPO from Bursa`);

    // 2. Fetch prices from both sources in parallel
    const [yahooPrices, fcpoPrices] = await Promise.all([
      fetchPrices(allTickers),
      fetchFCPOPrices(),
    ]);

    // Merge all prices into one map
    const prices: Record<string, number> = { ...yahooPrices, ...fcpoPrices };
    const fetchedCount = Object.keys(prices).length;
    console.log(`[spreads/refresh] Got ${Object.keys(yahooPrices).length} Yahoo + ${Object.keys(fcpoPrices).length} Bursa prices`);

    // 3. Compute spreads per product (including FCPO)
    const fetchedAt = now.toISOString();
    const spreads: Record<string, ProductSpreads> = {};

    for (const product of ALL_SPREAD_PRODUCTS) {
      const contracts = productContracts[product];
      const calendars = computeCalendarSpreads(contracts, prices);
      const butterflies = computeButterflies(contracts, prices);

      spreads[product] = {
        product,
        calendars,
        butterflies,
        contracts: contracts.map((c) => ({
          ticker: c.ticker,
          label: c.displayLabel,
          price: prices[c.ticker] ?? null,
        })),
        fetchedAt,
      };
    }

    // 4. Store in Redis
    const data: AllSpreadsData = { fetchedAt, spreads };
    await redis.set('spreads:all', JSON.stringify(data));
    await redis.expire('spreads:all', 86400); // 24h TTL safety net

    return NextResponse.json({
      ok: true,
      fetchedAt,
      productCount: ALL_SPREAD_PRODUCTS.length,
      tickerCount: allTickers.length + fcpoContracts.length,
      priceCount: fetchedCount,
    });
  } catch (err) {
    console.error('[spreads/refresh] Error:', err);
    return NextResponse.json(
      { error: 'Refresh failed', detail: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
