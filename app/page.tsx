'use client';

import { useEffect, useRef, useCallback } from 'react';

export default function Dashboard() {
  const appRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    tab: string;
    modal: boolean;
    parseMsg: { ok: boolean; msg: string; product?: string } | null;
    data: DashboardData;
  }>({
    tab: 'OVERVIEW',
    modal: false,
    parseMsg: null,
    data: buildDefault(),
  });

  const render = useCallback(() => {
    if (!appRef.current) return;
    const { tab, modal, parseMsg, data } = stateRef.current;
    const tabs = PRODUCTS.map(
      (p) =>
        `<div class="tab${tab === p ? ' active' : ''}" data-tab="${p}">${PRODUCT_LABELS[p] || p}</div>`
    ).join('');
    const content = tab === 'OVERVIEW' ? renderOverview(data) : renderProduct(data, tab);
    const modalHTML = modal ? renderModal(parseMsg) : '';

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
      ${modalHTML}`;

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

    function closeModal() {
      stateRef.current.modal = false;
      stateRef.current.parseMsg = null;
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
          fetch('/api/data')
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

  useEffect(() => {
    // Load data from API
    fetch('/api/data')
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
      fetch('/api/data')
        .then((r) => r.json())
        .then((json) => {
          if (json.products) {
            stateRef.current.data.products = json.products;
            render();
          }
        })
        .catch(() => {});
    }, 60000);

    return () => {
      clearInterval(clockInterval);
      clearInterval(pollInterval);
    };
  }, [render]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div id="app" ref={appRef} />
    </>
  );
}

// --- Types ---
interface Percentile { label: string; value: number }
interface Idea { name: string; direction: string; rationale: string; confidence: string }
interface DateEntry { date: string; label: string; note: string; urgency: string }
interface Position { instrument: string; direction: string; qty: string; entry: string; pnl: string }
interface ProductData {
  regime: string | null;
  regimeType: string;
  percentiles: Percentile[];
  outlook: string[];
  ideas: Idea[];
  dates: DateEntry[];
  positions: Position[];
  lastUpdated: string | null;
}
interface DashboardData {
  lastSaved: string | null;
  positions: Position[];
  products: Record<string, ProductData>;
}

// --- Constants ---
const PRODUCTS = ['OVERVIEW', 'FCPO', 'NG', 'ZM', 'ZL', 'HE', 'GF', 'LE', 'ZC', 'ZS', 'ZW'];
const PRODUCT_LABELS: Record<string, string> = {
  OVERVIEW: 'OVERVIEW', FCPO: 'FCPO', NG: 'NAT GAS', ZM: 'SOY MEAL', ZL: 'SOY OIL',
  HE: 'LEAN HOG', GF: 'FEEDER CTL', LE: 'LIVE CTL', ZC: 'CORN', ZS: 'SOYBEANS', ZW: 'WHEAT',
};
const VALID_PRODUCTS = PRODUCTS.filter((p) => p !== 'OVERVIEW');

function buildDefault(): DashboardData {
  const data: DashboardData = { lastSaved: null, positions: [], products: {} };
  VALID_PRODUCTS.forEach((p) => {
    data.products[p] = {
      regime: null, regimeType: 'neutral', percentiles: [], outlook: [],
      ideas: [], dates: [], positions: [], lastUpdated: null,
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

function confClass(c: string) {
  if (!c) return 'conf-med';
  const l = c.toLowerCase();
  if (l === 'high') return 'conf-high';
  if (l === 'low') return 'conf-low';
  return 'conf-med';
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
  return prod.ideas.map((idea) => `
    <div class="idea-row"><div><div class="idea-name">${esc(idea.name || '')}</div><div class="idea-desc">${esc(idea.rationale || '')}</div></div>
    <div class="idea-meta"><div><span class="conf-badge ${confClass(idea.confidence)}">${esc(idea.confidence || 'MED')}</span></div><div class="idea-dir">${esc(idea.direction || '')}</div></div></div>`).join('');
}

function renderDatesCard(prod: ProductData) {
  if (!prod.dates?.length) return `<div class="empty-state"><div class="em-icon">◈</div><div>No upcoming dates</div><div class="em-cmd">PUSH key dates</div></div>`;
  return prod.dates.map((d) => `
    <div class="date-row"><div class="date-d">${esc(d.date || '')}</div><div style="flex:1"><span class="date-label">${esc(d.label || '')}</span><span class="date-note">${esc(d.note || '')}</span></div><div class="date-urgency ${urgClass(d.urgency)}">${esc(d.urgency || '')}</div></div>`).join('');
}

function renderPositionsCard(prod: ProductData) {
  if (!prod.positions?.length) return `<div class="empty-state"><div class="em-icon">◈</div><div>No open positions</div><div class="em-cmd">PUSH current positions</div></div>`;
  const header = `<div class="pos-row"><div class="pos-header">Instrument</div><div class="pos-header" style="text-align:right">Dir</div><div class="pos-header" style="text-align:right">Qty</div><div class="pos-header" style="text-align:right">Entry</div><div class="pos-header" style="text-align:right">P&L</div></div>`;
  const rows = prod.positions.map((pos) => {
    const pnlClass = pos.pnl && (pos.pnl.startsWith('-') || parseFloat(pos.pnl) < 0) ? 'pos-pnl-neg' : 'pos-pnl-pos';
    const dirClass = (pos.direction || '').toLowerCase() === 'short' ? 'pos-dir-short' : 'pos-dir-long';
    return `<div class="pos-row"><div class="pos-instr">${esc(pos.instrument || '')}</div><div class="${dirClass}" style="text-align:right">${esc((pos.direction || '').toUpperCase())}</div><div class="pos-num">${esc(pos.qty || '')}</div><div class="pos-num">${esc(pos.entry || '')}</div><div class="${pnlClass}">${esc(pos.pnl || '--')}</div></div>`;
  }).join('');
  return header + rows;
}

function renderOverview(data: DashboardData) {
  const allPositions: (Position & { product: string })[] = [];
  VALID_PRODUCTS.forEach((product) => {
    const pd = data.products[product];
    if (pd?.positions?.length) {
      pd.positions.forEach((pos) => allPositions.push({ ...pos, product }));
    }
  });

  const summaryCards = VALID_PRODUCTS.map((product) => {
    const pd = data.products[product];
    const regClass = pd ? regimeClass(pd.regimeType) : 'regime-neutral';
    const regime = pd?.regime ? esc(pd.regime) : '—';
    const ideasCount = pd?.ideas?.length || 0;
    const posCount = pd?.positions?.length || 0;
    const updated = pd?.lastUpdated ? esc(pd.lastUpdated) : 'never';
    return `<div class="card" style="cursor:pointer" data-switch="${product}">
      <div class="card-header"><span class="card-title">${product}</span><span class="last-updated">${updated}</span></div>
      <div class="card-body">
        <div style="margin-bottom:8px"><span class="regime-badge ${regClass}" style="font-size:10px;padding:3px 8px">${regime}</span></div>
        <div style="display:flex;gap:12px;margin-top:6px">
          <span style="font-size:11px;color:var(--muted2)">${ideasCount} idea${ideasCount !== 1 ? 's' : ''}</span>
          <span style="font-size:11px;color:var(--muted2)">${posCount} pos</span>
        </div>
      </div>
    </div>`;
  }).join('');

  let posHTML: string;
  if (allPositions.length) {
    const hdr = `<div class="positions-overview-header"><div class="pos-header">Product</div><div class="pos-header">Instrument</div><div class="pos-header" style="text-align:right">Dir</div><div class="pos-header" style="text-align:right">Qty</div><div class="pos-header" style="text-align:right">Entry</div><div class="pos-header" style="text-align:right">P&L</div></div>`;
    const rows = allPositions.map((pos) => {
      const pnlClass = pos.pnl && (pos.pnl.startsWith('-') || parseFloat(pos.pnl) < 0) ? 'pos-pnl-neg' : 'pos-pnl-pos';
      const dirClass = (pos.direction || '').toLowerCase() === 'short' ? 'pos-dir-short' : 'pos-dir-long';
      return `<div class="pos-overview-row"><div class="pos-product">${pos.product}</div><div class="pos-instr">${esc(pos.instrument || '')}</div><div class="${dirClass}" style="text-align:right">${esc((pos.direction || '').toUpperCase())}</div><div class="pos-num">${esc(pos.qty || '')}</div><div class="pos-num">${esc(pos.entry || '')}</div><div class="${pnlClass}">${esc(pos.pnl || '--')}</div></div>`;
    }).join('');
    posHTML = hdr + rows;
  } else {
    posHTML = `<div class="empty-state"><div class="em-icon">◈</div><div>No open positions across any product</div></div>`;
  }

  return `
    <div class="full-row"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">${summaryCards}</div></div>
    <div class="full-row card"><div class="card-header"><span class="card-title">ALL OPEN POSITIONS</span></div>${posHTML}</div>`;
}

function renderProduct(data: DashboardData, product: string) {
  const prod = data.products[product] || buildDefault().products[VALID_PRODUCTS[0]];
  return `
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">REGIME + PERCENTILES</span>${prod.lastUpdated ? `<span class="last-updated">${esc(prod.lastUpdated)}</span>` : ''}</div><div class="card-body">${renderRegimeCard(prod)}</div></div>
      <div class="card"><div class="card-header"><span class="card-title">FUNDAMENTAL OUTLOOK</span></div><div class="card-body">${renderOutlookCard(prod)}</div></div>
    </div>
    <div class="full-row card"><div class="card-header"><span class="card-title">BEST OPPORTUNITIES</span></div><div class="card-body">${renderIdeasCard(prod)}</div></div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">KEY UPCOMING DATES</span></div><div class="card-body">${renderDatesCard(prod)}</div></div>
      <div class="card"><div class="card-header"><span class="card-title">CURRENT POSITIONS</span></div><div class="card-body">${renderPositionsCard(prod)}</div></div>
    </div>`;
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
            Optional: <code style="color:var(--muted2)">regime</code>, <code>regimeType</code> (bull/bear/neutral/transition), <code>percentiles</code> [{label,value}], <code>outlook</code> [strings], <code>ideas</code> [{name,direction,rationale,confidence}], <code>dates</code> [{date,label,note,urgency}], <code>positions</code> [{instrument,direction,qty,entry,pnl}]
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
    const res = await fetch('/api/push', {
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

// --- Styles (unchanged from original) ---
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
.idea-row { border: 1px solid var(--border); border-radius: 4px; padding: 9px 11px; margin-bottom: 7px; display: grid; grid-template-columns: 1fr auto; align-items: start; gap: 8px; }
.idea-row:last-child { margin-bottom: 0; }
.idea-name { font-family: var(--mono); font-size: 12px; font-weight: 500; color: var(--accent); }
.idea-desc { font-size: 11px; color: var(--muted2); margin-top: 2px; }
.idea-meta { text-align: right; }
.conf-badge { font-family: var(--mono); font-size: 10px; padding: 2px 7px; border-radius: 3px; font-weight: 500; }
.conf-high { background: rgba(34,197,94,0.15); color: var(--green); }
.conf-med { background: rgba(245,158,11,0.15); color: var(--amber); }
.conf-low { background: rgba(100,116,139,0.15); color: var(--muted2); }
.idea-dir { font-family: var(--mono); font-size: 10px; color: var(--muted); margin-top: 3px; }
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
`;
