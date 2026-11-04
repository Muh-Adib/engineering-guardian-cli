// Lightweight lexer that replaces string literals, template literals, regex
// literals, and comments with spaces while preserving character offsets and
// newlines. Rules can then match against the masked text without producing
// findings for code that only appears inside strings or comments.
//
// This is a heuristic pre-pass, not a full parser: it keeps the scanner
// dependency-free and deterministic. Known limitations (tracked in the
// roadmap for an AST-based rewrite): exotic regex/division ambiguity and
// code hidden inside template interpolations of masked templates.

type Context =
  | { kind: 'code-root' }
  | { kind: 'code-interp'; depth: number }
  | { kind: 'line' }
  | { kind: 'block' }
  | { kind: 'single' }
  | { kind: 'double' }
  | { kind: 'template' }
  | { kind: 'regex'; inClass: boolean };

const REGEX_PRECEDING_CHARS = new Set(['=', '(', '[', '{', ';', ',', ':', '!', '&', '|', '?', '+', '-', '*', '%', '^', '~', '<', '>']);
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'
]);

export function maskLiteralsAndComments(source: string): string {
  const chars = source.split('');
  const stack: Context[] = [{ kind: 'code-root' }];
  let prevSignificant = '';
  let prevWord = '';

  const mask = (index: number) => {
    if (chars[index] !== '\n') chars[index] = ' ';
  };

  const track = (ch: string) => {
    if (/\s/.test(ch)) return;
    prevSignificant = ch;
    if (/[A-Za-z0-9_$]/.test(ch)) prevWord += ch;
    else prevWord = '';
  };

  for (let i = 0; i < chars.length; i += 1) {
    const context = stack[stack.length - 1];
    const ch = chars[i];
    const next = chars[i + 1] ?? '';

    if (context.kind === 'code-root' || context.kind === 'code-interp') {
      if (ch === '/' && next === '/') { mask(i); mask(i + 1); i += 1; stack.push({ kind: 'line' }); continue; }
      if (ch === '/' && next === '*') { mask(i); mask(i + 1); i += 1; stack.push({ kind: 'block' }); continue; }
      if (ch === "'") { mask(i); stack.push({ kind: 'single' }); continue; }
      if (ch === '"') { mask(i); stack.push({ kind: 'double' }); continue; }
      if (ch === '`') { mask(i); stack.push({ kind: 'template' }); continue; }
      if (ch === '/' && regexCanStart()) { mask(i); stack.push({ kind: 'regex', inClass: false }); continue; }
      if (context.kind === 'code-interp') {
        if (ch === '{') { context.depth += 1; track(ch); continue; }
        if (ch === '}') {
          if (context.depth === 0) { mask(i); stack.pop(); continue; }
          context.depth -= 1;
        }
      }
      track(ch);
      continue;
    }

    if (context.kind === 'line') {
      if (ch === '\n') stack.pop();
      else mask(i);
      continue;
    }

    if (context.kind === 'block') {
      if (ch === '*' && next === '/') { mask(i); mask(i + 1); i += 1; stack.pop(); }
      else mask(i);
      continue;
    }

    if (context.kind === 'single' || context.kind === 'double') {
      if (ch === '\\') { mask(i); if (next !== '' && next !== '\n') mask(i + 1); i += 1; continue; }
      if (ch === '\n') { stack.pop(); continue; } // unterminated literal safety
      if ((context.kind === 'single' && ch === "'") || (context.kind === 'double' && ch === '"')) { mask(i); stack.pop(); continue; }
      mask(i);
      continue;
    }

    if (context.kind === 'template') {
      if (ch === '\\') { mask(i); if (next !== '' && next !== '\n') mask(i + 1); i += 1; continue; }
      if (ch === '`') { mask(i); stack.pop(); continue; }
      if (ch === '$' && next === '{') { mask(i); mask(i + 1); i += 1; stack.push({ kind: 'code-interp', depth: 0 }); continue; }
      mask(i);
      continue;
    }

    if (context.kind === 'regex') {
      if (ch === '\\') { mask(i); mask(i + 1); i += 1; continue; }
      if (ch === '[') { context.inClass = true; mask(i); continue; }
      if (ch === ']') { context.inClass = false; mask(i); continue; }
      if (ch === '/' && !context.inClass) { mask(i); stack.pop(); continue; }
      if (ch === '\n') { stack.pop(); continue; } // was division after all
      mask(i);
      continue;
    }
  }

  function regexCanStart(): boolean {
    if (prevSignificant === '') return true;
    if (REGEX_PRECEDING_CHARS.has(prevSignificant)) return true;
    return REGEX_PRECEDING_KEYWORDS.has(prevWord);
  }

  return chars.join('');
}
