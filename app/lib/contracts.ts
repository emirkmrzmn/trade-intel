// Contract configuration, ticker generation, and spread computation for futures products

export const MONTH_CODES: Record<string, number> = {
  F: 1, G: 2, H: 3, J: 4, K: 5, M: 6,
  N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12,
};

export const MONTH_CODE_FROM_NUM: Record<number, string> = Object.fromEntries(
  Object.entries(MONTH_CODES).map(([k, v]) => [v, k])
);

export const MONTH_NAMES: Record<string, string> = {
  F: 'Jan', G: 'Feb', H: 'Mar', J: 'Apr', K: 'May', M: 'Jun',
  N: 'Jul', Q: 'Aug', U: 'Sep', V: 'Oct', X: 'Nov', Z: 'Dec',
};

export const EXCHANGE_MAP: Record<string, string> = {
  ZC: '.CBT', ZS: '.CBT', ZL: '.CBT', ZM: '.CBT', ZW: '.CBT',
  NG: '.NYM', HO: '.NYM', RB: '.NYM',
  GF: '.CME', LE: '.CME', HE: '.CME', ES: '.CME', NQ: '.CME',
  KC: '.NYB', SB: '.NYB', CC: '.NYB', CT: '.NYB',
};

export const ACTIVE_MONTHS: Record<string, string[]> = {
  ZC: ['H', 'K', 'N', 'U', 'Z'],
  ZS: ['F', 'H', 'K', 'N', 'Q', 'U', 'X'],
  ZL: ['F', 'H', 'K', 'N', 'Q', 'U', 'V', 'Z'],
  ZM: ['F', 'H', 'K', 'N', 'Q', 'U', 'V', 'Z'],
  ZW: ['H', 'K', 'N', 'U', 'Z'],
  NG: ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'],
  HO: ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'],
  RB: ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'],
  GF: ['F', 'H', 'J', 'K', 'Q', 'U', 'V', 'X'],
  LE: ['G', 'J', 'M', 'Q', 'V', 'Z'],
  HE: ['G', 'J', 'K', 'M', 'N', 'Q', 'V', 'Z'],
  KC: ['H', 'K', 'N', 'U', 'Z'],
  SB: ['H', 'K', 'N', 'V'],
  CC: ['H', 'K', 'N', 'U', 'Z'],
  CT: ['H', 'K', 'N', 'V', 'Z'],
  ES: ['H', 'M', 'U', 'Z'],
  NQ: ['H', 'M', 'U', 'Z'],
};

// FCPO active months (all 12 months, traded on Bursa Malaysia)
export const FCPO_MONTHS = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];

// Products that use Yahoo Finance for spreads
export const YAHOO_SPREAD_PRODUCTS = Object.keys(ACTIVE_MONTHS);

// All products including FCPO
export const ALL_SPREAD_PRODUCTS = [...YAHOO_SPREAD_PRODUCTS, 'FCPO'];

export interface ContractInfo {
  ticker: string;       // e.g. "ZMK26.CBT"
  monthCode: string;    // e.g. "K"
  monthName: string;    // e.g. "May"
  year: number;         // e.g. 2026
  displayLabel: string; // e.g. "May26"
}

export interface SpreadResult {
  name: string;
  value: number | null;
  legs: string[];       // ticker symbols
}

export interface ProductSpreads {
  product: string;
  calendars: SpreadResult[];
  butterflies: SpreadResult[];
  contracts: { ticker: string; label: string; price: number | null }[];
  fetchedAt: string;
}

export interface AllSpreadsData {
  fetchedAt: string;
  spreads: Record<string, ProductSpreads>;
}

/**
 * Generate the next ~14 active contract months for a product starting from referenceDate.
 * Uses "next month" as the cutoff — current month's contracts are typically expiring/in delivery.
 * If a contract has already expired, Yahoo Finance will return no price and the spread shows "--".
 * Returns contracts sorted chronologically.
 */
export function generateActiveContracts(product: string, referenceDate: Date): ContractInfo[] {
  const months = ACTIVE_MONTHS[product];
  const exchange = EXCHANGE_MAP[product];
  if (!months || !exchange) return [];

  // Start from NEXT month (current month contracts are usually expiring)
  // But if we're in the first half of the month, include current month too
  const day = referenceDate.getDate();
  const rawMonth = referenceDate.getMonth() + 1; // 1-12
  const startFromMonth = day >= 15 ? rawMonth + 1 : rawMonth;
  const currentYear = referenceDate.getFullYear();
  const contracts: ContractInfo[] = [];

  let year = startFromMonth > 12 ? currentYear + 1 : currentYear;
  const effectiveMonth = startFromMonth > 12 ? 1 : startFromMonth;
  let startIdx = 0;

  // Find the first active month >= effectiveMonth in the starting year
  for (let i = 0; i < months.length; i++) {
    if (MONTH_CODES[months[i]] >= effectiveMonth) {
      startIdx = i;
      break;
    }
    // If all months in this year are past, start from first month next year
    if (i === months.length - 1) {
      startIdx = 0;
      year = year + 1;
    }
  }

  // Calculate the cutoff: 18 months from reference date to ensure full spread
  // coverage for products with sparse active months (e.g. ICE softs with 5/yr)
  const cutoffDate = new Date(referenceDate);
  cutoffDate.setMonth(cutoffDate.getMonth() + 18);
  const cutoffYear = cutoffDate.getFullYear();
  const cutoffMonth = cutoffDate.getMonth() + 1; // 1-12

  // Walk forward collecting contracts within the 1-year window
  let idx = startIdx;
  let y = year;
  while (true) {
    const code = months[idx];
    const monthNum = MONTH_CODES[code];
    // Stop if this contract is beyond the 1-year cutoff
    if (y > cutoffYear || (y === cutoffYear && monthNum > cutoffMonth)) break;

    const monthName = MONTH_NAMES[code];
    const yy = String(y).slice(-2);
    const ticker = `${product}${code}${yy}${exchange}`;

    contracts.push({
      ticker,
      monthCode: code,
      monthName,
      year: y,
      displayLabel: `${monthName}${yy}`,
    });

    idx++;
    if (idx >= months.length) {
      idx = 0;
      y++;
    }
  }

  return contracts;
}

