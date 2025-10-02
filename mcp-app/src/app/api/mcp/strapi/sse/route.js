import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

// NOTE: This is an initial SSE scaffold. It establishes an SSE stream for clients.
// In the next iteration, we'll wire this to @modelcontextprotocol/sdk's SSE transport
// and the Strapi MCP Server implementation.

export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Initial comment to open the stream
      controller.enqueue(encoder.encode(': connected\n\n'));
      // Keep-alive pings
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch (_) {
          // ignore
        }
      }, 15000);
      // Store cleanup on controller
      controller._interval = interval;
    },
    cancel() {
      // Clean up if client disconnects
      if (this._interval) clearInterval(this._interval);
    },
  });
  return new Response(stream, { status: 200, headers: sseHeaders() });
}

export async function POST(req) {
  // Placeholder endpoint for incoming client messages (JSON-RPC over HTTP)
  // We'll connect this to the MCP server in a follow-up step.
  try {
    const body = await req.text();
    return NextResponse.json({ ok: true, received: Boolean(body) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
