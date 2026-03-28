'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

function getStoredPassword() {
  try { return sessionStorage.getItem('dash_pw') || ''; } catch { return ''; }
}

function authHeaders(): Record<string, string> {
  const pw = getStoredPassword();
  return pw ? { 'Authorization': `Bearer ${pw}` } : {};
}

function authFetch(url: string, opts?: RequestInit): Promise<Response> {
  const headers = { ...authHeaders(), ...(opts?.headers || {}) };
  return fetch(url, { ...opts, headers });
}

export default function Dashboard() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = checking
  const [loginError, setLoginError] = useState('');
  const appRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    tab: string;
    modal: boolean;
    tradeModal: boolean;
    editingTrade: PlaybookTrade | null;
    overviewSub: 'playbook' | 'calendar';
    calMonth: number;
    calYear: number;
    pbFilter: { commodity: string; status: string; season: string; search: string };
    parseMsg: { ok: boolean; msg: string; product?: string } | null;
    data: DashboardData;
    spreads: Record<string, SpreadsProduct> | null;
    spreadsLoading: boolean;
    playbook: PlaybookTrade[];
  }>({
    tab: 'OVERVIEW',
    modal: false,
    tradeModal: false,
    editingTrade: null,
    overviewSub: 'playbook',
    calMonth: new Date().getMonth(),
    calYear: new Date().getFullYear(),
    pbFilter: { commodity: '', status: '', season: '', search: '' },
    parseMsg: null,
    data: buildDefault(),
    spreads: null,
    spreadsLoading: false,
    playbook: [],
  });

  // Expose stateRef for trade form submission
  useEffect(() => { (window as any).__stateRef = stateRef; }, []);

  // Check auth on mount
  useEffect(() => {
    const pw = getStoredPassword();
    if (!pw) { setAuthed(false); return; }
    authFetch('/api/data').then((r) => {
      if (r.ok) setAuthed(true);
      else { sessionStorage.removeItem('dash_pw'); setAuthed(false); }
    }).catch(() => setAuthed(false));
  }, []);

  const handleLogin = useCallback(async () => {
    const input = document.getElementById('login-pw') as HTMLInputElement | null;
    const pw = input?.value.trim();
    if (!pw) return;
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        sessionStorage.setItem('dash_pw', pw);
        setLoginError('');
        setAuthed(true);
      } else {
        setLoginError('Wrong password');
      }
    } catch {
      setLoginError('Connection error');
    }
  }, []);

  const render = useCallback(() => {
    if (!appRef.current) return;
    const { tab, modal, parseMsg, data } = stateRef.current;
    const tabs = PRODUCTS.map(
      (p) =>
        `<div class="tab${tab === p ? ' active' : ''}" data-tab="${p}">${PRODUCT_LABELS[p] || p}</div>`
    ).join('');
    const { spreads, spreadsLoading, playbook, overviewSub, calMonth, calYear, pbFilter, tradeModal, editingTrade } = stateRef.current;
    const content = tab === 'OVERVIEW' ? renderOverview(data, playbook, overviewSub, pbFilter, calMonth, calYear) : renderProduct(data, tab, spreads, spreadsLoading, playbook);
    const modalHTML = modal ? renderModal(parseMsg) : '';
    const tradeModalHTML = tradeModal ? renderTradeFormModal(editingTrade) : '';

    appRef.current.innerHTML = `
      <div class="header">
        <div class="header-left">
          <div class="logo">▸ TRADE INTEL</div>
          <div class="header-time" id="hdr-time"></div>
        </div>
        <button class="push-btn" id="push-btn">↑ PUSH UPDATE</button>
      </div>
      <div class="tab-bar">${tabs}</div>
      <div class="main">${content}</div>
      ${modalHTML}${tradeModalHTML}`;

    clockTick();

    // Bind events
    appRef.current.querySelectorAll('[data-tab]').forEach((el) => {
      el.addEventListener('click', () => {
        stateRef.current.tab = el.getAttribute('data-tab')!;
        stateRef.current.parseMsg = null;
        render();
      });
    });
    appRef.current.querySelectorAll('[data-switch]').forEach((el) => {
      el.addEventListener('click', () => {
        stateRef.current.tab = el.getAttribute('data-switch')!;
        stateRef.current.parseMsg = null;
        render();
      });
    });
    document.getElementById('push-btn')?.addEventListener('click', () => {
      stateRef.current.modal = true;
      stateRef.current.parseMsg = null;
      render();
      setTimeout(() => document.getElementById('push-input')?.focus(), 50);
    });
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
    document.querySelector('.modal-overlay')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('modal-overlay')) closeModal();
    });
    document.getElementById('modal-apply')?.addEventListener('click', () => applyPush());

    // Position add buttons
    appRef.current.querySelectorAll('[data-pos-add]').forEach((el) => {
      el.addEventListener('click', () => {
        const product = el.getAttribute('data-pos-add')!;
        const formEl = document.getElementById(`pos-form-${product}`);
        if (!formEl) return;
        if (formEl.innerHTML) { formEl.innerHTML = ''; return; } // toggle off
        formEl.innerHTML = `
          <div class="pos-form">
            <input class="pos-input" id="pos-instrument" placeholder="Instrument (e.g. May-Jun26)" />
            <div class="pos-form-row">
              <select class="pos-input pos-select" id="pos-direction"><option value="Long">Long</option><option value="Short">Short</option></select>
              <input class="pos-input" id="pos-qty" placeholder="Qty" style="width:60px" />
              <input class="pos-input" id="pos-entry" placeholder="Entry" style="width:80px" />
            </div>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn-apply" id="pos-submit" style="font-size:11px;padding:5px 12px">Add Position</button>
              <button class="btn-cancel" id="pos-cancel" style="font-size:11px;padding:5px 12px">Cancel</button>
            </div>
          </div>`;
        setTimeout(() => document.getElementById('pos-instrument')?.focus(), 50);
        document.getElementById('pos-submit')?.addEventListener('click', () => submitPosition(product, render));
        document.getElementById('pos-cancel')?.addEventListener('click', () => { formEl.innerHTML = ''; });
      });
    });

    // Position close buttons
    appRef.current.querySelectorAll('[data-pos-close]').forEach((el) => {
      el.addEventListener('click', () => {
        const product = el.getAttribute('data-pos-close')!;
        const idx = parseInt(el.getAttribute('data-pos-idx')!, 10);
        removePosition(product, idx, render);
      });
    });

    // Range bar hover tooltips
    appRef.current.querySelectorAll('.rb-wrap[data-tt-live]').forEach((el) => {
      const wrap = el as HTMLElement;
      let tooltip: HTMLElement | null = null;
      wrap.addEventListener('mouseenter', (e) => {
        tooltip = document.createElement('div');
        tooltip.className = 'rb-tooltip';
        tooltip.innerHTML = `
          <div class="rb-tt-row"><span>Live:</span><span style="color:#00d2d2">${wrap.dataset.ttLive}</span></div>
          <div class="rb-tt-divider"></div>
          <div class="rb-tt-row"><span>Max:</span><span>${wrap.dataset.ttMax}</span></div>
          <div class="rb-tt-row"><span>P95:</span><span>${wrap.dataset.ttP95}</span></div>
          <div class="rb-tt-row"><span>P90:</span><span>${wrap.dataset.ttP90}</span></div>
          <div class="rb-tt-row"><span>P75:</span><span>${wrap.dataset.ttP75}</span></div>
          <div class="rb-tt-row"><span>P50:</span><span>${wrap.dataset.ttP50}</span></div>
          <div class="rb-tt-row"><span>P25:</span><span>${wrap.dataset.ttP25}</span></div>
          <div class="rb-tt-row"><span>P10:</span><span>${wrap.dataset.ttP10}</span></div>
          <div class="rb-tt-row"><span>P5:</span><span>${wrap.dataset.ttP5}</span></div>
          <div class="rb-tt-row"><span>Min:</span><span>${wrap.dataset.ttMin}</span></div>`;
        document.body.appendChild(tooltip);
        const rect = wrap.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2 - 70}px`;
        tooltip.style.top = `${rect.top - tooltip.offsetHeight - 6 + window.scrollY}px`;
      });
      wrap.addEventListener('mouseleave', () => {
        tooltip?.remove();
        tooltip = null;
      });
    });

    // Spreads refresh buttons
    appRef.current.querySelectorAll('[data-spreads-refresh]').forEach((el) => {
      el.addEventListener('click', async () => {
        stateRef.current.spreadsLoading = true;
        render();
        try {
          await authFetch('/api/spreads/refresh', { method: 'POST' });
          const res = await authFetch('/api/spreads');
          const json = await res.json();
          if (json.spreads) stateRef.current.spreads = json.spreads;
        } catch { /* ignore */ }
        stateRef.current.spreadsLoading = false;
        render();
      });
    });

    // Overview sub-tab toggles
    appRef.current.querySelectorAll('[data-ov-sub]').forEach((el) => {
      el.addEventListener('click', () => {
        stateRef.current.overviewSub = el.getAttribute('data-ov-sub') as 'playbook' | 'calendar';
        render();
      });
    });

    // Calendar navigation
    document.getElementById('cal-prev')?.addEventListener('click', () => {
      stateRef.current.calMonth--;
      if (stateRef.current.calMonth < 0) { stateRef.current.calMonth = 11; stateRef.current.calYear--; }
      render();
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
      stateRef.current.calMonth++;
      if (stateRef.current.calMonth > 11) { stateRef.current.calMonth = 0; stateRef.current.calYear++; }
      render();
    });

    // Playbook filter changes
    ['pb-f-commodity', 'pb-f-status', 'pb-f-season'].forEach((id) => {
      const el = document.getElementById(id) as HTMLSelectElement;
      el?.addEventListener('change', () => {
        const key = id.replace('pb-f-', '');
        (stateRef.current.pbFilter as any)[key] = el.value;
        render();
      });
    });
    const searchEl = document.getElementById('pb-f-search') as HTMLInputElement;
    searchEl?.addEventListener('input', () => {
      stateRef.current.pbFilter.search = searchEl.value;
      render();
    });

    // Add trade button
    appRef.current.querySelectorAll('[data-add-trade]').forEach((el) => {
      el.addEventListener('click', () => {
        const presetCommodity = el.getAttribute('data-add-trade') || '';
        stateRef.current.editingTrade = null;
        stateRef.current.tradeModal = true;
        render();
        if (presetCommodity) {
          setTimeout(() => {
            const sel = document.getElementById('tf-commodity') as HTMLSelectElement;
            if (sel) sel.value = presetCommodity;
            updateTickDefaults();
          }, 50);
        }
      });
    });

    // Edit trade buttons
    appRef.current.querySelectorAll('[data-edit-trade]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-edit-trade')!;
        const trade = stateRef.current.playbook.find(t => t.id === id);
        if (trade) {
          stateRef.current.editingTrade = trade;
          stateRef.current.tradeModal = true;
          render();
          setTimeout(() => populateTradeForm(trade), 50);
        }
      });
    });

    // Delete trade buttons
    appRef.current.querySelectorAll('[data-delete-trade]').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-delete-trade')!;
        try {
          await authFetch('/api/playbook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', id }),
          });
          stateRef.current.playbook = stateRef.current.playbook.filter(t => t.id !== id);
          render();
        } catch { /* ignore */ }
      });
    });

    // Trade form modal
    document.getElementById('tf-close')?.addEventListener('click', closeTradeModal);
    document.getElementById('tf-cancel')?.addEventListener('click', closeTradeModal);
    document.querySelector('.trade-modal-overlay')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('trade-modal-overlay')) closeTradeModal();
    });
    document.getElementById('tf-commodity')?.addEventListener('change', updateTickDefaults);
    document.getElementById('tf-submit')?.addEventListener('click', () => submitTrade(render));

    // Add note buttons
    appRef.current.querySelectorAll('[data-add-note]').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-add-note')!;
        const input = document.getElementById(`note-input-${id}`) as HTMLInputElement;
        const text = input?.value.trim();
        if (!text) return;
        try {
          await authFetch('/api/playbook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'addNote', id, text }),
          });
          const trade = stateRef.current.playbook.find(t => t.id === id);
          if (trade) {
            if (!trade.notes) trade.notes = [];
            trade.notes.push({ text, ts: new Date().toISOString() });
          }
          render();
        } catch { /* ignore */ }
      });
    });

    // Toggle trade card details
    appRef.current.querySelectorAll('[data-toggle-card]').forEach((el) => {
      el.addEventListener('click', () => {
        const detailEl = document.getElementById(`trade-detail-${el.getAttribute('data-toggle-card')}`);
        if (detailEl) detailEl.style.display = detailEl.style.display === 'none' ? 'block' : 'none';
      });
    });

    function closeModal() {
      stateRef.current.modal = false;
      stateRef.current.parseMsg = null;
      render();
    }

    function closeTradeModal() {
      stateRef.current.tradeModal = false;
      stateRef.current.editingTrade = null;
      render();
    }
  }, []);

  // Listen for push results
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { ok: boolean; msg: string; product?: string };
      stateRef.current.parseMsg = detail;
      render();
      if (detail.ok) {
        // Refresh data from server then switch tab
        setTimeout(() => {
          authFetch('/api/data')
            .then((r) => r.json())
            .then((json) => {
              if (json.products) stateRef.current.data.products = json.products;
              if (detail.product) stateRef.current.tab = detail.product;
              stateRef.current.modal = false;
              stateRef.current.parseMsg = null;
              render();
            });
        }, 1200);
      }
    };
    document.addEventListener('push-result', handler);
    return () => document.removeEventListener('push-result', handler);
  }, [render]);

  // Listen for data refreshes (from position add/remove)
  useEffect(() => {
    const handler = (e: Event) => {
      const products = (e as CustomEvent).detail;
      stateRef.current.data.products = products;
      render();
    };
    document.addEventListener('data-refresh', handler);
    return () => document.removeEventListener('data-refresh', handler);
  }, [render]);

  useEffect(() => {
    // Load data from API
    authFetch('/api/data')
      .then((r) => r.json())
      .then((json) => {
        if (json.products) {
          stateRef.current.data.products = json.products;
        }
        render();
      })
      .catch(() => render());

    const clockInterval = setInterval(clockTick, 1000);

    // Auto-refresh every 60s
    const pollInterval = setInterval(() => {
      authFetch('/api/data')
        .then((r) => r.json())
        .then((json) => {
          if (json.products) {
            stateRef.current.data.products = json.products;
            render();
          }
        })
        .catch(() => {});
    }, 60000);

    // Load playbook trades
    authFetch('/api/playbook')
      .then((r) => r.json())
      .then((json) => {
        if (json.trades) {
          stateRef.current.playbook = json.trades;
          render();
        }
      })
      .catch(() => {});

    // Load spreads data
    authFetch('/api/spreads')
      .then((r) => r.json())
      .then((json) => {
        if (json.spreads) {
          stateRef.current.spreads = json.spreads;
          render();
        }
      })
      .catch(() => {});

    // Refresh spreads every 30 min
    const spreadsPoll = setInterval(() => {
      authFetch('/api/spreads')
        .then((r) => r.json())
        .then((json) => {
          if (json.spreads) {
            stateRef.current.spreads = json.spreads;
            render();
          }
        })
        .catch(() => {});
    }, 1800000);

    return () => {
      clearInterval(clockInterval);
      clearInterval(pollInterval);
      clearInterval(spreadsPoll);
    };
  }, [render]);

  if (authed === null) {
    return <><style dangerouslySetInnerHTML={{ __html: STYLES }} /><div className="login-wrap"><div className="login-box"><div className="login-logo">▸ TRADE INTEL</div><div style={{color:'var(--muted2)',fontSize:12}}>Verifying...</div></div></div></>;
  }

  if (!authed) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
        <div className="login-wrap">
          <div className="login-box">
            <div className="login-logo">▸ TRADE INTEL</div>
            <input id="login-pw" type="password" className="login-input" placeholder="Password" autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }} />
            <button className="login-btn" onClick={handleLogin}>Enter</button>
            {loginError && <div className="login-error">{loginError}</div>}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div id="app" ref={appRef} />
    </>
  );
}

// --- Types ---
interface Percentile { label: string; value: number }
interface Idea { tier: string; contract: string; direction: string; entry_date: string; entry_price: string; exit_date: string; exit_price: string; rationale: string }
interface DateEntry { date: string; label: string; note: string; urgency: string }
interface Position { instrument: string; direction: string; qty: string; entry: string; pnl: string }
interface SpreadPctEntry { min: number; p5: number; p10: number; p25: number; p50: number; p75: number; p90: number; p95: number; max: number }
interface SpreadPercentiles { calendars: Record<string, SpreadPctEntry>; butterflies: Record<string, SpreadPctEntry> }
interface ProductData {
  regime: string | null;
  regimeType: string;
  percentiles: Percentile[];
  outlook: string[];
  ideas: Idea[];
  dates: DateEntry[];
  positions: Position[];
  risks: string[];
  spreadPercentiles: SpreadPercentiles | null;
  lastUpdated: string | null;
}
interface DashboardData {
  lastSaved: string | null;
  positions: Position[];
  products: Record<string, ProductData>;
}
interface SpreadEntry { name: string; value: number | null; legs: string[] }
interface SpreadsProduct {
  product: string;
  calendars: SpreadEntry[];
  butterflies: SpreadEntry[];
  contracts: { ticker: string; label: string; price: number | null }[];
  fetchedAt: string;
}

// --- Playbook Types ---
interface PlaybookTrade {
  id: string; name: string; commodity: string; strategyType: string; direction: string;
  status: string; grade: string; season: string; summary: string;
  entryDate: string; plannedExitDate: string; actualExitDate: string;
  entryPrice: string; exitPrice: string; qty: string;
  tickSize: string; tickValue: string; currency: string;
  notes: { text: string; ts: string }[];
  createdAt: string; updatedAt: string;
}

const TICK_CONFIGS: Record<string, { tickSize: number; tickValue: number; currency: string }> = {
  FCPO: { tickSize: 1, tickValue: 25, currency: 'MYR' },
  NG: { tickSize: 0.001, tickValue: 10, currency: 'USD' },
  ZS: { tickSize: 0.25, tickValue: 12.50, currency: 'USD' },
  ZC: { tickSize: 0.25, tickValue: 12.50, currency: 'USD' },
  ZW: { tickSize: 0.25, tickValue: 12.50, currency: 'USD' },
  ZL: { tickSize: 0.01, tickValue: 6, currency: 'USD' },
  KC: { tickSize: 0.05, tickValue: 18.75, currency: 'USD' },
  SB: { tickSize: 0.01, tickValue: 11.20, currency: 'USD' },
  HO: { tickSize: 0.0001, tickValue: 4.20, currency: 'USD' },
  RB: { tickSize: 0.0001, tickValue: 4.20, currency: 'USD' },
  CT: { tickSize: 0.01, tickValue: 5, currency: 'USD' },
  CC: { tickSize: 1, tickValue: 10, currency: 'USD' },
  ZM: { tickSize: 0.10, tickValue: 10, currency: 'USD' },
  GF: { tickSize: 0.025, tickValue: 12.50, currency: 'USD' },
  LE: { tickSize: 0.025, tickValue: 10, currency: 'USD' },
  HE: { tickSize: 0.025, tickValue: 10, currency: 'USD' },
};

const STRATEGY_TYPES = ['Butterfly', 'Calendar', 'Spread', 'Outright', 'Other'];
const GRADE_OPTIONS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-'];
const SEASON_OPTIONS = ['Q1', 'Q2', 'Q3', 'Q4', 'Multi-Q', 'Any'];
const STATUS_OPTIONS = ['Watching', 'Active', 'Closed'];

const GRADE_COLORS: Record<string, string> = {
  'A+': '#059669', A: '#059669', 'A-': '#10b981',
  'B+': '#d97706', B: '#d97706', 'B-': '#f59e0b',
  'C+': '#dc2626', C: '#dc2626', 'C-': '#ef4444',
};

const STATUS_COLORS: Record<string, { border: string; text: string }> = {
  Watching: { border: '#334155', text: '#60a5fa' },
  Active: { border: '#166534', text: '#22c55e' },
  Closed: { border: '#44403c', text: '#78716c' },
};

// --- Constants ---
const PRODUCTS = ['OVERVIEW', 'FCPO', 'ZC', 'ZS', 'ZL', 'ZM', 'ZW', 'NG', 'HO', 'RB', 'KC', 'SB', 'CC', 'CT', 'HE', 'GF', 'LE'];
const PRODUCT_LABELS: Record<string, string> = {
  OVERVIEW: 'OVERVIEW', FCPO: 'FCPO', ZC: 'CORN', ZS: 'SOYBEANS', ZL: 'SOY OIL', ZM: 'SOY MEAL',
  ZW: 'WHEAT', NG: 'NAT GAS', HO: 'HEATING OIL', RB: 'RBOB GAS', KC: 'COFFEE', SB: 'SUGAR',
  CC: 'COCOA', CT: 'COTTON', HE: 'LEAN HOG', GF: 'FEEDER CTL', LE: 'LIVE CTL',
};
const VALID_PRODUCTS = PRODUCTS.filter((p) => p !== 'OVERVIEW');

function buildDefault(): DashboardData {
  const data: DashboardData = { lastSaved: null, positions: [], products: {} };
  VALID_PRODUCTS.forEach((p) => {
    data.products[p] = {
      regime: null, regimeType: 'neutral', percentiles: [], outlook: [],
      ideas: [], dates: [], positions: [], risks: [], spreadPercentiles: null, lastUpdated: null,
    };
  });
  return data;
}

// --- Helpers ---
function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function pctColor(v: number) {
  if (v >= 80) return '#ef4444';
  if (v >= 60) return '#f59e0b';
  if (v <= 20) return '#22c55e';
  if (v <= 40) return '#38bdf8';
  return '#64748b';
}

function regimeClass(t: string) {
  const m: Record<string, string> = { bull: 'regime-bull', bear: 'regime-bear', neutral: 'regime-neutral', transition: 'regime-transition' };
  return m[t] || 'regime-neutral';
}

function tierClass(t: string) {
  if (!t) return 'tier-3';
  const n = t.toString().replace(/[^0-9]/g, '');
  if (n === '1') return 'tier-1';
  if (n === '2') return 'tier-2';
  return 'tier-3';
}

function urgClass(u: string) {
  if (!u) return 'urg-cool';
  const l = u.toLowerCase();
  if (l === 'hot' || l === 'imminent') return 'urg-hot';
  if (l === 'warm' || l === 'soon') return 'urg-warm';
  return 'urg-cool';
}

function clockTick() {
  const el = document.getElementById('hdr-time');
  if (el) {
    const now = new Date();
    el.textContent = now.toUTCString().slice(0, 25) + ' UTC';
  }
}

// --- Renderers ---
function renderRegimeCard(prod: ProductData) {
  if (!prod.regime) return `<div class="empty-state"><div class="em-icon">◈</div><div>No regime data</div><div class="em-cmd">PUSH a regime update</div></div>`;
  const bClass = regimeClass(prod.regimeType);
  let html = `<div style="margin-bottom:10px"><span class="regime-badge ${bClass}">${esc(prod.regime)}</span></div>`;
  if (prod.percentiles?.length) {
    prod.percentiles.forEach((row) => {
      const v = Math.round(row.value);
      html += `<div class="pct-row"><div class="pct-label">${esc(row.label)}</div><div class="pct-bar-wrap"><div class="pct-bar" style="width:${v}%;background:${pctColor(v)}"></div></div><div class="pct-val" style="color:${pctColor(v)}">${v}%</div></div>`;
    });
  }
  return html;
}

function renderOutlookCard(prod: ProductData) {
  if (!prod.outlook?.length) return `<div class="empty-state"><div class="em-icon">◈</div><div>No outlook data</div><div class="em-cmd">PUSH a fundamental update</div></div>`;
  return '<ul class="outlook-bullets">' + prod.outlook.map((b) => `<li><span>›</span><span>${esc(b)}</span></li>`).join('') + '</ul>';
}

function renderIdeasCard(prod: ProductData) {
  if (!prod.ideas?.length) return `<div class="empty-state"><div class="em-icon">◈</div><div>No trade ideas</div><div class="em-cmd">PUSH trade ideas</div></div>`;
  const rows = prod.ideas.map((idea) => {
    const dir = (idea.direction || '').toUpperCase();
    const dirCls = dir === 'LONG' ? 'dir-long' : dir === 'SHORT' ? 'dir-short' : '';
    const rationaleRow = idea.rationale ? `<tr class="idea-rationale-row"><td colspan="5" class="idea-rationale">${esc(idea.rationale)}</td></tr>` : '';
    return `<tr>
      <td><span class="tier-badge ${tierClass(idea.tier)}">${esc(idea.tier || '—')}</span></td>
      <td class="idea-contract">${esc(idea.contract || '—')}</td>
      <td><span class="${dirCls}">${esc(dir || '—')}</span></td>
      <td class="idea-entry">${esc(idea.entry_date || '—')}<br><span class="idea-price">${esc(idea.entry_price || '—')}</span></td>
      <td class="idea-exit">${esc(idea.exit_date || '—')}<br><span class="idea-price">${esc(idea.exit_price || '—')}</span></td>
    </tr>${rationaleRow}`;
  }).join('');
  return `<table class="ideas-table"><thead><tr><th>TIER</th><th>CONTRACT</th><th>DIR</th><th>ENTRY</th><th>EXIT</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderDatesCard(prod: ProductData) {
  if (!prod.dates?.length) return `<div class="empty-state"><div class="em-icon">◈</div><div>No upcoming dates</div><div class="em-cmd">PUSH key dates</div></div>`;
  return prod.dates.map((d) => `
    <div class="date-row"><div class="date-d">${esc(d.date || '')}</div><div style="flex:1"><span class="date-label">${esc(d.label || '')}</span><span class="date-note">${esc(d.note || '')}</span></div><div class="date-urgency ${urgClass(d.urgency)}">${esc(d.urgency || '')}</div></div>`).join('');
}

function renderRisksCard(prod: ProductData) {
  if (!prod.risks?.length) return `<div class="empty-state"><div class="em-icon">◈</div><div>No risk flags</div><div class="em-cmd">PUSH key risks</div></div>`;
  return '<ul class="risk-bullets">' + prod.risks.map((r) => `<li><span>${esc(r)}</span></li>`).join('') + '</ul>';
}

/** Find the live spread price for a position by matching against calendar and butterfly spreads */
function findLivePrice(pos: Position, sp: SpreadsProduct | null): number | null {
  if (!sp) return null;
  const allSpreads = [...sp.calendars, ...sp.butterflies];
  for (const spread of allSpreads) {
    if (spread.value === null) continue;
    const isFly = spread.name.includes('/');
    const match = findPositionMatch(spread.name, [pos], isFly);
    if (match) return spread.value;
  }
  return null;
}

function renderPositionsCard(prod: ProductData, product?: string, sp?: SpreadsProduct | null) {
  if (!prod.positions?.length) return `<div class="empty-state"><div class="em-icon">◈</div><div>No open positions</div><div class="em-cmd">Use + ADD above</div></div>`;
  const header = `<div class="pos-row-x"><div class="pos-header">Instrument</div><div class="pos-header" style="text-align:right">Dir</div><div class="pos-header" style="text-align:right">Qty</div><div class="pos-header" style="text-align:right">Entry</div><div class="pos-header" style="text-align:right">P&L</div><div></div></div>`;
  const rows = prod.positions.map((pos, i) => {
    const dirClass = (pos.direction || '').toLowerCase() === 'short' ? 'pos-dir-short' : 'pos-dir-long';
    const closeBtn = product ? `<button class="pos-close-btn" data-pos-close="${product}" data-pos-idx="${i}">✕</button>` : '';

    // Compute P&L from live price if possible
    let pnlStr = pos.pnl || '--';
    const entryNum = parseFloat(pos.entry);
    const livePrice = findLivePrice(pos, sp || null);
    if (livePrice !== null && !isNaN(entryNum)) {
      const isShort = (pos.direction || '').toLowerCase() === 'short';
      const rawPnl = isShort ? entryNum - livePrice : livePrice - entryNum;
      const qty = parseInt(pos.qty) || 1;
      const totalPnl = rawPnl * qty;
      pnlStr = (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2);
    }

    const pnlNum = parseFloat(pnlStr);
    const pnlClass = !isNaN(pnlNum) && pnlNum < 0 ? 'pos-pnl-neg' : 'pos-pnl-pos';
    return `<div class="pos-row-x"><div class="pos-instr">${esc(pos.instrument || '')}</div><div class="${dirClass}" style="text-align:right">${esc((pos.direction || '').toUpperCase())}</div><div class="pos-num">${esc(pos.qty || '')}</div><div class="pos-num">${esc(pos.entry || '')}</div><div class="${pnlClass}">${esc(pnlStr)}</div><div style="text-align:center">${closeBtn}</div></div>`;
  }).join('');
  return header + rows;
}

/**
 * Normalize a spread/position name for matching.
 * Strips product codes, years, whitespace, and lowercases.
 * "ZL Oct-Dec26" → "oct-dec", "Oct-Dec26" → "oct-dec",
 * "ZLV-Z26" → "v-z", "Oct/Dec/Feb27" → "oct/dec/feb"
 */
const PRODUCT_CODES = new Set(['fcpo','zc','zs','zl','zm','zw','ng','ho','rb','kc','sb','cc','ct','he','gf','le','es','nq']);

function normalizeForMatch(name: string): string {
  let s = name.trim().toLowerCase();
  // Strip known product codes at start (e.g. "ZS " or "FCPO ")
  const firstWord = s.split(/[\s\-\/]/)[0];
  if (PRODUCT_CODES.has(firstWord)) {
    s = s.slice(firstWord.length).replace(/^\s+/, '');
  }
  // Strip "fly" / "butterfly" / "cal" / "calendar" suffixes
  s = s.replace(/\s*(butterfly|fly|calendar|cal|spread)\s*/gi, '');
  // Strip all year digits (4-digit first, then 2-digit)
  s = s.replace(/20\d{2}/g, '').replace(/\d{2}/g, '');
  // Strip whitespace
  s = s.replace(/\s+/g, '');
  return s;
}

// Month code to name and vice versa for matching "V-Z" style to "Oct-Dec" style
const MC_TO_NAME: Record<string, string> = {
  f:'jan',g:'feb',h:'mar',j:'apr',k:'may',m:'jun',
  n:'jul',q:'aug',u:'sep',v:'oct',x:'nov',z:'dec'
};

function expandMonthCodes(s: string): string {
  // Replace single-letter month codes like "v-z" → "oct-dec", "v/z/h" → "oct/dec/mar"
  return s.replace(/\b([fghjkmnquvxz])\b/gi, (_, c) => MC_TO_NAME[c.toLowerCase()] || c);
}

interface PositionMatch { direction: string }

const MONTH_NAMES_SET = new Set(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']);

/** Extract month names from a string (e.g. "Jul26-Aug26-Sep26 Fly" → ["jul","aug","sep"]) */
function extractMonths(s: string): string[] {
  const expanded = expandMonthCodes(normalizeForMatch(s));
  const months: string[] = [];
  for (const m of MONTH_NAMES_SET) {
    // Find all occurrences
    let idx = expanded.indexOf(m);
    while (idx !== -1) {
      months.push(m);
      idx = expanded.indexOf(m, idx + 1);
    }
  }
  // Deduplicate while preserving order
  return [...new Set(months)];
}

/** Extract year digits from a string (e.g. "Jul26-Aug26" → ["26"]) */
function extractYears(s: string): string[] {
  const matches = s.match(/\d{2}/g) || [];
  return [...new Set(matches)];
}

/** Count how many legs a position has: 2 = calendar, 3 = butterfly */
function countLegs(instrument: string): number {
  return extractMonths(instrument).length;
}

/** Check if a position instrument contains fly/butterfly keywords */
function isFlyPosition(inst: string): boolean {
  return /fly|butterfly/i.test(inst);
}

/** Check if a position instrument contains calendar/cal/spread keywords */
function isCalPosition(inst: string): boolean {
  return /cal|calendar|spread/i.test(inst);
}

function findPositionMatch(spreadName: string, positions: Position[], isFly: boolean): PositionMatch | null {
  if (!positions?.length) return null;

  const spreadMonths = extractMonths(spreadName);
  const spreadYears = extractYears(spreadName);
  const expectedLegs = isFly ? 3 : 2;

  for (const pos of positions) {
    const inst = pos.instrument || '';
    const posMonths = extractMonths(inst);
    const posYears = extractYears(inst);
    const posLegs = posMonths.length;

    // Shorthand format: "May26 Fly" (1 month + fly keyword) → match by first month
    // e.g. "May26 Fly" matches "May/Jun/Jul26" butterfly row
    if (isFly && posLegs === 1 && isFlyPosition(inst)) {
      if (spreadMonths.length >= 1 && posMonths[0] === spreadMonths[0]) {
        // Year check
        if (spreadYears.length > 0 && posYears.length > 0) {
          if (!spreadYears.some(y => posYears.includes(y))) continue;
        }
        return { direction: (pos.direction || '').toLowerCase() };
      }
      continue;
    }

    // Shorthand format: "May26 Cal" (1 month + cal keyword) → match by first month
    if (!isFly && posLegs === 1 && isCalPosition(inst)) {
      if (spreadMonths.length >= 1 && posMonths[0] === spreadMonths[0]) {
        if (spreadYears.length > 0 && posYears.length > 0) {
          if (!spreadYears.some(y => posYears.includes(y))) continue;
        }
        return { direction: (pos.direction || '').toLowerCase() };
      }
      continue;
    }

    // Full format: all months spelled out — must match leg count
    if (posLegs !== expectedLegs) continue;

    // If position has fly/cal keyword, make sure it matches the row type
    if (isFlyPosition(inst) && !isFly) continue;
    if (isCalPosition(inst) && isFly) continue;

    // All months must match in order
    if (posMonths.length !== spreadMonths.length) continue;
    if (!posMonths.every((m, i) => m === spreadMonths[i])) continue;

    // If both have year info, years must overlap
    if (spreadYears.length > 0 && posYears.length > 0) {
      if (!spreadYears.some(y => posYears.includes(y))) continue;
    }

    return { direction: (pos.direction || '').toLowerCase() };
  }
  return null;
}

function renderSpreadsCard(sp: SpreadsProduct | null, loading: boolean, spPct: SpreadPercentiles | null, positions?: Position[]) {
  if (!sp) return `<div class="empty-state"><div class="em-icon">◈</div><div>${loading ? 'Loading spread data...' : 'No spread data yet'}</div><div class="em-cmd">Click REFRESH to fetch prices</div></div>`;

  const formatVal = (v: number | null) => {
    if (v === null) return '<span class="sp-nil">--</span>';
    const cls = v > 0 ? 'sp-pos' : v < 0 ? 'sp-neg' : 'sp-zero';
    const sign = v > 0 ? '+' : '';
    return `<span class="${cls}">${sign}${v.toFixed(2)}</span>`;
  };

  // Normalize spread name for percentile lookup: strip year digits to get generic name
  // e.g. "May-Jul26" → "May-Jul", "Dec26-Mar27" → "Dec-Mar", "May/Jul/Sep26" → "May/Jul/Sep"
  const normalizeName = (name: string) => name.replace(/\d{2}/g, '').replace(/\s+/g, '');

  // For butterflies, also try "X Fly" format (e.g. "Feb/Apr/May" → "Feb Fly")
  const butterflyFlyName = (name: string) => {
    const norm = normalizeName(name);
    const firstMonth = norm.split('/')[0];
    return firstMonth ? `${firstMonth} Fly` : '';
  };

  const renderRangeBar = (pct: SpreadPctEntry, liveVal: number) => {
    const range = pct.p95 - pct.p5;
    if (range <= 0) return '';
    const clamp = (v: number) => Math.max(0, Math.min(100, ((v - pct.p5) / range) * 100));
    const p25Pos = clamp(pct.p25);
    const p75Pos = clamp(pct.p75);
    const p50Pos = clamp(pct.p50);
    const livePos = clamp(liveVal);
    const livePct = ((liveVal - pct.p5) / range) * 100;
    let zoneLabel = '';
    let zoneCls = '';
    if (livePct <= 10) { zoneLabel = 'CHEAP'; zoneCls = 'rb-zone-cheap'; }
    else if (livePct >= 90) { zoneLabel = 'RICH'; zoneCls = 'rb-zone-rich'; }

    // Build tooltip data as data attrs
    const ttData = `data-tt-min="${pct.min.toFixed(2)}" data-tt-p5="${pct.p5.toFixed(2)}" data-tt-p10="${pct.p10.toFixed(2)}" data-tt-p25="${pct.p25.toFixed(2)}" data-tt-p50="${pct.p50.toFixed(2)}" data-tt-p75="${pct.p75.toFixed(2)}" data-tt-p90="${pct.p90.toFixed(2)}" data-tt-p95="${pct.p95.toFixed(2)}" data-tt-max="${pct.max.toFixed(2)}" data-tt-live="${liveVal.toFixed(2)}"`;

    return `<div class="rb-wrap" ${ttData}>
      <span class="rb-end">${pct.p5.toFixed(1)}</span>
      <div class="rb-track">
        <div class="rb-inner" style="left:${p25Pos}%;width:${p75Pos - p25Pos}%"></div>
        <div class="rb-tick" style="left:${clamp(pct.p10)}%"></div>
        <div class="rb-tick" style="left:${p25Pos}%"></div>
        <div class="rb-tick rb-tick-mid" style="left:${p50Pos}%"></div>
        <div class="rb-tick" style="left:${p75Pos}%"></div>
        <div class="rb-tick" style="left:${clamp(pct.p90)}%"></div>
        <div class="rb-dot" style="left:${livePos}%"><div class="rb-dot-glow"></div><div class="rb-dot-core"></div></div>
      </div>
      <span class="rb-end">${pct.p95.toFixed(1)}</span>
      ${zoneLabel ? `<span class="rb-zone ${zoneCls}">${zoneLabel}</span>` : ''}
    </div>`;
  };

  const renderRow = (s: SpreadEntry, pctMap: Record<string, SpreadPctEntry> | undefined, isFly = false) => {
    const norm = normalizeName(s.name);
    let pct = pctMap?.[norm];
    // For butterflies, also try "X Fly" format (e.g. "Feb Fly" instead of "Feb/Apr/May")
    if (!pct && isFly) pct = pctMap?.[butterflyFlyName(s.name)];
    const hasBar = pct && s.value !== null;
    const posMatch = findPositionMatch(s.name, positions || [], isFly);
    const rowCls = posMatch ? `rb-row rb-row-active rb-row-${posMatch.direction === 'short' ? 'short' : 'long'}` : 'rb-row';
    const dirTag = posMatch
      ? `<span class="rb-dir rb-dir-${posMatch.direction === 'short' ? 'short' : 'long'}">${posMatch.direction === 'short' ? '▼' : '▲'}</span>`
      : '';
    return `<div class="${rowCls}">
      <span class="rb-name">${esc(s.name)}${dirTag}</span>
      <span class="rb-price">${formatVal(s.value)}</span>
      ${hasBar ? renderRangeBar(pct!, s.value!) : '<div class="rb-wrap"><div class="rb-track rb-track-empty"></div></div>'}
    </div>`;
  };

  const calRows = sp.calendars.map((s) => renderRow(s, spPct?.calendars, false)).join('');
  const flyRows = sp.butterflies.map((s) => renderRow(s, spPct?.butterflies, true)).join('');

  return `
    <div class="rb-cols">
      <div class="rb-col">
        <div class="section-label">Calendar Spreads</div>
        <div class="rb-hdr"><span class="rb-hdr-name">Spread</span><span class="rb-hdr-price">Price</span><span class="rb-hdr-bar">P5</span><span class="rb-hdr-end">P95</span></div>
        ${calRows}
      </div>
      <div class="rb-col">
        <div class="section-label">Butterfly Spreads</div>
        <div class="rb-hdr"><span class="rb-hdr-name">Spread</span><span class="rb-hdr-price">Price</span><span class="rb-hdr-bar">P5</span><span class="rb-hdr-end">P95</span></div>
        ${flyRows}
      </div>
    </div>
    <div class="rb-legend">
      <div class="rb-leg-item"><div class="rb-leg-outer"></div><span>P5–P95</span></div>
      <div class="rb-leg-item"><div class="rb-leg-inner"></div><span>P25–P75</span></div>
      <div class="rb-leg-item"><div class="rb-leg-dot"></div><span>Live</span></div>
      <div class="rb-leg-item"><div class="rb-leg-tick"></div><span>P50</span></div>
    </div>`;
}

function renderOverview(data: DashboardData, playbook: PlaybookTrade[], sub: 'playbook' | 'calendar', filter: { commodity: string; status: string; season: string; search: string }, calMonth: number, calYear: number) {
  const subTabs = `<div class="ov-sub-bar">
    <div class="ov-sub${sub === 'playbook' ? ' ov-sub-active' : ''}" data-ov-sub="playbook">PLAYBOOK</div>
    <div class="ov-sub${sub === 'calendar' ? ' ov-sub-active' : ''}" data-ov-sub="calendar">CALENDAR</div>
  </div>`;

  if (sub === 'calendar') {
    return `${subTabs}<div class="full-row card"><div class="card-body">${renderCalendarView(playbook, calMonth, calYear)}</div></div>`;
  }

  // Playbook view
  let filtered = [...playbook];
  if (filter.commodity) filtered = filtered.filter(t => t.commodity === filter.commodity);
  if (filter.status) filtered = filtered.filter(t => t.status === filter.status);
  if (filter.season) filtered = filtered.filter(t => t.season === filter.season);
  if (filter.search) {
    const q = filter.search.toLowerCase();
    filtered = filtered.filter(t => t.name.toLowerCase().includes(q) || t.summary?.toLowerCase().includes(q) || t.commodity.toLowerCase().includes(q));
  }

  // Sort: Active → Watching → Closed, then by entryDate
  const statusOrder: Record<string, number> = { Active: 0, Watching: 1, Closed: 2 };
  filtered.sort((a, b) => (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1) || (a.entryDate || '').localeCompare(b.entryDate || ''));

  const commodityOpts = ['<option value="">All</option>', ...VALID_PRODUCTS.map(p => `<option value="${p}"${filter.commodity === p ? ' selected' : ''}>${p}</option>`)].join('');
  const statusFilterOpts = ['<option value="">All</option>', ...STATUS_OPTIONS.map(s => `<option value="${s}"${filter.status === s ? ' selected' : ''}>${s}</option>`)].join('');
  const seasonFilterOpts = ['<option value="">All</option>', ...SEASON_OPTIONS.map(s => `<option value="${s}"${filter.season === s ? ' selected' : ''}>${s}</option>`)].join('');

  const filterBar = `<div class="pb-filter-bar">
    <select class="pos-input" id="pb-f-commodity" style="width:100px">${commodityOpts}</select>
    <select class="pos-input" id="pb-f-status" style="width:100px">${statusFilterOpts}</select>
    <select class="pos-input" id="pb-f-season" style="width:100px">${seasonFilterOpts}</select>
    <input class="pos-input" id="pb-f-search" placeholder="Search..." style="width:160px" value="${esc(filter.search)}" />
    <button class="pos-add-btn" data-add-trade="" style="margin-left:auto">+ ADD TRADE</button>
  </div>`;

  const cards = filtered.length
    ? filtered.map(t => renderPlaybookCard(t)).join('')
    : `<div class="empty-state"><div class="em-icon">◈</div><div>No trades found</div><div class="em-cmd">Click + ADD TRADE to create one</div></div>`;

  const countStr = `<span style="font-size:10px;color:var(--muted);margin-left:8px">${filtered.length} trade${filtered.length !== 1 ? 's' : ''}</span>`;

  return `${subTabs}${filterBar}<div class="full-row">${countStr}${cards}</div>`;
}

function renderUpcomingTrades(playbook: PlaybookTrade[], product: string) {
  const trades = playbook.filter(t => t.commodity === product && t.status !== 'Closed');
  if (!trades.length) return `<div class="empty-state"><div class="em-icon">◈</div><div>No upcoming trades</div><div class="em-cmd">Add from the Playbook</div></div>`;
  return trades.map(t => {
    const sc = STATUS_COLORS[t.status] || STATUS_COLORS.Watching;
    const dirCls = t.direction === 'Long' ? 'dir-long' : t.direction === 'Short' ? 'dir-short' : '';
    return `<div class="pb-upcoming-row" style="border-left:2px solid ${sc.border}">
      <div style="display:flex;align-items:center;gap:6px;flex:1">
        <span class="pb-status" style="color:${sc.text};font-size:9px">${esc(t.status)}</span>
        ${t.grade ? `<span class="pb-grade" style="color:${GRADE_COLORS[t.grade] || 'var(--muted)'}; font-size:9px">${esc(t.grade)}</span>` : ''}
        <span style="font-family:var(--mono);font-size:11px;color:var(--text)">${esc(t.name)}</span>
        <span class="${dirCls}" style="font-size:10px">${esc(t.direction)}</span>
      </div>
      <div style="display:flex;gap:12px;font-family:var(--mono);font-size:10px;color:var(--muted)">
        ${t.entryDate ? `<span>Entry: ${formatDateShort(t.entryDate)}</span>` : ''}
        ${t.plannedExitDate ? `<span>Exit: ${formatDateShort(t.plannedExitDate)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderProduct(data: DashboardData, product: string, spreads: Record<string, SpreadsProduct> | null, spreadsLoading: boolean, playbook?: PlaybookTrade[]) {
  const prod = data.products[product] || buildDefault().products[VALID_PRODUCTS[0]];
  const sp = spreads?.[product] ?? null;

  // Spreads card header with timestamp and refresh button
  const spTime = sp?.fetchedAt ? new Date(sp.fetchedAt).toUTCString().slice(0, 22) + ' UTC' : '';
  const staleMs = sp?.fetchedAt ? Date.now() - new Date(sp.fetchedAt).getTime() : Infinity;
  const isStale = staleMs > 30 * 60 * 1000;
  const staleTag = isStale && sp ? ' <span class="sp-stale">(stale)</span>' : '';
  const loadingTag = spreadsLoading ? ' <span class="sp-stale">refreshing...</span>' : '';

  const spreadsCard = `<div class="full-row card"><div class="card-header"><span class="card-title">LIVE SPREADS</span><div style="display:flex;align-items:center;gap:8px"><span class="last-updated">${spTime}${staleTag}${loadingTag}</span><button class="pos-add-btn" data-spreads-refresh="${product}">↻ REFRESH</button></div></div><div class="card-body">${renderSpreadsCard(sp, spreadsLoading, prod.spreadPercentiles, prod.positions)}</div></div>`;

  return `
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">REGIME + PERCENTILES</span>${prod.lastUpdated ? `<span class="last-updated">${esc(prod.lastUpdated)}</span>` : ''}</div><div class="card-body">${renderRegimeCard(prod)}</div></div>
      <div class="card"><div class="card-header"><span class="card-title">FUNDAMENTAL OUTLOOK</span></div><div class="card-body">${renderOutlookCard(prod)}</div></div>
    </div>
    <div class="full-row card"><div class="card-header"><span class="card-title">BEST OPPORTUNITIES</span></div><div class="card-body">${renderIdeasCard(prod)}</div></div>
    ${spreadsCard}
    <div class="grid-3">
      <div class="card"><div class="card-header"><span class="card-title">KEY UPCOMING DATES</span></div><div class="card-body">${renderDatesCard(prod)}</div></div>
      <div class="card"><div class="card-header"><span class="card-title">KEY RISKS</span></div><div class="card-body">${renderRisksCard(prod)}</div></div>
      <div class="card"><div class="card-header"><span class="card-title">CURRENT POSITIONS</span><button class="pos-add-btn" data-pos-add="${product}">+ ADD</button></div><div class="card-body"><div id="pos-form-${product}"></div>${renderPositionsCard(prod, product, sp)}</div></div>
    </div>
    <div class="full-row card"><div class="card-header"><span class="card-title">UPCOMING TRADES</span><button class="pos-add-btn" data-add-trade="${product}">+ ADD</button></div><div class="card-body">${renderUpcomingTrades(playbook || [], product)}</div></div>`;
}

function renderModal(parseMsg: { ok: boolean; msg: string } | null) {
  return `
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">PUSH UPDATE</span>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-hint" style="margin-bottom:10px">Paste the JSON payload Claude generated for you. Say <strong>"push to dashboard for [PRODUCT]"</strong> after any analysis.</div>
          <textarea class="modal-textarea" id="push-input" placeholder='{"product":"FCPO","regime":"Contango | Bearish Pressure","regimeType":"bear",...}'></textarea>
          ${parseMsg ? `<div class="${parseMsg.ok ? 'parse-result' : 'parse-error'}">${parseMsg.ok ? '✓ ' : ''} ${esc(parseMsg.msg)}</div>` : ''}
          <div class="modal-actions">
            <button class="btn-cancel" id="modal-cancel">Cancel</button>
            <button class="btn-apply" id="modal-apply">Apply Update</button>
          </div>
          <div class="modal-hint" style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
            <strong style="color:var(--muted2)">JSON schema</strong><br>
            Required: <code style="color:var(--accent)">product</code><br>
            Optional: <code style="color:var(--muted2)">regime</code>, <code>regimeType</code> (bull/bear/neutral/transition), <code>percentiles</code> [{label,value}], <code>outlook</code> [strings], <code>ideas</code> [{tier,contract,direction,entry_date,entry_price,exit_date,exit_price,rationale}], <code>dates</code> [{date,label,note,urgency}], <code>positions</code> [{instrument,direction,qty,entry,pnl}], <code>risks</code> [strings], <code>spreadPercentiles</code> {calendars:{SpreadName:{min,p5,p10,p25,p50,p75,p90,p95,max}},butterflies:{...}}
          </div>
        </div>
      </div>
    </div>`;
}

// --- Push handler ---
async function applyPush() {
  const input = document.getElementById('push-input') as HTMLTextAreaElement | null;
  const val = input?.value.trim();
  if (!val) return;

  try {
    JSON.parse(val); // validate JSON locally first
    const res = await authFetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: val,
    });
    const json = await res.json();
    if (json.ok) {
      document.dispatchEvent(new CustomEvent('push-result', { detail: { ok: true, msg: `Updated ${json.product} successfully.`, product: json.product } }));
    } else {
      document.dispatchEvent(new CustomEvent('push-result', { detail: { ok: false, msg: json.error || 'Push failed.' } }));
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    document.dispatchEvent(new CustomEvent('push-result', { detail: { ok: false, msg: 'Invalid JSON: ' + msg } }));
  }
}

// --- Position handlers ---
async function submitPosition(product: string, renderFn: () => void) {
  const instrument = (document.getElementById('pos-instrument') as HTMLInputElement)?.value.trim();
  const direction = (document.getElementById('pos-direction') as HTMLSelectElement)?.value;
  const qty = (document.getElementById('pos-qty') as HTMLInputElement)?.value.trim() || '1';
  const entry = (document.getElementById('pos-entry') as HTMLInputElement)?.value.trim();
  if (!instrument) return;

  try {
    const res = await authFetch('/api/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', product, position: { instrument, direction, qty, entry, pnl: '--' } }),
    });
    const json = await res.json();
    if (json.ok) {
      // Refresh from server
      const dataRes = await authFetch('/api/data');
      const dataJson = await dataRes.json();
      if (dataJson.products) {
        (window as unknown as { __dashRender: { stateRef: { current: { data: DashboardData } } }; render: () => void }).__dashRender;
        document.dispatchEvent(new CustomEvent('data-refresh', { detail: dataJson.products }));
      }
    }
  } catch { /* ignore */ }
}

async function removePosition(product: string, index: number, renderFn: () => void) {
  try {
    const res = await authFetch('/api/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', product, index }),
    });
    const json = await res.json();
    if (json.ok) {
      const dataRes = await authFetch('/api/data');
      const dataJson = await dataRes.json();
      if (dataJson.products) {
        document.dispatchEvent(new CustomEvent('data-refresh', { detail: dataJson.products }));
      }
    }
  } catch { /* ignore */ }
}

// --- Playbook helpers ---
function updateTickDefaults() {
  const commodity = (document.getElementById('tf-commodity') as HTMLSelectElement)?.value;
  const cfg = TICK_CONFIGS[commodity];
  if (cfg) {
    const ts = document.getElementById('tf-tickSize') as HTMLInputElement;
    const tv = document.getElementById('tf-tickValue') as HTMLInputElement;
    const cur = document.getElementById('tf-currency') as HTMLInputElement;
    if (ts && !ts.value) ts.value = String(cfg.tickSize);
    if (tv && !tv.value) tv.value = String(cfg.tickValue);
    if (cur && !cur.value) cur.value = cfg.currency;
  }
}

function populateTradeForm(trade: PlaybookTrade) {
  const fields: Record<string, string> = {
    'tf-name': trade.name, 'tf-commodity': trade.commodity, 'tf-strategy': trade.strategyType,
    'tf-direction': trade.direction, 'tf-status': trade.status, 'tf-grade': trade.grade,
    'tf-season': trade.season, 'tf-summary': trade.summary,
    'tf-entryDate': trade.entryDate, 'tf-exitDate': trade.plannedExitDate, 'tf-actualExitDate': trade.actualExitDate || '',
    'tf-entryPrice': trade.entryPrice, 'tf-exitPrice': trade.exitPrice, 'tf-qty': trade.qty,
    'tf-tickSize': trade.tickSize, 'tf-tickValue': trade.tickValue, 'tf-currency': trade.currency,
  };
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (el) el.value = val || '';
  }
}

