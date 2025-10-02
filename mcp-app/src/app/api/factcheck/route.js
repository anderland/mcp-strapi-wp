import { NextResponse } from 'next/server';
import { getClients } from '@/mcp/clients.js';
import { fetchVerification } from '@/mcp/clients.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const body = await req.json();
    const { query, languageCode = 'en', maxAgeDays = 365, pageSize = 3 } = body || {};

    if (!query || !String(query).trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing fact-check query' },
        { status: 400 }
      );
    }

    const { factcheck } = await getClients();
    if (!factcheck) {
      return NextResponse.json(
        { success: false, error: 'FactCheck MCP is not available' },
        { status: 503 }
      );
    }

    const result = await fetchVerification(factcheck, {
      query,
      languageCode,
      maxAgeDays,
      pageSize,
    });

    return NextResponse.json({ success: true, result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
