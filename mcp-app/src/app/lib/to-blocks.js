export function toBlocks(plain) {
  const text = String(plain ?? '').trim();
  if (!text)
    return [{ type: 'paragraph', children: [{ type: 'text', text: '' }] }];
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.map((p) => ({
    type: 'paragraph',
    children: [{ type: 'text', text: p.replace(/\n/g, ' ') }],
  }));
}