async function submitTrade(renderFn: () => void) {
  const get = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)?.value?.trim() || '';
  const trade: any = {
    name: get('tf-name'), commodity: get('tf-commodity'), strategyType: get('tf-strategy'),
    direction: get('tf-direction'), status: get('tf-status'), grade: get('tf-grade'),
    season: get('tf-season'), summary: get('tf-summary'),
    entryDate: get('tf-entryDate'), plannedExitDate: get('tf-exitDate'), actualExitDate: get('tf-actualExitDate'),
    entryPrice: get('tf-entryPrice'), exitPrice: get('tf-exitPrice'), qty: get('tf-qty'),
    tickSize: get('tf-tickSize'), tickValue: get('tf-tickValue'), currency: get('tf-currency'),
  };
  if (!trade.name || !trade.commodity) return;

  const stateRef = (window as any).__stateRef;
  const editingTrade = stateRef?.current?.editingTrade;

  try {
    if (editingTrade) {
      await authFetch('/api/playbook', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: editingTrade.id, updates: trade }),
      });
    } else {
      await authFetch('/api/playbook', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', trade }),
      });
    }
    // Refresh playbook
    const res = await authFetch('/api/playbook');
    const json = await res.json();
    if (json.trades && stateRef) {
      stateRef.current.playbook = json.trades;
      stateRef.current.tradeModal = false;
      stateRef.current.editingTrade = null;
      renderFn();
    }
  } catch { /* ignore */ }
}

