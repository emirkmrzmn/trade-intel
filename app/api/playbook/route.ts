import { NextResponse } from 'next/server';
import { redis } from '@/app/lib/redis';
import { checkAuth } from '@/app/lib/auth';

const KV_KEY = 'playbook:trades';
const ARCHIVE_KEY = 'playbook:archive';

export async function GET(req: any) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const trades = await redis.get(KV_KEY) || [];
  const archive = await redis.get(ARCHIVE_KEY) || [];
  return NextResponse.json({ trades, archive });
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
    // Archive the trade instead of hard-deleting
    const { id } = body;
    const trade = trades.find((t: any) => t.id === id);
    if (trade) {
      const archive: any[] = (await redis.get(ARCHIVE_KEY) as any[]) || [];
      // Build DD/MM seasonal date from entryDate (YYYY-MM-DD → DD/MM)
      let seasonalDate = '';
      if (trade.entryDate) {
        const parts = trade.entryDate.split('-');
        if (parts.length === 3) seasonalDate = `${parts[2]}/${parts[1]}`;
      }
      archive.push({
        id: trade.id,
        name: trade.name,
        commodity: trade.commodity,
        strategyType: trade.strategyType || '',
        direction: trade.direction || '',
        grade: trade.grade || '',
        summary: trade.summary || '',
        entryDate: trade.entryDate || '',
        plannedExitDate: trade.plannedExitDate || '',
        seasonalDate,
        notes: trade.notes || [],
        archivedAt: new Date().toISOString(),
      });
      await redis.set(ARCHIVE_KEY, archive);
    }
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

  // Archive note management
  if (action === 'addArchiveNote') {
    const { id, text } = body;
    const archive: any[] = (await redis.get(ARCHIVE_KEY) as any[]) || [];
    const idx = archive.findIndex((t: any) => t.id === id);
    if (idx === -1) return NextResponse.json({ error: 'Archived trade not found' }, { status: 404 });
    if (!archive[idx].notes) archive[idx].notes = [];
    archive[idx].notes.push({ text, ts: new Date().toISOString() });
    await redis.set(ARCHIVE_KEY, archive);
    return NextResponse.json({ ok: true });
  }

  if (action === 'deleteArchive') {
    const { id } = body;
    const archive: any[] = (await redis.get(ARCHIVE_KEY) as any[]) || [];
    const filtered = archive.filter((t: any) => t.id !== id);
    await redis.set(ARCHIVE_KEY, filtered);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
