import { NextResponse } from 'next/server';
import { redis } from '@/app/lib/redis';

export const dynamic = 'force-dynamic';

const KV_KEY = 'playbook:trades';
const TELEGRAM_API = 'https://api.telegram.org/bot';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Singapore';

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('Telegram env vars not set');

  const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error: ${err}`);
  }
}

function getNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

function toDateStr(d: Date) {
  return d.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

export async function GET() {
  try {
    const trades = (await redis.get(KV_KEY) as any[]) || [];
    if (!Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ message: 'No trades found', sent: false });
    }

    const today = getNow();
    const entries: any[] = [];
    const exits: any[] = [];
    const upcoming: any[] = [];

    const soon: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(today + 'T12:00:00');
      d.setDate(d.getDate() + i);
      soon.push(toDateStr(d));
    }

    for (const trade of trades) {
      if (trade.status === 'Closed') continue;
      if (trade.entryDate === today) entries.push(trade);
      if (trade.plannedExitDate === today) exits.push(trade);
      if (soon.includes(trade.entryDate)) upcoming.push({ ...trade, _type: 'entry', _date: trade.entryDate });
      if (soon.includes(trade.plannedExitDate)) upcoming.push({ ...trade, _type: 'exit', _date: trade.plannedExitDate });
    }

    if (entries.length === 0 && exits.length === 0 && upcoming.length === 0) {
      return NextResponse.json({ message: 'No trades today or upcoming', sent: false });
    }

    let msg = `📊 *Trade Playbook — ${formatDate(today)}*\n`;

    if (entries.length > 0) {
      msg += `\n🟢 *ENTRIES TODAY:*\n`;
      for (const t of entries) {
        msg += `• *${t.name}* (${t.commodity} ${t.strategyType})\n`;
        if (t.direction) msg += `  Direction: ${t.direction}\n`;
        if (t.summary) msg += `  ${t.summary}\n`;
      }
    }

    if (exits.length > 0) {
      msg += `\n🔴 *EXITS TODAY:*\n`;
      for (const t of exits) {
        msg += `• *${t.name}* (${t.commodity} ${t.strategyType})\n`;
        if (t.summary) msg += `  ${t.summary}\n`;
      }
    }

    if (upcoming.length > 0) {
      msg += `\n📅 *COMING UP (next 3 days):*\n`;
      for (const t of upcoming) {
        const label = t._type === 'entry' ? '🟢 Entry' : '🔴 Exit';
        msg += `• ${label} — *${t.name}* on ${formatDate(t._date)}\n`;
      }
    }

    await sendTelegram(msg);
    return NextResponse.json({ message: 'Notification sent', sent: true, entries: entries.length, exits: exits.length, upcoming: upcoming.length });
  } catch (e: any) {
    console.error('Notify failed:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