function renderTradeFormModal(editing: PlaybookTrade | null) {
  const title = editing ? 'EDIT TRADE' : 'ADD TRADE';
  const commodityOpts = VALID_PRODUCTS.map(p => `<option value="${p}">${p}</option>`).join('');
  const stratOpts = STRATEGY_TYPES.map(s => `<option value="${s}">${s}</option>`).join('');
  const dirOpts = ['Long', 'Short', 'Neutral'].map(d => `<option value="${d}">${d}</option>`).join('');
  const statusOpts = STATUS_OPTIONS.map(s => `<option value="${s}">${s}</option>`).join('');
  const gradeOpts = ['', ...GRADE_OPTIONS].map(g => `<option value="${g}">${g || '—'}</option>`).join('');
  const seasonOpts = SEASON_OPTIONS.map(s => `<option value="${s}">${s}</option>`).join('');

  return `<div class="trade-modal-overlay"><div class="modal" style="max-width:620px">
    <div class="modal-header"><span class="modal-title">${title}</span><button class="modal-close" id="tf-close">✕</button></div>
    <div class="modal-body" style="max-height:70vh;overflow-y:auto">
      <div class="tf-grid">
        <div class="tf-field"><label class="tf-label">Name*</label><input class="pos-input" id="tf-name" placeholder="e.g. May Fly Short" /></div>
        <div class="tf-field"><label class="tf-label">Commodity*</label><select class="pos-input" id="tf-commodity">${commodityOpts}</select></div>
      </div>
      <div class="tf-grid tf-grid-4">
        <div class="tf-field"><label class="tf-label">Strategy</label><select class="pos-input" id="tf-strategy">${stratOpts}</select></div>
        <div class="tf-field"><label class="tf-label">Direction</label><select class="pos-input" id="tf-direction">${dirOpts}</select></div>
        <div class="tf-field"><label class="tf-label">Status</label><select class="pos-input" id="tf-status">${statusOpts}</select></div>
        <div class="tf-field"><label class="tf-label">Grade</label><select class="pos-input" id="tf-grade">${gradeOpts}</select></div>
      </div>
      <div class="tf-grid tf-grid-3">
        <div class="tf-field"><label class="tf-label">Season</label><select class="pos-input" id="tf-season">${seasonOpts}</select></div>
        <div class="tf-field"><label class="tf-label">Entry Date</label><input class="pos-input" id="tf-entryDate" type="date" /></div>
        <div class="tf-field"><label class="tf-label">Planned Exit</label><input class="pos-input" id="tf-exitDate" type="date" /></div>
      </div>
      <div class="tf-field"><label class="tf-label">Summary</label><textarea class="pos-input" id="tf-summary" rows="2" placeholder="One-liner description"></textarea></div>
      <div class="tf-grid tf-grid-3">
        <div class="tf-field"><label class="tf-label">Entry Price</label><input class="pos-input" id="tf-entryPrice" placeholder="—" /></div>
        <div class="tf-field"><label class="tf-label">Exit Price</label><input class="pos-input" id="tf-exitPrice" placeholder="—" /></div>
        <div class="tf-field"><label class="tf-label">Qty</label><input class="pos-input" id="tf-qty" placeholder="1" /></div>
      </div>
      <div class="tf-grid tf-grid-3">
        <div class="tf-field"><label class="tf-label">Tick Size</label><input class="pos-input" id="tf-tickSize" /></div>
        <div class="tf-field"><label class="tf-label">Tick Value</label><input class="pos-input" id="tf-tickValue" /></div>
        <div class="tf-field"><label class="tf-label">Currency</label><input class="pos-input" id="tf-currency" /></div>
      </div>
      ${editing ? `<div class="tf-field"><label class="tf-label">Actual Exit Date</label><input class="pos-input" id="tf-actualExitDate" type="date" /></div>` : '<input type="hidden" id="tf-actualExitDate" value="" />'}
      <div class="modal-actions"><button class="btn-cancel" id="tf-cancel">Cancel</button><button class="btn-apply" id="tf-submit">${editing ? 'Save Changes' : 'Add Trade'}</button></div>
    </div>
  </div></div>`;
}

