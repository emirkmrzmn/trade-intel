const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 500;
const YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get a crumb + cookie pair from Yahoo Finance for authenticated API access.
 * Yahoo requires this for v7/v8 endpoints.
 */
async function getCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  try {
    // Step 1: Get cookie from Yahoo Finance
    const initRes = await fetch('https://fc.yahoo.com', { redirect: 'manual' });
    const setCookie = initRes.headers.get('set-cookie');
    const cookie = setCookie?.split(';')[0] || '';

    // Step 2: Get crumb using cookie
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' },
    });
    const crumb = await crumbRes.text();

    if (crumb && cookie && !crumb.includes('<!')) {
      return { crumb, cookie };
    }
    return null;
  } catch (err) {
    console.error('[yahoo] Failed to get crumb:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fetch current prices for a list of Yahoo Finance tickers.
 * Uses Yahoo v7 quote API with crumb authentication.
 * Returns a map of ticker -> price. Missing/failed tickers are omitted.
 */
export async function fetchPrices(tickers: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  const auth = await getCrumb();
  if (!auth) {
    console.error('[yahoo] Could not authenticate with Yahoo Finance');
    return prices;
  }

  // Split into batches
  const batches: string[][] = [];
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    batches.push(tickers.slice(i, i + BATCH_SIZE));
  }

  for (let b = 0; b < batches.length; b++) {
    try {
      const symbols = batches[b].join(',');
      const url = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(auth.crumb)}`;
      const res = await fetch(url, {
        headers: {
          Cookie: auth.cookie,
          'User-Agent': 'Mozilla/5.0',
        },
      });

      if (!res.ok) {
        console.error(`[yahoo] Batch ${b + 1}/${batches.length} HTTP ${res.status}`);
        continue;
      }

      const json = await res.json() as {
        quoteResponse?: {
          result?: Array<{ symbol?: string; regularMarketPrice?: number; bid?: number; ask?: number }>;
        };
      };

      const results = json?.quoteResponse?.result || [];
      for (const q of results) {
        if (!q.symbol) continue;
        // Prefer mid-price (bid+ask)/2 for accuracy on illiquid back months.
        // Fall back to LTP if bid/ask unavailable.
        const hasBidAsk = typeof q.bid === 'number' && typeof q.ask === 'number' && q.bid > 0 && q.ask > 0;
        if (hasBidAsk) {
          prices[q.symbol] = Math.floor((q.bid! + q.ask!) / 2 * 100) / 100; // round down to 2dp
        } else if (typeof q.regularMarketPrice === 'number') {
          prices[q.symbol] = q.regularMarketPrice;
        }
      }
    } catch (err) {
      console.error(`[yahoo] Batch ${b + 1}/${batches.length} failed:`, err instanceof Error ? err.message : err);
    }

    if (b < batches.length - 1) {
      await delay(BATCH_DELAY_MS);
    }
  }

  return prices;
}
