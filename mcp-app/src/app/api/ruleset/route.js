import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const p = path.resolve(process.cwd(), 'data/ruleset.json');
  const raw = fs.readFileSync(p, 'utf8');
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  const json = JSON.parse(raw);
  return NextResponse.json({ success: true, ruleset: json, version: sha });
}
