/**
 * Fetch FCPO contract prices from Bursa Malaysia's public API.
 * Returns a map of contract label (e.g. "Apr26") -> settlement price.
 */

const BURSA_API = 'https://www.bursamalaysia.com/api/v1/derivatives_prices/derivatives_prices';

const MONTH_MAP: Record<string, string> = {
  Jan: 'Jan', Feb: 'Feb', Mar: 'Mar', Apr: 'Apr', May: 'May', Jun: 'Jun',
  Jul: 'Jul', Aug: 'Aug', Sep: 'Sep', Oct: 'Oct', Nov: 'Nov', Dec: 'Dec',
};

interface BursaRow {
  contract: string;
  expiry: string;     // e.g. "Apr 2026"
  settlement: number;
  lastDone: number;
}

function parsePrice(s: string): number | null {
  if (!s || s === '-') return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}

/**
 * Fetch all FCPO contract month prices from Bursa Malaysia.
 * Returns a map keyed by display label (e.g. "Apr26") -> price (settlement or last done).
 */
export async function fetchFCPOPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  try {
    const url = `${BURSA_API}?code=FCPO&ses=day&per_page=100&page=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      console.error(`[bursa] HTTP ${res.status}`);
      return prices;
    }

    const json = await res.json() as {
      data?: Array<Array<string | number>>;
    };

    if (!json.data?.length) {
      console.error('[bursa] No data returned');
      return prices;
    }

    // Each row: [index, contract_html, expiry, open, bid, ask, lastDone, change, high, low, volume, openInterest, settlement]
    for (const row of json.data) {
      if (!Array.isArray(row) || row.length < 13) continue;

      const contract = stripHtml(String(row[1]));
      if (contract !== 'FCPO') continue;

      const expiry = String(row[2]).trim(); // e.g. "Apr 2026"
      const settlement = parsePrice(String(row[12]));
      const lastDone = parsePrice(String(row[6]));

      // Use settlement if available, otherwise last done
      const price = settlement ?? lastDone;
      if (price === null) continue;

      // Parse expiry "Apr 2026" -> "Apr26"
      const parts = expiry.split(' ');
      if (parts.length !== 2) continue;
      const monthStr = parts[0];
      const yearStr = parts[1].slice(-2); // "2026" -> "26"

      if (!MONTH_MAP[monthStr]) continue;

      const label = `${monthStr}${yearStr}`;
      prices[label] = price;
    }

    console.log(`[bursa] Fetched ${Object.keys(prices).length} FCPO contract prices`);
  } catch (err) {
    console.error('[bursa] Error:', err instanceof Error ? err.message : err);
  }

  return prices;
}