function calculateTradePnl(trade: PlaybookTrade): number | null {
  const entry = parseFloat(trade.entryPrice);
  const exit = parseFloat(trade.exitPrice);
  const qty = parseFloat(trade.qty) || 1;
  const cfg = TICK_CONFIGS[trade.commodity];
  const ts = parseFloat(trade.tickSize) || cfg?.tickSize;
  const tv = parseFloat(trade.tickValue) || cfg?.tickValue;
  if ([entry, exit, ts, tv].some(v => isNaN(v!) || v === 0)) return null;
  const diff = trade.direction === 'Short' ? entry - exit : exit - entry;
  return (diff / ts!) * tv! * qty;
}

function formatDateShort(dateStr: string) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return dateStr; }
}

function renderPlaybookCard(trade: PlaybookTrade) {
  const sc = STATUS_COLORS[trade.status] || STATUS_COLORS.Watching;
  const gc = GRADE_COLORS[trade.grade] || 'var(--muted)';
  const dirCls = trade.direction === 'Long' ? 'dir-long' : trade.direction === 'Short' ? 'dir-short' : '';
  const pnl = trade.status === 'Closed' ? calculateTradePnl(trade) : null;
  const pnlStr = pnl !== null ? `<span class="${pnl >= 0 ? 'pos-pnl-pos' : 'pos-pnl-neg'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ${trade.currency || TICK_CONFIGS[trade.commodity]?.currency || ''}</span>` : '';

  const notesHtml = (trade.notes || []).map(n => {
    const d = new Date(n.ts);
    const ts = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `<div class="pb-note"><span class="pb-note-ts">${ts}</span><span>${esc(n.text)}</span></div>`;
  }).join('');

  return `<div class="pb-card" style="border-left:3px solid ${sc.border}">
    <div class="pb-card-top" data-toggle-card="${trade.id}" style="cursor:pointer">
      <div class="pb-card-left">
        <span class="pb-status" style="color:${sc.text}">${esc(trade.status)}</span>
        ${trade.grade ? `<span class="pb-grade" style="color:${gc}">${esc(trade.grade)}</span>` : ''}
        <span class="pb-commodity">${esc(trade.commodity)}</span>
        <span class="pb-strategy">${esc(trade.strategyType)}</span>
        <span class="${dirCls}" style="font-size:11px">${esc(trade.direction)}</span>
      </div>
      <div class="pb-card-actions">
        <button class="pos-add-btn" data-edit-trade="${trade.id}">Edit</button>
        <button class="pos-close-btn" data-delete-trade="${trade.id}">✕</button>
      </div>
    </div>
    <div class="pb-card-name">${esc(trade.name)}</div>
    ${trade.summary ? `<div class="pb-card-summary">${esc(trade.summary)}</div>` : ''}
    <div class="pb-card-dates">
      ${trade.entryDate ? `<span>Entry: ${formatDateShort(trade.entryDate)}</span>` : ''}
      ${trade.plannedExitDate ? `<span>Exit: ${formatDateShort(trade.plannedExitDate)}</span>` : ''}
      ${pnlStr ? `<span>P&L: ${pnlStr}</span>` : ''}
    </div>
    <div id="trade-detail-${trade.id}" style="display:none">
      ${notesHtml ? `<div class="pb-notes-section"><div class="section-label">Notes</div>${notesHtml}</div>` : ''}
      <div class="pb-add-note">
        <input class="pos-input" id="note-input-${trade.id}" placeholder="Add a note..." style="flex:1" />
        <button class="pos-add-btn" data-add-note="${trade.id}" style="flex-shrink:0">Add</button>
      </div>
    </div>
  </div>`;
}

