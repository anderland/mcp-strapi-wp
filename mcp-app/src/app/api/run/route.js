import { NextResponse } from 'next/server';
import { rulesetPipeline } from '../../lib/ruleset-pipeline.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const body = await req.json();
    const { text, stage = 0, options = {} } = body || {};
    if (!text || String(text).trim().length < 10) {
      return NextResponse.json(
        { error: 'The souece text must be at least 10 characters' },
        { status: 400 }
      );
    }
    const clamp = !!options.clamp1500;
    const clipped = clamp ? String(text).slice(0, 1500) : String(text);

    const res = await rulesetPipeline.invoke({ text: clipped, stage });
    const llmRewrite = res?.rewrite?.text || clipped;
    const corrected = llmRewrite;

    const agent = {
      version: res?.version || 'ap-demo/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      catalog_version: res?.catalog_version,
      stage,
      findings_count: (res?.analysis?.findings || []).length,
      tone: res?.analysis?.tone || { polarity: 'neutral', confidence: 0.5 },
      status: 'ok',
      errors: [],
    };

    const report = agent;

    return NextResponse.json({
      success: true,
      result: { corrected_text: corrected, report, agent, full: res },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
