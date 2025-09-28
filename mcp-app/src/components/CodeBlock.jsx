'use client';

import hljs from 'highlight.js/lib/common';
import { useMemo, useState, useEffect, useRef } from 'react';

const LANG_ALIASES = {
  css: 'css',
  json: 'json',
  js: 'javascript',
  javascript: 'javascript',
  html: 'xml',
  xml: 'xml',
  plaintext: 'plaintext',
  text: 'plaintext',
};

export default function CodeSyntaxDisplay({
  code = '',
  language = 'css',
  label = 'CSS Snippet',
  result,
  className,
  collapsible = true,
  collapsedMaxPx = 288,
}) {
  const hasResult = typeof result !== 'undefined' && result !== null;

  const langInput = hasResult ? 'json' : language;

  const codeToRender = useMemo(() => {
    return hasResult ? JSON.stringify(result, null, 2) : code ?? '';
  }, [hasResult, result, code]);

  const labelToShow = useMemo(() => {
    if (hasResult && (!label || label === 'CSS Snippet')) return 'JSON Result';
    return label || 'Code Snippet';
  }, [hasResult, label]);

  const normalizedLang = useMemo(() => {
    const key = String(langInput).toLowerCase();
    return LANG_ALIASES[key] || key || 'plaintext';
  }, [langInput]);

  const { html, detectedLang } = useMemo(() => {
    try {
      if (normalizedLang && hljs.getLanguage(normalizedLang)) {
        const { value } = hljs.highlight(codeToRender, {
          language: normalizedLang,
        });
        return { html: value, detectedLang: normalizedLang };
      }
      const res = hljs.highlightAuto(codeToRender, [
        'json',
        'css',
        'xml',
        'javascript',
      ]);
      return { html: res.value, detectedLang: res.language || 'plaintext' };
    } catch {
      const safe = (codeToRender || '').replace(
        /[<>&]/g,
        (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c])
      );
      return { html: safe, detectedLang: 'plaintext' };
    }
  }, [codeToRender, normalizedLang]);

  const contentRef = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!collapsible) return;
    const el = contentRef.current;
    if (!el) return;
    const check = () => setIsOverflowing(el.scrollHeight > collapsedMaxPx + 8);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [codeToRender, collapsible, collapsedMaxPx, normalizedLang]);

  const [copied, setCopied] = useState(false);

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeToRender);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = codeToRender;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        alert(
          "Copy isn't available programmatically in this browser. The text is selected—press ⌘/Ctrl+C to copy."
        );
        document.body.removeChild(ta);
      } catch (e) {
        console.warn('Copy failed and no fallback available:', e);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <div className={`code-syntax-wrapper ${className}`}>
      <div className='relative rounded-md border border-neutral-200 dark:border-neutral-600'>
        <div className='grid w-full grid-cols-2 rounded-t-md border-b border-neutral-200 bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800'>
          <div className='flex'>
            <span className='inline-block w-full max-w-[12rem] truncate px-3 py-2 text-left text-sm font-medium text-neutral-800 dark:text-white'>
              {labelToShow}
            </span>
          </div>
          <div className='flex items-center justify-end'>
            <button
              type='button'
              onClick={doCopy}
              className='copy-to-clipboard-button flex items-center border-l border-neutral-200 bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-600 hover:text-blue-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:text-white'
              title={copied ? 'Copied!' : 'Copy to clipboard'}
            >
              <svg
                className='mr-2 h-3.5 w-3.5'
                aria-hidden='true'
                xmlns='http://www.w3.org/2000/svg'
                fill='currentColor'
                viewBox='0 0 18 20'
              >
                <path d='M5 9V4.13a2.96 2.96 0 0 0-1.293.749L.879 7.707A2.96 2.96 0 0 0 .13 9H5Zm11.066-9H9.829a2.98 2.98 0 0 0-2.122.879L7 1.584A.987.987 0 0 0 6.766 2h4.3A3.972 3.972 0 0 1 15 6v10h1.066A1.97 1.97 0 0 0 18 14V2a1.97 1.97 0 0 0-1.934-2Z' />
                <path d='M11.066 4H7v5a2 2 0 0 1-2 2H0v7a1.969 1.969 0 0 0 1.933 2h9.133A1.97 1.97 0 0 0 13 18V6a1.97 1.97 0 0 0-1.934-2Z' />
              </svg>
              <span className='copy-text'>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
        </div>

        <div className='relative'>
          <div
            className={`overflow-hidden ${
              collapsible && !expanded ? '' : 'max-h-none'
            }`}
            style={
              collapsible && !expanded
                ? { maxHeight: collapsedMaxPx }
                : undefined
            }
            tabIndex={-1}
          >
            <div ref={contentRef} className='m-0 w-full overflow-x-auto'>
              <pre className='hljs m-0 w-full overflow-x-auto px-4 py-4 text-[13px] leading-relaxed'>
                <code
                  className={`language-${detectedLang || normalizedLang}`}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </pre>
            </div>
          </div>

          {collapsible && isOverflowing && !expanded && (
            <>
              <div className='pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-neutral-900 to-transparent dark:from-neutral-800' />
              <button
                type='button'
                onClick={() => setExpanded(true)}
                className='absolute bottom-0 left-0 w-full border-t border-neutral-200 bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-100 hover:text-blue-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white'
              >
                Expand code
              </button>
            </>
          )}

          {collapsible && isOverflowing && expanded && (
            <button
              type='button'
              onClick={() => setExpanded(false)}
              className='w-full border-t border-neutral-200 bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-100 hover:text-blue-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white'
            >
              Collapse
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
