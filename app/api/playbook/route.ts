import { NextResponse } from 'next/server';
import { redis } from '@/app/lib/redis';
import { checkAuth } from '@/app/lib/auth';

const KV_KEY = 'playbook:trades';

export async function GET(req: any) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const trades = await redis.get(KV_KEY) || [];
  return NextResponse.json({ trades });
}

export async function POST(req: any) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const body = await req.json();
  const { action } = body;
  const trades: any[] = (await redis.get(KV_KEY) as any[]) || [];

  if (action === 'add') {
    const trade = body.trade;
    trade.id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    trade.createdAt = new Date().toISOString();
    trade.updatedAt = new Date().toISOString();
    trade.notes = trade.notes || [];
    trades.push(trade);
    await redis.set(KV_KEY, trades);
    return NextResponse.json({ ok: true, trade });
  }

  if (action === 'update') {
    const { id, updates } = body;
    const idx = trades.findIndex((t: any) => t.id === id);
    if (idx === -1) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    trades[idx] = { ...trades[idx], ...updates, updatedAt: new Date().toISOString() };
    await redis.set(KV_KEY, trades);
    return NextResponse.json({ ok: true, trade: trades[idx] });
  }

  if (action === 'delete') {
    const { id } = body;
    const filtered = trades.filter((t: any) => t.id !== id);
    await redis.set(KV_KEY, filtered);
    return NextResponse.json({ ok: true });
  }

  if (action === 'addNote') {
    const { id, text } = body;
    const idx = trades.findIndex((t: any) => t.id === id);
    if (idx === -1) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    if (!trades[idx].notes) trades[idx].notes = [];
    trades[idx].notes.push({ text, ts: new Date().toISOString() });
    trades[idx].updatedAt = new Date().toISOString();
    await redis.set(KV_KEY, trades);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
