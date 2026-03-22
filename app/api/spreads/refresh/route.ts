import { redis } from '@/app/lib/redis';
import { checkAuth } from '@/app/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  SPREAD_PRODUCTS,
  generateActiveContracts,
  computeCalendarSpreads,
  computeButterflies,
  type ProductSpreads,
  type AllSpreadsData,
} from '@/app/lib/contracts';
import { fetchPrices } from '@/app/lib/yahoo';

export async function POST(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  try {
    const now = new Date();

    // 1. Generate tickers for all products
    const productContracts: Record<string, ReturnType<typeof generateActiveContracts>> = {};
    const allTickers: string[] = [];

    for (const product of SPREAD_PRODUCTS) {
      const contracts = generateActiveContracts(product, now);
      productContracts[product] = contracts;
      for (const c of contracts) {
        if (!allTickers.includes(c.ticker)) {
          allTickers.push(c.ticker);
        }
      }
    }

    console.log(`[spreads/refresh] Fetching ${allTickers.length} tickers across ${SPREAD_PRODUCTS.length} products`);

    // 2. Fetch all prices in one go
    const prices = await fetchPrices(allTickers);
    const fetchedCount = Object.keys(prices).length;
    console.log(`[spreads/refresh] Got ${fetchedCount}/${allTickers.length} prices`);

    // 3. Compute spreads per product
    const fetchedAt = now.toISOString();
    const spreads: Record<string, ProductSpreads> = {};

    for (const product of SPREAD_PRODUCTS) {
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
      productCount: SPREAD_PRODUCTS.length,
      tickerCount: allTickers.length,
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
