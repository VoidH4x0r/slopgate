/**
 * Shared terminal artwork for docs/demo.svg and docs/demo.gif.
 *
 * The content mirrors a real `slopgate fixtures/demo` run; when output changes,
 * update this file and regenerate both assets.
 */
export const COLORS = {
  bg: '#0d1117',
  chrome: '#161b22',
  border: '#30363d',
  fg: '#c9d1d9',
  dim: '#8b949e',
  red: '#ff7b72',
  yellow: '#d29922',
  cyan: '#79c0ff',
  green: '#3fb950',
  prompt: '#3fb950',
};

export const LINE_HEIGHT = 21;
export const X = 26;
export const TOP = 76;
export const WIDTH = 960;

/** @type {Array<{segments: Array<{text: string, color?: string}>, delay: number}>} */
export const LINES = [
  { delay: 0.2, segments: [{ text: '$ ', color: COLORS.prompt }, { text: 'npx @voidh4x0r/slopgate fixtures/demo' }] },
  { delay: 0.9, segments: [] },
  {
    delay: 1.0,
    segments: [
      { text: 'slopgate 0.1.0', color: COLORS.fg },
      { text: '  ·  4 files  ·  41ms', color: COLORS.dim },
    ],
  },
  { delay: 1.15, segments: [] },
  { delay: 1.25, segments: [{ text: 'app.py', color: COLORS.cyan }] },
  {
    delay: 1.35,
    segments: [
      { text: '       4:1  error   high   ', color: COLORS.dim },
      { text: 'py/phantom-import       ', color: COLORS.dim },
      { text: '`helper` is imported but not declared in any manifest', color: COLORS.fg },
    ],
  },
  { delay: 1.45, segments: [{ text: '            │ from helper import format_value', color: COLORS.dim }] },
  {
    delay: 1.55,
    segments: [
      { text: '      14:5  warning high   ', color: COLORS.dim },
      { text: 'py/swallowed-exception  ', color: COLORS.dim },
      { text: '`except` swallows the error silently', color: COLORS.yellow },
    ],
  },
  { delay: 1.65, segments: [{ text: '            │ except Exception:', color: COLORS.dim }] },
  { delay: 1.75, segments: [] },
  { delay: 1.85, segments: [{ text: 'src/agent.ts', color: COLORS.cyan }] },
  {
    delay: 1.95,
    segments: [
      { text: '       8:8  warning high   ', color: COLORS.dim },
      { text: 'ts/stub-function        ', color: COLORS.dim },
      { text: '`stub` throws "not implemented"', color: COLORS.yellow },
    ],
  },
  {
    delay: 2.05,
    segments: [
      { text: '      21:3  error   high   ', color: COLORS.dim },
      { text: 'ts/unreachable          ', color: COLORS.dim },
      { text: 'code after `return` is unreachable', color: COLORS.red },
    ],
  },
  { delay: 2.15, segments: [] },
  {
    delay: 2.3,
    segments: [
      { text: '  13 findings in 3 files', color: COLORS.fg },
      { text: '  ·  4 files scanned in 41ms', color: COLORS.dim },
    ],
  },
  {
    delay: 2.4,
    segments: [{ text: '  4 error · 9 warning · 0 info   (13 high · 0 medium · 0 low confidence)', color: COLORS.dim }],
  },
  { delay: 2.5, segments: [{ text: '  hidden: 1 below confidence threshold', color: COLORS.dim }] },
];

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const COMMAND_TEXT = 'npx @voidh4x0r/slopgate fixtures/demo';
export const HEIGHT = TOP + LINES.length * LINE_HEIGHT + 26;

/**
 * @param {{mode?: 'animated'|'static', visibleLines?: number, commandChars?: number}} [options]
 */
export function renderSvg(options = {}) {
  const mode = options.mode ?? 'animated';
  const visibleLines = options.visibleLines ?? LINES.length;
  const commandChars = options.commandChars ?? COMMAND_TEXT.length;

  const body = LINES.map((line, index) => {
    if (index >= visibleLines) return '';
    const y = TOP + index * LINE_HEIGHT;
    if (line.segments.length === 0) return '';
    const spans = line.segments
      .map((segment, segmentIndex) => {
        let text = segment.text;
        if (index === 0 && segmentIndex === 1) text = COMMAND_TEXT.slice(0, commandChars);
        if (text.length === 0) return '';
        return `<tspan fill="${segment.color ?? COLORS.fg}">${escapeXml(text)}</tspan>`;
      })
      .join('');
    const style = mode === 'animated' ? ` style="animation-delay:${line.delay.toFixed(2)}s"` : '';
    return `  <text class="line" x="${X}" y="${y}"${style}>${spans}</text>`;
  })
    .filter(Boolean)
    .join('\n');

  const styleBlock =
    mode === 'animated'
      ? `    .line { opacity: 1; animation: show 0.01s linear both; }
    .cursor { animation: blink 1s steps(1) infinite, hide 0.01s linear 1.1s forwards; }
    @keyframes show { from { opacity: 0; } to { opacity: 1; } }
    @keyframes blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
    @keyframes hide { to { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .line, .cursor { animation: none; opacity: 1; }
    }`
      : `    .cursor { opacity: ${commandChars < COMMAND_TEXT.length ? 1 : 0}; }`;

  // Approximate monospace advance at 13px: 7.83px per character.
  const cursorX = X + 2 * 7.83 + commandChars * 7.83;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="slopgate scanning a repository and reporting findings">
  <style>
    .bg { fill: ${COLORS.bg}; }
    .chrome { fill: ${COLORS.chrome}; }
    .border { fill: none; stroke: ${COLORS.border}; }
    text {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      white-space: pre;
    }
    .title { fill: ${COLORS.dim}; font-size: 12px; }
${styleBlock}
  </style>
  <rect class="bg" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="10"/>
  <rect class="chrome" x="0" y="0" width="${WIDTH}" height="38" rx="10"/>
  <rect class="chrome" x="0" y="24" width="${WIDTH}" height="14"/>
  <circle cx="22" cy="19" r="5.5" fill="#ff5f56"/>
  <circle cx="42" cy="19" r="5.5" fill="#ffbd2e"/>
  <circle cx="62" cy="19" r="5.5" fill="#27c93f"/>
  <text class="title" x="${WIDTH / 2}" y="23" text-anchor="middle">slopgate — precision-first linting for AI-written code</text>
  <rect class="border" x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="10"/>
  <text x="${cursorX.toFixed(1)}" y="${TOP + 2}" class="cursor" fill="${COLORS.fg}">▋</text>
${body}
</svg>
`;
}
