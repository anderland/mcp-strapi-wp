'use client';
import { useState } from 'react';
import Select from '@/components/Select';
import CodeBlock from '@/components/CodeBlock';
import godzilla from '../../data/godzilla.json';

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

  const run = async () => {
    setLoading((l) => ({ ...l, run: true }));
    try {
      setResult('Running...');
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, stage, options: { clamp1500: !!clamp } }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
      setCorrected(data?.result?.corrected_text || '');
      setReport(data?.result?.report || null);
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
                <p className='text-[11px] font-mono'>Version 0.2</p>
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
                    {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={String(n)}>{`Stage ${n}`}</option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>

            <div className='mt-10'>
              <label
                htmlFor='output-text'
                className='block text-sm font-medium font-display text-gray-900 dark:text-white'
              >
                Output Text
              </label>
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
