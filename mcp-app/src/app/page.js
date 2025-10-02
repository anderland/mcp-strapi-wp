'use client';
import { useState } from 'react';
import Select from '@/components/Select';
import CodeBlock from '@/components/CodeBlock';
import godzilla from '../../data/godzilla.json';
import { ExclamationTriangleIcon } from '@heroicons/react/16/solid';

export default function Home() {
  const [text, setText] = useState('');
  const [result, setResult] = useState('(none)');
  const [provider, setProvider] = useState('strapi');
  const [clamp, setClamp] = useState(true);
  const [drafts, setDrafts] = useState('(none)');
  const [wpDrafts, setWpDrafts] = useState('(none)');
  const [loading, setLoading] = useState({
    run: false,
    save: false,
    strapi: false,
    wp: false,
  });
  const [corrected, setCorrected] = useState('');
  const [report, setReport] = useState(null);
  const [stage, setStage] = useState(0);
  const [humanReview, setHumanReview] = useState(null);
  const [factCheckStatus, setFactCheckStatus] = useState(null);
  const [factCheckTools, setFactCheckTools] = useState(null);
  const [llmError, setLlmError] = useState(false);
  const [susError, setSusError] = useState(false);
  const [fcError, setFcError] = useState(false);

  const run = async () => {
    setLoading((l) => ({ ...l, run: true }));
    try {
      setResult('Running...');
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          stage,
          options: { clamp1500: !!clamp },
        }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
      setCorrected(data?.result?.corrected_text || '');
      setReport(data?.result?.report || null);
      setHumanReview(data?.result?.full?.human_review_recommended || null);
      setFactCheckStatus(data?.result?.report?.fact_check || null);
      setFactCheckTools(data?.result?.full?._workshop?.fact_check_tools || null);

      // Derive non-blocking error badges for UI
      const full = data?.result?.full;
      const rationale = Array.isArray(full?.rewrite?.rationale)
        ? full.rewrite.rationale.map((s) => String(s || '').toLowerCase())
        : [];
      const hrReason = String(full?.human_review_recommended?.reason || '').toLowerCase();
      const susRat = Array.isArray(full?._workshop?.sus?.rationale)
        ? full._workshop.sus.rationale.map((s) => String(s || '').toLowerCase())
        : [];
      const fcErr = Boolean(full?._workshop?.fact_check_tools?.error);

      const llmErr =
        rationale.some((s) => s.includes('fallback: llm error') || s.includes('fallback: invalid json')) ||
        hrReason.includes('invalid json from rewrite agent');
      const susErr = susRat.some((s) => s.includes('sus parse error'));

      setLlmError(llmErr);
      setSusError(susErr);
      setFcError(fcErr);
    } finally {
      setLoading((l) => ({ ...l, run: false }));
    }
  };

  const saveDraft = async () => {
    setLoading((l) => ({ ...l, save: true }));
    try {
      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch {
        parsed = {};
      }
      const body = {
        provider,
        title: '',
        source_text: text,
        corrected_text: corrected,
        report: parsed?.result?.report || parsed?.result || parsed,
      };
      const res = await fetch('/api/save-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResult(JSON.stringify(await res.json(), null, 2));
    } finally {
      setLoading((l) => ({ ...l, save: false }));
    }
  };

  const loadStrapiDrafts = async () => {
    setLoading((l) => ({ ...l, strapi: true }));
    try {
      const res = await fetch(`/api/drafts?provider=strapi`);
      setDrafts(JSON.stringify(await res.json(), null, 2));
    } finally {
      setLoading((l) => ({ ...l, strapi: false }));
    }
  };

  const loadWpDrafts = async () => {
    setLoading((l) => ({ ...l, wp: true }));
    try {
      const res = await fetch(`/api/drafts?provider=wp`);
      setWpDrafts(JSON.stringify(await res.json(), null, 2));
    } finally {
      setLoading((l) => ({ ...l, wp: false }));
    }
  };

  return (
    <>
      <div className=' py-24 sm:py-32 dark:bg-gray-900'>
        <div className='mx-auto max-w-7xl px-6 lg:px-8'>
          <div className='mx-auto max-w-2xl lg:mx-0 lg:max-w-none'>
            <p className='text-base/7 font-display font-semibold text-blue-600 dark:text-blue-400'>
              Newsroom AI Catalyst
            </p>
            <h1 className='mt-2 text-4xl font-semibold tracking-tight text-pretty text-gray-900 sm:text-5xl dark:text-white'>
              Agent + MCP Workflow
            </h1>
            <div className='mt-10 font-sans grid max-w-xl grid-cols-1 gap-8 text-base/7 text-gray-700 lg:max-w-none lg:grid-cols-2 dark:text-gray-300'>
              <div>
                <p>
                  Run a copy-editing agent on a source text; validate edits
                  against a ruleset (e.g. AP Stylebook) retrieved via API; then
                  write the revised draft to Strapi or WordPress via MCP.
                </p>
              </div>
              <div className='text-right'>
                <p className='text-[11px] font-mono'>Version 0.3</p>
              </div>
            </div>
            <div className='mt-10'>
              <div>
                <div className='flex items-center justify-between'>
                  <label
                    htmlFor='source-text'
                    className='block text-sm font-medium font-display text-gray-900 dark:text-white'
                  >
                    Source Text
                  </label>
                  <label
                    htmlFor='clamp'
                    className='inline-flex items-center gap-2 text-sm text-gray-900 dark:text-white'
                  >
                    <input
                      id='clamp'
                      name='clamp'
                      type='checkbox'
                      checked={clamp}
                      onChange={(e) => setClamp(e.target.checked)}
                      className='size-4 rounded border border-gray-300 text-blue-600 focus:ring-blue-600 dark:border-white/10'
                    />
                    Limit input to 1500 characters
                  </label>
                </div>
                <textarea
                  id='source-text'
                  rows={8}
                  placeholder='Paste text here...'
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className='mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-600 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-gray-500 dark:focus:ring-blue-500'
                />
              </div>
            </div>
            <div className='mt-5'>
              <div className='flex items-center gap-3 justify-between'>
                <button
                  onClick={run}
                  disabled={loading.run}
                  type='button'
                  className='rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-500 dark:shadow-none dark:focus-visible:outline-blue-500'
                >
                  {loading.run ? 'Running…' : 'Run'}
                </button>
                <div>
                  <Select
                    value={String(stage)}
                    onChange={(v) => setStage(Number(v))}
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <option key={n} value={String(n)}>{`Stage ${n}`}</option>
                    ))}
                  </Select>
                  <p className='mt-1 text-[11px] text-gray-500 dark:text-gray-400'>
                    Fact-check triggers at Stage 6.
                  </p>
                </div>
              </div>
            </div>

            <div className='mt-10'>
              <div className='flex items-center justify-between'>
                <label
                  htmlFor='output-text'
                  className='block text-sm font-medium font-display text-gray-900 dark:text-white'
                >
                  Output Text
                </label>
                <div className='flex items-center gap-2 mb-0.5'>
                  {factCheckStatus?.enabled && (
                    <span
                      className='inline-flex items-center gap-x-1.5 rounded-md px-2 py-1 text-xs font-normal text-gray-900 inset-ring inset-ring-gray-200 dark:text-white dark:inset-ring-white/10'
                      title={factCheckStatus?.used ? 'Fact-check used for this run' : 'Fact-check enabled'}
                    >
                      <svg viewBox='0 0 16 16' aria-hidden='true' className='size-3 fill-green-600 dark:fill-green-400'>
                        <path d='M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm3.78 5.72a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 0 1 1.06-1.06L6.5 9.19l3.72-3.72a.75.75 0 0 1 1.06 0Z' />
                      </svg>
                      Fact-check {factCheckStatus?.used ? 'active' : 'enabled'}
                      {factCheckTools?.signals?.review_count > 0 && (
                        <span className='ml-1 text-[10px] text-gray-600 dark:text-gray-400'>
                          • {factCheckTools.signals.review_count} review{factCheckTools.signals.review_count === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                  )}

                  {llmError && (
                    <span
                      className='inline-flex items-center gap-x-1.5 rounded-md px-2 py-1 text-xs font-normal text-red-700 inset-ring inset-ring-red-200 dark:text-red-300 dark:inset-ring-red-900/40'
                      title='Model output could not be parsed as JSON. Output suppressed.'
                    >
                      <svg viewBox='0 0 16 16' aria-hidden='true' className='size-3 fill-red-600 dark:fill-red-400'>
                        <path d='M8.982 1.566a1.5 1.5 0 0 0-1.964 0L.165 7.154c-.89.79-.325 2.29.982 2.29h13.706c1.307 0 1.872-1.5.982-2.29L8.982 1.566zM8 5c.414 0 .75.336.75.75v3.5a.75.75 0 0 1-1.5 0v-3.5C7.25 5.336 7.586 5 8 5zm0 7a1 1 0 1 1 0-2 1 1 0 0 1 0 2z'/>
                      </svg>
                      Model JSON error
                    </span>
                  )}

                  {susError && (
                    <span
                      className='inline-flex items-center gap-x-1.5 rounded-md px-2 py-1 text-xs font-normal text-yellow-800 inset-ring inset-ring-yellow-200 dark:text-yellow-300 dark:inset-ring-yellow-900/40'
                      title='SUS agent output could not be parsed.'
                    >
                      <svg viewBox='0 0 16 16' aria-hidden='true' className='size-3 fill-yellow-600 dark:fill-yellow-400'>
                        <path d='M7.001 1.5a1 1 0 0 1 1.998 0l.37 7.403a1 1 0 0 1-1 .997H7.63a1 1 0 0 1-1-.997L7 1.5h.001zM9 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0z'/>
                      </svg>
                      SUS parse error
                    </span>
                  )}

                  {fcError && (
                    <span
                      className='inline-flex items-center gap-x-1.5 rounded-md px-2 py-1 text-xs font-normal text-yellow-800 inset-ring inset-ring-yellow-200 dark:text-yellow-300 dark:inset-ring-yellow-900/40'
                      title='Fact-check tools reported an error (see JSON report for details).'
                    >
                      <svg viewBox='0 0 16 16' aria-hidden='true' className='size-3 fill-yellow-600 dark:fill-yellow-400'>
                        <path d='M7.001 1.5a1 1 0 0 1 1.998 0l.37 7.403a1 1 0 0 1-1 .997H7.63a1 1 0 0 1-1-.997L7 1.5h.001zM9 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0z'/>
                      </svg>
                      Fact-check error
                    </span>
                  )}

                  {humanReview?.flag && stage >= 6 && (
                    <span
                      className={`inline-flex items-center gap-x-1.5 rounded-md px-2 py-1 text-xs font-normal text-gray-900 inset-ring inset-ring-gray-200 dark:text-white dark:inset-ring-white/10 ${
                        humanReview.severity === 'critical' ? ' ' : ' '
                      }`}
                      title={humanReview.recommendation}
                    >
                      <svg
                        viewBox='0 0 6 6'
                        aria-hidden='true'
                        className={`size-1.5  ${
                          humanReview.severity === 'critical'
                            ? 'fill-red-500 dark:fill-red-400'
                            : 'fill-yellow-500 dark:fill-yellow-400'
                        }`}
                      >
                        <circle r={3} cx={3} cy={3} />
                      </svg>
                      Human review{' '}
                      {humanReview.severity === 'critical'
                        ? 'required'
                        : 'recommended'}
                    </span>
                  )}
                </div>
              </div>

              <textarea
                rows={6}
                value={corrected}
                onChange={(e) => setCorrected(e.target.value)}
                className='mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-600 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-gray-500 dark:focus:ring-blue-500'
                placeholder='The text will appear here after Run...'
              />
            </div>

            <div className='mt-5'>
              <div className='flex items-center space-x-2'>
                <div>Save to</div>

                <Select value={provider} onChange={setProvider} />

                <button
                  onClick={saveDraft}
                  disabled={loading.save}
                  type='button'
                  className='rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-500 dark:shadow-none dark:focus-visible:outline-blue-500'
                >
                  {loading.save ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            <div className='mt-10'>
              <div className='block text-sm font-medium font-display text-gray-900 dark:text-white'>
                Report
              </div>
              <CodeBlock
                label='JSON'
                language='json'
                code={result}
                collapse
                className='mt-2'
              />
            </div>
            <div className='mt-10'>
              <div className='flex items-center justify-between'>
                <div className='block text-sm font-medium font-display text-gray-900 dark:text-white'>
                  Strapi
                </div>
                <button
                  onClick={loadStrapiDrafts}
                  disabled={loading.strapi}
                  type='button'
                  className='rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20'
                >
                  {loading.strapi ? 'Loading…' : 'Load Drafts'}
                </button>
              </div>
              <CodeBlock
                label='JSON'
                language='json'
                code={drafts}
                collapse
                className='mt-2'
              />
            </div>
            <div className='mt-10'>
              <div className='flex items-center justify-between'>
                <div className='block text-sm font-medium font-display text-gray-900 dark:text-white'>
                  WordPress
                </div>
                <button
                  onClick={loadWpDrafts}
                  disabled={loading.wp}
                  type='button'
                  className='rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20'
                >
                  {loading.wp ? 'Loading…' : 'Load WP Drafts'}
                </button>
              </div>
              <CodeBlock
                label='JSON'
                language='json'
                code={wpDrafts}
                collapse
                className='mt-2'
              />
            </div>

            <div className='mt-10'>
              <label
                htmlFor='output-text'
                className='block text-sm font-medium font-display text-gray-900 dark:text-white'
              >
                Test Snippets
              </label>
              <div className='mt-1 space-y-3'>
                {(godzilla || []).map((item, idx) => (
                  <div
                    key={item.id ?? item.slug ?? item.key ?? idx}
                    className='rounded-md border border-gray-300 bg-white p-3 text-sm dark:border-white/10 dark:bg-white/5'
                  >
                    <div className='font-medium text-gray-900 dark:text-white'>
                      {item.title || item.label || `Scenario ${idx + 1}`}
                    </div>
                    <pre className='mt-2 whitespace-pre-wrap break-words text-gray-900 dark:text-white'>
                      {item.text || ''}
                    </pre>
                    {Array.isArray(item.traps) && item.traps.length > 0 && (
                      <>
                        <div className='mt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'>
                          Traps
                        </div>
                        <ul className='mt-1 list-disc pl-5 text-gray-700 dark:text-gray-300'>
                          {item.traps.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ))}
                {(!godzilla || godzilla.length === 0) && (
                  <div className='rounded-md border border-dashed border-gray-300 p-3 text-gray-500 dark:border-white/10'>
                    No snippets found in <code>data/godzilla.json</code>.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