function renderCalendarView(trades: PlaybookTrade[], month: number, year: number) {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const activeTrades = trades.filter(t => t.status !== 'Closed');

  let cells = '';
  // Empty cells for days before month starts
  for (let i = 0; i < firstDay; i++) cells += '<div class="cal-cell cal-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const dayTrades: string[] = [];

    for (const t of activeTrades) {
      if (t.entryDate === dateStr) dayTrades.push(`<div class="cal-trade cal-entry">${esc(t.commodity)} ${esc(t.name)}</div>`);
      if (t.plannedExitDate === dateStr) dayTrades.push(`<div class="cal-trade cal-exit">${esc(t.commodity)} ${esc(t.name)}</div>`);
      // Show as active range
      if (t.entryDate && t.plannedExitDate && t.entryDate <= dateStr && t.plannedExitDate >= dateStr && t.entryDate !== dateStr && t.plannedExitDate !== dateStr) {
        dayTrades.push(`<div class="cal-trade cal-active">${esc(t.commodity)}</div>`);
      }
    }

    cells += `<div class="cal-cell${isToday ? ' cal-today' : ''}"><div class="cal-day">${d}</div>${dayTrades.join('')}</div>`;
  }

  return `
    <div class="cal-nav">
      <button class="pos-add-btn" id="cal-prev">◀</button>
      <span class="cal-title">${MONTH_NAMES[month]} ${year}</span>
      <button class="pos-add-btn" id="cal-next">▶</button>
    </div>
    <div class="cal-header">
      <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">
      <span class="cal-leg"><span class="cal-dot cal-dot-entry"></span>Entry</span>
      <span class="cal-leg"><span class="cal-dot cal-dot-exit"></span>Exit</span>
      <span class="cal-leg"><span class="cal-dot cal-dot-active"></span>Active range</span>
    </div>`;
}

