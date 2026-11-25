/**
 * Smart formatting: the cleanup model writes lists, paragraphs and **bold** as Markdown. This turns that Markdown
 * into plain text for apps that only take text, and into HTML for apps that accept rich paste (Word, Outlook, Gmail,
 * Slack, Teams, Notion), so the formatting survives where it can and never shows up as stray symbols where it cannot.
 */

const BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

/** True when the text carries list, paragraph or bold formatting worth pasting as rich text. */
export function hasMarkup(md: string): boolean {
  return new RegExp(BOLD.source).test(md.replace(/\n/g, ' ')) || /^\s{0,3}([-*•]|\d{1,3}[.)])\s+\S/m.test(md) || /\n\s*\n/.test(md.trim());
}

/** Plain text: "- " bullets, "1." numbers, blank lines between paragraphs, and no ** or # symbols. */
export function markdownToPlain(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n').map((raw) => {
    const heading = HEADING.exec(raw);
    const line = heading ? heading[1]! : raw;
    const bullet = BULLET.exec(line);
    if (bullet && !/^\s*\*\*/.test(line)) return `- ${bullet[1]!.trim()}`;
    const numbered = NUMBERED.exec(line);
    if (numbered) return `${numbered[1]}. ${numbered[2]!.trim()}`;
    return line.replace(/[ \t]+$/g, '');
  });
  return lines
    .join('\n')
    .replace(BOLD, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escapes the text first, so nothing the model or the speaker wrote can become markup, then applies **bold**. */
const inline = (s: string): string => escapeHtml(s).replace(BOLD, '<b>$1</b>');

/** HTML: paragraphs, bullet and numbered lists, and bold. Every character of text is escaped. */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let paragraph: string[] = [];
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = HEADING.exec(raw);
    const line = heading ? heading[1]! : raw;
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet && !/^\s*\*\*/.test(line)) {
      flushParagraph();
      if (list?.tag !== 'ul') (flushList(), (list = { tag: 'ul', items: [] }));
      list!.items.push(inline(bullet[1]!.trim()));
    } else if (numbered) {
      flushParagraph();
      if (list?.tag !== 'ol') (flushList(), (list = { tag: 'ol', items: [] }));
      list!.items.push(inline(numbered[2]!.trim()));
    } else if (!line.trim()) {
      flushList();
      flushParagraph();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushList();
  flushParagraph();
  return out.join('');
}

/** Plain text and rich HTML for the same Markdown; `html` is set only when there is formatting to keep. */
export function renderMarkdown(md: string): { text: string; html?: string } {
  const text = markdownToPlain(md);
  return hasMarkup(md) ? { text, html: markdownToHtml(md) } : { text };
}

/** One piece of an answer: prose, or a fenced code block with its language label. */
export type AnswerPart = { kind: 'text'; text: string } | { kind: 'code'; text: string; lang: string };

const FENCE = /^```([A-Za-z0-9_+#.-]*)[ \t]*\n([\s\S]*?)\n?```[ \t]*$/gm;

/** Splits an answer at its fenced code blocks, in order. An unclosed block is treated as code to the end. */
export function splitAnswer(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const closed = text.endsWith(NL) ? text : text + NL;
  // An unclosed fence at the end still counts, so a clipped answer does not print its code as prose.
  const source = ((closed.match(/^```/gm) ?? []).length % 2 === 1) ? closed + "```" : closed;
  let last = 0;
  for (const m of source.matchAll(FENCE)) {
    const before = source.slice(last, m.index).replace(/\s+$/, "");
    if (before.trim()) parts.push({ kind: 'text', text: before.replace(/^\s+/, '') });
    parts.push({ kind: 'code', lang: m[1] ?? '', text: m[2] ?? '' });
    last = m.index + m[0].length;
  }
  const rest = source.slice(last).trim();
  if (rest) parts.push({ kind: 'text', text: rest });
  return parts.length ? parts : [{ kind: 'text', text: text.trim() }];
}

const NL = String.fromCharCode(10);

/** The prose of an answer for reading aloud: code blocks are skipped, since code read out loud is noise. */
export function spokenText(text: string): string {
  const parts = splitAnswer(text);
  const prose = parts.filter((p) => p.kind === 'text').map((p) => p.text).join(' ').trim();
  if (!parts.some((p) => p.kind === 'code')) return prose;
  return (prose ? prose + ' ' : '') + 'The code is shown on screen.';
}

export { escapeHtml };