/**
 * Compute calendar spreads from consecutive contract pairs.
 * Calendar spread = front month price - back month price
 */
export function computeCalendarSpreads(
  contracts: ContractInfo[],
  prices: Record<string, number>
): SpreadResult[] {
  const results: SpreadResult[] = [];

  for (let i = 0; i < contracts.length - 1; i++) {
    const front = contracts[i];
    const back = contracts[i + 1];
    const frontPrice = prices[front.ticker];
    const backPrice = prices[back.ticker];

    const hasBoth = frontPrice !== undefined && backPrice !== undefined;
    const value = hasBoth ? frontPrice - backPrice : null;

    // Format name: "May-Jul26" or "Dec26-Mar27" if crossing years
    const sameYear = front.year === back.year;
    const name = sameYear
      ? `${front.monthName}-${back.displayLabel}`
      : `${front.displayLabel}-${back.displayLabel}`;

    results.push({ name, value, legs: [front.ticker, back.ticker] });
  }

  return results;
}

/**
 * Compute butterfly spreads from consecutive contract triples.
 * Butterfly = first leg - 2 * middle + third leg
 */
export function computeButterflies(
  contracts: ContractInfo[],
  prices: Record<string, number>
): SpreadResult[] {
  const results: SpreadResult[] = [];

  for (let i = 0; i < contracts.length - 2; i++) {
    const c1 = contracts[i];
    const c2 = contracts[i + 1];
    const c3 = contracts[i + 2];
    const p1 = prices[c1.ticker];
    const p2 = prices[c2.ticker];
    const p3 = prices[c3.ticker];

    const hasAll = p1 !== undefined && p2 !== undefined && p3 !== undefined;
    const value = hasAll ? p1 - 2 * p2 + p3 : null;

    // Format: "May/Jul/Aug26" or with year if crossing
    const allSameYear = c1.year === c2.year && c2.year === c3.year;
    const name = allSameYear
      ? `${c1.monthName}/${c2.monthName}/${c3.displayLabel}`
      : `${c1.displayLabel}/${c2.displayLabel}/${c3.displayLabel}`;

    results.push({ name, value, legs: [c1.ticker, c2.ticker, c3.ticker] });
  }

  return results;
}

/**
 * Generate FCPO active contracts for the next 18 months.
 * FCPO trades all 12 months. Uses displayLabel (e.g. "Apr26") as ticker key
 * since prices come from Bursa Malaysia, not Yahoo Finance.
 */
export function generateFCPOContracts(referenceDate: Date): ContractInfo[] {
  const months = FCPO_MONTHS;
  const day = referenceDate.getDate();
  const rawMonth = referenceDate.getMonth() + 1;
  const startFromMonth = day >= 15 ? rawMonth + 1 : rawMonth;
  const currentYear = referenceDate.getFullYear();
  const contracts: ContractInfo[] = [];

  let year = startFromMonth > 12 ? currentYear + 1 : currentYear;
  const effectiveMonth = startFromMonth > 12 ? 1 : startFromMonth;
  let startIdx = 0;

  for (let i = 0; i < months.length; i++) {
    if (MONTH_CODES[months[i]] >= effectiveMonth) {
      startIdx = i;
      break;
    }
    if (i === months.length - 1) {
      startIdx = 0;
      year = year + 1;
    }
  }

  const cutoffDate = new Date(referenceDate);
  cutoffDate.setMonth(cutoffDate.getMonth() + 18);
  const cutoffYear = cutoffDate.getFullYear();
  const cutoffMonth = cutoffDate.getMonth() + 1;

  let idx = startIdx;
  let y = year;
  while (true) {
    const code = months[idx];
    const monthNum = MONTH_CODES[code];
    if (y > cutoffYear || (y === cutoffYear && monthNum > cutoffMonth)) break;

    const monthName = MONTH_NAMES[code];
    const yy = String(y).slice(-2);
    const label = `${monthName}${yy}`;

    contracts.push({
      ticker: label,  // For FCPO, ticker IS the label (used as price lookup key)
      monthCode: code,
      monthName,
      year: y,
      displayLabel: label,
    });

    idx++;
    if (idx >= months.length) {
      idx = 0;
      y++;
    }
  }

  return contracts;
}
