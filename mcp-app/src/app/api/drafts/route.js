import { NextResponse } from 'next/server';
import { getClients } from '@/mcp-clients.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get('provider') === 'wp' ? 'wp' : 'strapi';
    const page = Number(searchParams.get('page') || 1);
    const limit = Number(searchParams.get('limit') || 10);

    const { strapi, wp } = await getClients();
    const client = provider === 'wp' ? wp : strapi;
    if (!client)
      return NextResponse.json({
        success: true,
        message: `${provider} MCP not available`,
        items: [],
      });

    const tool = provider === 'wp' ? 'wp_list_drafts' : 'list_drafts';
    const args = { page, limit };
    const result = await client.callTool({ name: tool, arguments: args });
    const text = result?.content?.[0]?.text || '';
    if (result?.isError) {
      return NextResponse.json(
        { success: false, provider, error: text || 'MCP tool error' },
        { status: 502 }
      );
    }
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return NextResponse.json({ success: true, provider, data });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message, items: [] });
  }
}