// --- Styles ---
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0d0f12; --bg2: #13161b; --bg3: #1a1e25; --bg4: #222730;
  --border: #2a2f3a; --border2: #353c4a;
  --text: #e2e8f0; --muted: #64748b; --muted2: #8897aa;
  --accent: #38bdf8; --accent2: #0ea5e9;
  --green: #22c55e; --red: #ef4444; --amber: #f59e0b;
  --purple: #a78bfa; --teal: #2dd4bf;
  --mono: 'IBM Plex Mono', monospace; --sans: 'IBM Plex Sans', sans-serif;
}
body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 13px; min-height: 100vh; line-height: 1.5; }
.header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 0 16px; display: flex; align-items: center; justify-content: space-between; height: 44px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.logo { font-family: var(--mono); font-size: 13px; font-weight: 500; color: var(--accent); letter-spacing: 0.08em; }
.header-time { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.push-btn { background: var(--accent2); color: #fff; border: none; padding: 5px 12px; border-radius: 4px; font-family: var(--mono); font-size: 11px; font-weight: 500; cursor: pointer; letter-spacing: 0.05em; }
.push-btn:hover { background: var(--accent); }
.tab-bar { background: var(--bg2); border-bottom: 1px solid var(--border); display: flex; overflow-x: auto; padding: 0 8px; scrollbar-width: none; }
.tab-bar::-webkit-scrollbar { display: none; }
.tab { padding: 10px 14px; font-family: var(--mono); font-size: 11px; font-weight: 500; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; letter-spacing: 0.05em; transition: color 0.15s, border-color 0.15s; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.main { padding: 16px; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.full-row { margin-bottom: 12px; }
.card { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.card-header { background: var(--bg3); border-bottom: 1px solid var(--border); padding: 7px 12px; display: flex; align-items: center; justify-content: space-between; }
.card-title { font-family: var(--mono); font-size: 10px; font-weight: 500; color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; }
.card-body { padding: 12px; }
.regime-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 3px; font-family: var(--mono); font-size: 11px; font-weight: 500; letter-spacing: 0.05em; }
.regime-bull { background: rgba(34,197,94,0.15); color: var(--green); border: 1px solid rgba(34,197,94,0.3); }
.regime-bear { background: rgba(239,68,68,0.15); color: var(--red); border: 1px solid rgba(239,68,68,0.3); }
.regime-neutral { background: rgba(245,158,11,0.15); color: var(--amber); border: 1px solid rgba(245,158,11,0.3); }
.regime-transition { background: rgba(167,139,250,0.15); color: var(--purple); border: 1px solid rgba(167,139,250,0.3); }
.pct-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.pct-label { font-family: var(--mono); font-size: 11px; color: var(--muted2); width: 80px; flex-shrink: 0; }
.pct-bar-wrap { flex: 1; background: var(--bg4); border-radius: 2px; height: 5px; }
.pct-bar { height: 5px; border-radius: 2px; }
.pct-val { font-family: var(--mono); font-size: 11px; font-weight: 500; color: var(--text); width: 32px; text-align: right; }
.outlook-text { color: var(--muted2); font-size: 12px; line-height: 1.7; }
.outlook-bullets { list-style: none; padding: 0; }
.outlook-bullets li { padding: 3px 0; color: var(--muted2); font-size: 12px; display: flex; gap: 8px; }
.outlook-bullets li::before { content: '›'; color: var(--accent); flex-shrink: 0; }
.ideas-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.ideas-table th { font-family: var(--mono); font-size: 10px; color: var(--muted); font-weight: 500; text-align: left; padding: 4px 8px 6px; border-bottom: 1px solid var(--border); letter-spacing: 0.5px; }
.ideas-table td { font-family: var(--mono); font-size: 11px; color: var(--muted2); padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
.ideas-table tr:last-child td { border-bottom: none; }
.ideas-table .idea-contract { color: var(--accent); font-weight: 500; }
.ideas-table .idea-price { color: var(--text); font-weight: 500; }
.ideas-table .dir-long { color: var(--green); font-weight: 500; }
.ideas-table .dir-short { color: var(--red); font-weight: 500; }
.ideas-table .idea-rationale-row td { border-bottom: 1px solid var(--bg4); padding: 2px 8px 8px; }
.ideas-table .idea-rationale { font-family: var(--sans); font-size: 11px; color: var(--muted); font-style: italic; line-height: 1.5; }
.tier-badge { font-family: var(--mono); font-size: 10px; padding: 2px 7px; border-radius: 3px; font-weight: 500; }
.tier-1 { background: rgba(34,197,94,0.15); color: var(--green); }
.tier-2 { background: rgba(245,158,11,0.15); color: var(--amber); }
.tier-3 { background: rgba(100,116,139,0.15); color: var(--muted2); }
.date-row { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); align-items: baseline; }
.date-row:last-child { border-bottom: none; }
.date-d { font-family: var(--mono); font-size: 11px; color: var(--accent); width: 80px; flex-shrink: 0; }
.date-label { font-size: 12px; color: var(--text); }
.date-note { font-size: 11px; color: var(--muted); margin-left: 4px; }
.date-urgency { margin-left: auto; font-family: var(--mono); font-size: 10px; }
.urg-hot { color: var(--red); }
.urg-warm { color: var(--amber); }
.urg-cool { color: var(--muted); }
.pos-row { display: grid; grid-template-columns: 1fr 60px 60px 80px 60px; gap: 6px; padding: 7px 0; border-bottom: 1px solid var(--border); align-items: center; }
.pos-row:last-child { border-bottom: none; }
.pos-header { color: var(--muted); font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
.pos-instr { font-family: var(--mono); font-size: 11px; color: var(--text); }
.pos-dir-long { color: var(--green); font-family: var(--mono); font-size: 11px; font-weight: 500; }
.pos-dir-short { color: var(--red); font-family: var(--mono); font-size: 11px; font-weight: 500; }
.pos-num { font-family: var(--mono); font-size: 11px; color: var(--muted2); text-align: right; }
.pos-pnl-pos { font-family: var(--mono); font-size: 11px; color: var(--green); font-weight: 500; text-align: right; }
.pos-pnl-neg { font-family: var(--mono); font-size: 11px; color: var(--red); font-weight: 500; text-align: right; }
.empty-state { text-align: center; padding: 24px 12px; color: var(--muted); font-size: 12px; font-family: var(--mono); }
.empty-state .em-icon { font-size: 20px; margin-bottom: 6px; color: var(--border2); }
.empty-state .em-cmd { color: var(--accent); margin-top: 4px; font-size: 11px; }
.section-label { font-family: var(--mono); font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
.modal { background: var(--bg2); border: 1px solid var(--border2); border-radius: 8px; width: 100%; max-width: 560px; max-height: 80vh; overflow-y: auto; }
.modal-header { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.modal-title { font-family: var(--mono); font-size: 12px; font-weight: 500; color: var(--accent); letter-spacing: 0.08em; }
.modal-close { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 0; }
.modal-close:hover { color: var(--text); }
.modal-body { padding: 16px; }
.modal-textarea { width: 100%; min-height: 180px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 4px; color: var(--text); font-family: var(--mono); font-size: 11px; padding: 10px; resize: vertical; line-height: 1.6; }
.modal-textarea:focus { outline: none; border-color: var(--accent); }
.modal-hint { font-size: 11px; color: var(--muted); margin-top: 8px; line-height: 1.5; }
.modal-actions { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }
.btn-cancel { background: none; border: 1px solid var(--border2); color: var(--muted); padding: 7px 16px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.btn-cancel:hover { color: var(--text); }
.btn-apply { background: var(--accent2); color: #fff; border: none; padding: 7px 16px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500; }
.btn-apply:hover { background: var(--accent); }
.parse-result { font-family: var(--mono); font-size: 11px; color: var(--green); margin-top: 8px; padding: 8px; background: rgba(34,197,94,0.08); border-radius: 4px; border: 1px solid rgba(34,197,94,0.2); }
.parse-error { font-family: var(--mono); font-size: 11px; color: var(--red); margin-top: 8px; padding: 8px; background: rgba(239,68,68,0.08); border-radius: 4px; border: 1px solid rgba(239,68,68,0.2); }
.positions-overview-header { display: grid; grid-template-columns: 1fr 1fr 60px 60px 80px 60px; gap: 6px; padding: 6px 12px; background: var(--bg3); border-bottom: 1px solid var(--border); }
.pos-overview-row { display: grid; grid-template-columns: 1fr 1fr 60px 60px 80px 60px; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); align-items: center; }
.pos-overview-row:last-child { border-bottom: none; }
.pos-product { font-family: var(--mono); font-size: 11px; color: var(--accent); }
.last-updated { font-family: var(--mono); font-size: 10px; color: var(--muted); }
.pct-label-mini { font-family: var(--mono); font-size: 10px; color: var(--muted); }
.risk-bullets { list-style: none; padding: 0; }
.risk-bullets li { padding: 3px 0; color: var(--muted2); font-size: 12px; display: flex; gap: 8px; }
.risk-bullets li::before { content: '›'; color: var(--red); flex-shrink: 0; }
.pos-add-btn { background: none; border: 1px solid var(--border2); color: var(--muted); padding: 2px 8px; border-radius: 3px; font-family: var(--mono); font-size: 10px; cursor: pointer; letter-spacing: 0.05em; }
.pos-add-btn:hover { color: var(--accent); border-color: var(--accent); }
.pos-close-btn { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 12px; padding: 0 4px; line-height: 1; }
.pos-close-btn:hover { color: var(--red); }
.pos-row-x { display: grid; grid-template-columns: 1fr 60px 60px 80px 60px 28px; gap: 6px; padding: 7px 0; border-bottom: 1px solid var(--border); align-items: center; }
.pos-row-x:last-child { border-bottom: none; }
.pos-form { padding: 8px 0 12px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.pos-form-row { display: flex; gap: 6px; margin-top: 6px; }
.pos-input { background: var(--bg3); border: 1px solid var(--border2); border-radius: 3px; color: var(--text); font-family: var(--mono); font-size: 11px; padding: 5px 8px; width: 100%; }
.pos-input:focus { outline: none; border-color: var(--accent); }
.pos-select { width: 80px; }
.login-wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg1); }
.login-box { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 32px; width: 320px; text-align: center; }
.login-logo { font-family: var(--mono); font-size: 16px; font-weight: 600; color: var(--accent); margin-bottom: 24px; letter-spacing: 1px; }
.login-input { width: 100%; background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; padding: 10px 12px; color: var(--text); font-family: var(--mono); font-size: 13px; margin-bottom: 12px; box-sizing: border-box; }
.login-input:focus { outline: none; border-color: var(--accent); }
.login-btn { width: 100%; background: var(--accent); color: var(--bg1); border: none; border-radius: 4px; padding: 10px; font-family: var(--mono); font-size: 12px; font-weight: 600; cursor: pointer; letter-spacing: 0.5px; }
.login-btn:hover { opacity: 0.9; }
.login-error { color: var(--red); font-size: 11px; margin-top: 10px; font-family: var(--mono); }
.sp-pos { color: var(--green); font-weight: 500; }
.sp-neg { color: var(--red); font-weight: 500; }
.sp-zero { color: var(--muted); }
.sp-nil { color: var(--muted); }
.sp-stale { color: var(--amber); font-family: var(--mono); font-size: 10px; }
.rb-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 900px) { .rb-cols { grid-template-columns: 1fr; } }
.rb-col { min-width: 0; }
.rb-hdr { display: flex; align-items: center; gap: 0; padding: 0 0 4px; margin-bottom: 2px; }
.rb-hdr-name { width: 110px; flex-shrink: 0; font-family: var(--mono); font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.rb-hdr-price { width: 62px; flex-shrink: 0; font-family: var(--mono); font-size: 9px; color: var(--muted); text-transform: uppercase; text-align: right; padding-right: 8px; }
.rb-hdr-bar { flex: 1; font-family: var(--mono); font-size: 9px; color: var(--muted); }
.rb-hdr-end { width: 36px; flex-shrink: 0; font-family: var(--mono); font-size: 9px; color: var(--muted); text-align: right; }
.rb-row { display: flex; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(42,47,58,0.5); }
.rb-row:last-child { border-bottom: none; }
.rb-name { width: 110px; flex-shrink: 0; font-family: var(--mono); font-size: 11px; color: var(--muted2); }
.rb-price { width: 62px; flex-shrink: 0; font-family: var(--mono); font-size: 11px; text-align: right; padding-right: 8px; }
.rb-wrap { display: flex; align-items: center; flex: 1; gap: 4px; position: relative; cursor: default; min-width: 0; }
.rb-end { font-family: var(--mono); font-size: 9px; color: var(--muted); width: 32px; flex-shrink: 0; }
.rb-end:last-of-type { text-align: right; }
.rb-track { position: relative; flex: 1; height: 16px; background: rgba(30,35,50,0.9); border-radius: 3px; min-width: 60px; }
.rb-track-empty { background: rgba(30,35,50,0.4); }
.rb-inner { position: absolute; top: 0; height: 100%; background: rgba(45,52,72,0.9); border-radius: 2px; }
.rb-tick { position: absolute; top: 4px; width: 1px; height: 8px; background: rgba(70,78,100,0.7); transform: translateX(-50%); }
.rb-tick-mid { top: 2px; height: 12px; background: rgba(100,108,130,0.8); }
.rb-dot { position: absolute; top: 50%; transform: translate(-50%, -50%); z-index: 2; }
.rb-dot-glow { width: 18px; height: 18px; border-radius: 50%; background: radial-gradient(circle, rgba(0,210,210,0.25) 0%, transparent 70%); position: absolute; top: -5px; left: -5px; }
.rb-dot-core { width: 8px; height: 8px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #b0ffff, #00d2d2); box-shadow: 0 0 4px rgba(0,210,210,0.5); position: relative; z-index: 1; }
.rb-zone { font-family: var(--mono); font-size: 9px; font-weight: 500; letter-spacing: 0.05em; margin-left: 4px; flex-shrink: 0; }
.rb-zone-cheap { color: var(--green); }
.rb-zone-rich { color: #e88a3a; }
.rb-legend { display: flex; gap: 18px; padding: 10px 0 0; border-top: 1px solid var(--border); margin-top: 12px; }
.rb-leg-item { display: flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 9px; color: var(--muted); }
.rb-leg-outer { width: 18px; height: 8px; background: rgba(30,35,50,0.9); border-radius: 2px; }
.rb-leg-inner { width: 18px; height: 8px; background: rgba(45,52,72,0.9); border-radius: 2px; }
.rb-leg-dot { width: 8px; height: 8px; border-radius: 50%; background: #00d2d2; }
.rb-leg-tick { width: 1px; height: 10px; background: rgba(100,108,130,0.8); margin: 0 4px; }
.rb-row-active { border-radius: 3px; }
.rb-row-long { border-left: 2px solid var(--green); background: rgba(34,197,94,0.04); }
.rb-row-short { border-left: 2px solid var(--red); background: rgba(239,68,68,0.04); }
.rb-row-active .rb-name { color: var(--text); }
.rb-dir { font-size: 9px; margin-left: 4px; vertical-align: middle; }
.rb-dir-long { color: var(--green); }
.rb-dir-short { color: var(--red); }
/* Playbook styles */
.ov-sub-bar { display: flex; gap: 0; margin-bottom: 12px; border-bottom: 1px solid var(--border); }
.ov-sub { padding: 8px 16px; font-family: var(--mono); font-size: 11px; font-weight: 500; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; letter-spacing: 0.06em; }
.ov-sub:hover { color: var(--text); }
.ov-sub-active { color: var(--accent); border-bottom-color: var(--accent); }
.pb-filter-bar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.pb-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 5px; padding: 10px 12px; margin-bottom: 8px; }
.pb-card-top { display: flex; align-items: center; justify-content: space-between; }
.pb-card-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pb-card-actions { display: flex; gap: 4px; }
.pb-status { font-family: var(--mono); font-size: 10px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; }
.pb-grade { font-family: var(--mono); font-size: 10px; font-weight: 600; }
.pb-commodity { font-family: var(--mono); font-size: 10px; color: var(--accent); background: rgba(56,189,248,0.08); padding: 1px 6px; border-radius: 2px; }
.pb-strategy { font-family: var(--mono); font-size: 10px; color: var(--muted); }
.pb-card-name { font-family: var(--mono); font-size: 12px; color: var(--text); font-weight: 500; margin: 6px 0 2px; }
.pb-card-summary { font-size: 11px; color: var(--muted2); line-height: 1.4; margin-bottom: 4px; }
.pb-card-dates { display: flex; gap: 16px; font-family: var(--mono); font-size: 10px; color: var(--muted); margin-top: 4px; }
.pb-notes-section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.pb-note { font-size: 11px; color: var(--muted2); padding: 3px 0; display: flex; gap: 8px; }
.pb-note-ts { color: var(--muted); font-family: var(--mono); font-size: 10px; flex-shrink: 0; }
.pb-add-note { display: flex; gap: 6px; margin-top: 8px; }
.pb-upcoming-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; margin-bottom: 4px; border-radius: 3px; background: var(--bg3); }
/* Trade form */
.trade-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
.tf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.tf-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
.tf-grid-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
.tf-field { display: flex; flex-direction: column; gap: 3px; }
.tf-label { font-family: var(--mono); font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
/* Calendar view */
.cal-nav { display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 12px; }
.cal-title { font-family: var(--mono); font-size: 14px; color: var(--text); font-weight: 500; min-width: 160px; text-align: center; }
.cal-header { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; margin-bottom: 2px; }
.cal-header div { font-family: var(--mono); font-size: 10px; color: var(--muted); text-align: center; padding: 4px; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; }
.cal-cell { background: var(--bg3); border: 1px solid var(--border); min-height: 80px; padding: 4px; border-radius: 3px; }
.cal-empty { background: transparent; border-color: transparent; }
.cal-today { border-color: var(--accent); }
.cal-day { font-family: var(--mono); font-size: 11px; color: var(--muted2); margin-bottom: 2px; }
.cal-today .cal-day { color: var(--accent); font-weight: 500; }
.cal-trade { font-family: var(--mono); font-size: 8px; padding: 2px 3px; border-radius: 2px; margin-bottom: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cal-entry { background: rgba(34,197,94,0.15); color: var(--green); border-left: 2px solid var(--green); }
.cal-exit { background: rgba(239,68,68,0.15); color: var(--red); border-left: 2px solid var(--red); }
.cal-active { background: rgba(56,189,248,0.08); color: var(--accent); }
.cal-legend { display: flex; gap: 16px; margin-top: 8px; font-family: var(--mono); font-size: 10px; color: var(--muted); justify-content: center; }
.cal-leg { display: flex; align-items: center; gap: 4px; }
.cal-dot { width: 8px; height: 8px; border-radius: 2px; }
.cal-dot-entry { background: rgba(34,197,94,0.4); border-left: 2px solid var(--green); }
.cal-dot-exit { background: rgba(239,68,68,0.4); border-left: 2px solid var(--red); }
.cal-dot-active { background: rgba(56,189,248,0.15); }
.rb-tooltip { position: absolute; z-index: 50; background: rgba(20,22,32,0.97); border: 1px solid rgba(60,65,85,0.8); border-radius: 5px; padding: 8px 12px; font-family: var(--mono); font-size: 10px; pointer-events: none; min-width: 120px; box-shadow: 0 4px 16px rgba(0,0,0,0.5); }
.rb-tt-row { display: flex; justify-content: space-between; gap: 16px; padding: 1px 0; color: var(--muted2); }
.rb-tt-divider { height: 1px; background: var(--border); margin: 3px 0; }
`;
