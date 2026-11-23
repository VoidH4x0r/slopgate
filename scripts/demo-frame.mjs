/**
 * Terminal artwork shared by scripts/make-demo-gif.mjs.
 *
 * The content mirrors a real `slopgate fixtures/demo` run; when output changes,
 * update this file and regenerate the GIF.
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
export const TOP = 76;
export const WIDTH = 960;

/** @type {Array<{segments: Array<{text: string, color?: string}>}>} */
export const LINES = [
  { segments: [{ text: '$ ', color: COLORS.prompt }, { text: 'npx @voidh4x0r/slopgate .' }] },
  { segments: [] },
  {
    segments: [
      { text: 'slopgate 1.0.1', color: COLORS.fg },
      { text: '  ·  4 files  ·  50ms', color: COLORS.dim },
    ],
  },
  { segments: [] },
  { segments: [{ text: 'app.py', color: COLORS.cyan }] },
  {
    segments: [
      { text: '       4:1  error   high   ', color: COLORS.dim },
      { text: 'py/phantom-import       ', color: COLORS.dim },
      { text: '`helper` is imported but not declared in any manifest', color: COLORS.fg },
    ],
  },
  { segments: [{ text: '            │ from helper import format_value', color: COLORS.dim }] },
  {
    segments: [
      { text: '      14:5  warning high   ', color: COLORS.dim },
      { text: 'py/swallowed-exception  ', color: COLORS.dim },
      { text: '`except` swallows the error silently', color: COLORS.yellow },
    ],
  },
  { segments: [{ text: '            │ except Exception:', color: COLORS.dim }] },
  { segments: [] },
  { segments: [{ text: 'src/agent.ts', color: COLORS.cyan }] },
  {
    segments: [
      { text: '       8:8  warning high   ', color: COLORS.dim },
      { text: 'ts/stub-function        ', color: COLORS.dim },
      { text: '`stub` throws "not implemented"', color: COLORS.yellow },
    ],
  },
  {
    segments: [
      { text: '      23:3  error   high   ', color: COLORS.dim },
      { text: 'ts/unreachable          ', color: COLORS.dim },
      { text: 'code after `return` is unreachable', color: COLORS.red },
    ],
  },
  { segments: [] },
  {
    segments: [
      { text: '  13 findings in 3 files', color: COLORS.fg },
      { text: '  ·  4 files scanned in 50ms', color: COLORS.dim },
    ],
  },
  {
    segments: [{ text: '  4 error · 9 warning · 0 info   (13 high · 0 medium · 0 low confidence)', color: COLORS.dim }],
  },
  { segments: [{ text: '  hidden: 1 below confidence threshold', color: COLORS.dim }] },
];

export const COMMAND_TEXT = 'npx @voidh4x0r/slopgate .';
export const HEIGHT = TOP + LINES.length * LINE_HEIGHT + 26;
