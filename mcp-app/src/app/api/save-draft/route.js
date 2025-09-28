import { NextResponse } from 'next/server';
import { getClients } from '@/mcp/clients.js';
import { toBlocks } from '@/app/lib/to-blocks.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      provider = 'strapi',
      title,
      source_text,
      corrected_text,
      report,
      metadata = {},
    } = body || {};
    const { strapi, wp } = await getClients();
    const client = provider === 'wp' ? wp : strapi;
    if (!client)
      return NextResponse.json(
        { success: false, error: `${provider} MCP not available` },
        { status: 503 }
      );
    const tool = provider === 'wp' ? 'wp_save_draft' : 'save_draft';

    const makeStamp = () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const ts = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(
        d.getUTCDate()
      )}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(
        d.getUTCSeconds()
      )}`;
      const rnd = Math.random().toString(36).slice(2, 8);
      return `content-${ts}-${rnd}`;
    };
    const safeTitle = title && title.trim() ? title.trim() : makeStamp();

    const slugify = (s) =>
      (s || '')
        .toString()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
    const slug = slugify(safeTitle) || safeTitle.toLowerCase();

    const toHtml = (plain) => {
      const text = String(plain ?? '').trim();
      if (!text) return '<p></p>';
      const esc = (s) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return text
        .split(/\n{2,}/)
        .map((p) => `<p>${esc(p).replace(/\n/g, '<br />')}</p>`)
        .join('\n');
    };

    const args =
      provider === 'wp'
        ? {
            title: safeTitle,
            content: toHtml(corrected_text || ''),
          }
        : {
            title: safeTitle,
            slug,
            source_text: toBlocks(source_text || ''),
            generated_text: toBlocks(corrected_text || ''),
            report: report || {},
            metadata,
          };

    const result = await client.callTool({ name: tool, arguments: args });
    const rawText = result?.content?.[0]?.text || '';
    if (result?.isError) {
      return NextResponse.json(
        { success: false, provider, error: rawText || 'MCP tool error' },
        { status: 502 }
      );
    }
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = rawText;
    }
    return NextResponse.json({ success: true, provider, data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
