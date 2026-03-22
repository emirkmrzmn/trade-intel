/**
 * Fetch FCPO contract prices from TradingView's scanner API.
 * Bursa Malaysia's site is behind Cloudflare protection, so we use
 * TradingView which has all FCPO contract months available.
 * Returns a map of contract label (e.g. "Apr26") -> close price.
 */

const TV_SCANNER_URL = 'https://scanner.tradingview.com/futures/scan';

const MONTH_CODE_TO_NAME: Record<string, string> = {
  F: 'Jan', G: 'Feb', H: 'Mar', J: 'Apr', K: 'May', M: 'Jun',
  N: 'Jul', Q: 'Aug', U: 'Sep', V: 'Oct', X: 'Nov', Z: 'Dec',
};

interface TVScanResult {
  data: Array<{
    s: string;  // e.g. "MYX:FCPOK2026"
    d: [number, string]; // [close_price, description]
  }>;
}

/**
 * Fetch all FCPO contract month prices from TradingView.
 * Returns a map keyed by display label (e.g. "Apr26") -> price.
 */
export async function fetchFCPOPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  try {
    const res = await fetch(TV_SCANNER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        columns: ['close', 'description'],
        filter: [{ left: 'name', operation: 'match', right: 'FCPO' }],
        options: { lang: 'en' },
        range: [0, 50],
        sort: { sortBy: 'name', sortOrder: 'asc' },
      }),
    });

    if (!res.ok) {
      console.error(`[fcpo] TradingView HTTP ${res.status}`);
      return prices;
    }

    const json = await res.json() as TVScanResult;

    if (!json.data?.length) {
      console.error('[fcpo] No data returned from TradingView');
      return prices;
    }

    for (const row of json.data) {
      const symbol = row.s; // e.g. "MYX:FCPOK2026"
      const closePrice = row.d[0];

      if (!symbol || typeof closePrice !== 'number') continue;

      // Skip continuous contracts (FCPO1!, FCPO2!, etc.)
      if (symbol.includes('!')) continue;

      // Parse "MYX:FCPOK2026" -> month code "K", year "2026"
      const match = symbol.match(/FCPO([A-Z])(\d{4})$/);
      if (!match) continue;

      const monthCode = match[1];
      const year = match[2];
      const monthName = MONTH_CODE_TO_NAME[monthCode];
      if (!monthName) continue;

      const yy = year.slice(-2); // "2026" -> "26"
      const label = `${monthName}${yy}`;
      prices[label] = closePrice;
    }

    console.log(`[fcpo] Fetched ${Object.keys(prices).length} FCPO contract prices from TradingView`);
  } catch (err) {
    console.error('[fcpo] Error:', err instanceof Error ? err.message : err);
  }

  return prices;
}
