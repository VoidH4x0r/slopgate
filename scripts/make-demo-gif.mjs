#!/usr/bin/env node
/**
 * Generates docs/demo.gif from the shared terminal artwork.
 *
 * Optional tooling (not package dependencies — the generated GIF is committed):
 *
 *   npm install --no-save sharp gifenc opentype.js
 *   node scripts/make-demo-gif.mjs
 *
 * Text is converted to vector paths with opentype.js using a monospace TTF.
 * That is deliberate: the SVG rasteriser used here (librsvg) ignores
 * font-family and falls back to a serif face, which made the terminal demo look
 * wrong. Paths also stay crisp at any size. Set SLOPGATE_DEMO_FONT to override
 * the font file (Consolas on Windows, DejaVu Sans Mono on Linux).
 */
// slopgate-ignore-next-line ts/phantom-import — optional tooling, install with --no-save
import gifenc from 'gifenc';
// slopgate-ignore-next-line ts/phantom-import — optional tooling, install with --no-save
import opentype from 'opentype.js';
// slopgate-ignore-next-line ts/phantom-import — optional tooling, install with --no-save
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { COLORS, COMMAND_TEXT, HEIGHT, LINES, LINE_HEIGHT, TOP, WIDTH } from './demo-frame.mjs';

const { applyPalette, GIFEncoder, quantize } = gifenc;

const ROOT = new URL('..', import.meta.url);

/**
 * The SVG is authored at 960px. Rasterise it at 2x (density 144) and downscale
 * to 1440px: GitHub renders the README at ~880px, so 1440 stays sharp when the
 * browser shrinks it. The old 720px output was stretched by GitHub and looked
 * blurry.
 */
const DENSITY = 144;
const FRAME_WIDTH = 1440;
const FRAME_HEIGHT = Math.round((HEIGHT * FRAME_WIDTH) / WIDTH);
const FRAME_COUNT = 36;
const DELAY_MS = 80;
const FINAL_HOLD_MS = 350;

const FONT_SIZE = 13;
const TITLE_SIZE = 12;
const LEFT = 26;

const FONT_CANDIDATES = [
  process.env.SLOPGATE_DEMO_FONT,
  'C:/Windows/Fonts/consola.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  '/usr/share/fonts/dejavu/DejaVuSansMono.ttf',
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);

function loadFont() {
  for (const file of FONT_CANDIDATES) {
    try {
      const buffer = readFileSync(file);
      const font = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      return { font, file };
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(
    `No monospace TTF found. Set SLOPGATE_DEMO_FONT to a .ttf path. Tried: ${FONT_CANDIDATES.join(', ')}`,
  );
}

const { font, file: fontFile } = loadFont();

function textPath(text, x, y, size, color) {
  return `<path d="${font.getPath(text, x, y, size).toPathData(2)}" fill="${color}"/>`;
}

function renderFrame({ visibleLines, commandChars }) {
  const body = [];
  LINES.forEach((line, index) => {
    if (index >= visibleLines) return;
    const y = TOP + index * LINE_HEIGHT;
    let x = LEFT;
    for (const [segmentIndex, segment] of line.segments.entries()) {
      let text = segment.text;
      if (index === 0 && segmentIndex === 1) text = COMMAND_TEXT.slice(0, commandChars);
      if (text.length === 0) continue;
      body.push(textPath(text, x, y, FONT_SIZE, segment.color ?? COLORS.fg));
      x += font.getAdvanceWidth(text, FONT_SIZE);
    }
  });

  const title = 'slopgate — precision-first linting for AI-written code';
  const titleWidth = font.getAdvanceWidth(title, TITLE_SIZE);
  const cursorX =
    LEFT + font.getAdvanceWidth('$ ', FONT_SIZE) + font.getAdvanceWidth(COMMAND_TEXT.slice(0, commandChars), FONT_SIZE);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="10" fill="${COLORS.bg}"/>
  <rect x="0" y="0" width="${WIDTH}" height="38" rx="10" fill="${COLORS.chrome}"/>
  <rect x="0" y="24" width="${WIDTH}" height="14" fill="${COLORS.chrome}"/>
  <circle cx="22" cy="19" r="5.5" fill="#ff5f56"/>
  <circle cx="42" cy="19" r="5.5" fill="#ffbd2e"/>
  <circle cx="62" cy="19" r="5.5" fill="#27c93f"/>
  ${textPath(title, (WIDTH - titleWidth) / 2, 23, TITLE_SIZE, COLORS.dim)}
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="10" fill="none" stroke="${COLORS.border}"/>
  ${commandChars < COMMAND_TEXT.length ? `<rect x="${cursorX.toFixed(1)}" y="${TOP - 10}" width="7" height="14" fill="${COLORS.fg}"/>` : ''}
${body.join('\n')}
</svg>`;
}

function buildFrames() {
  const frames = [];
  const typingSteps = Math.ceil(COMMAND_TEXT.length / 3);
  for (let step = 1; step <= typingSteps; step += 1) {
    frames.push({ visibleLines: 1, commandChars: Math.min(COMMAND_TEXT.length, step * 3) });
  }
  for (let visible = 2; visible <= LINES.length; visible += 1) {
    frames.push({ visibleLines: visible, commandChars: COMMAND_TEXT.length });
  }
  while (frames.length < FRAME_COUNT) {
    frames.push({ visibleLines: LINES.length, commandChars: COMMAND_TEXT.length });
  }
  return frames.slice(0, FRAME_COUNT);
}

async function main() {
  const frames = buildFrames();
  const rendered = [];
  for (const frame of frames) {
    const svg = renderFrame(frame);
    const { data } = await sharp(Buffer.from(svg), { density: DENSITY })
      .resize(FRAME_WIDTH, FRAME_HEIGHT)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    rendered.push(data);
  }

  const palette = quantize(rendered[rendered.length - 1], 128);
  const gif = GIFEncoder();
  for (const [index, rgba] of rendered.entries()) {
    const delay = index >= frames.length - 6 ? FINAL_HOLD_MS : DELAY_MS;
    gif.writeFrame(applyPalette(rgba, palette), FRAME_WIDTH, FRAME_HEIGHT, { palette, delay });
  }
  gif.finish();

  const out = new URL('docs/demo.gif', ROOT);
  const bytes = gif.bytes();
  writeFileSync(out, bytes);
  console.log(
    `wrote docs/demo.gif (${Math.round(bytes.length / 1024)} KB, ${frames.length} frames, ${FRAME_WIDTH}x${FRAME_HEIGHT}, font ${fontFile})`,
  );

  // A static PNG of the final frame is handy for a quick visual check.
  const preview = await sharp(Buffer.from(renderFrame({ visibleLines: LINES.length, commandChars: COMMAND_TEXT.length })), {
    density: DENSITY,
  })
    .resize(FRAME_WIDTH)
    .png()
    .toBuffer();
  writeFileSync(new URL('docs/demo-preview.png', ROOT), preview);
  console.log('wrote docs/demo-preview.png');
}

await main();
