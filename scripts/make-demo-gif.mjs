#!/usr/bin/env node
/**
 * Generates docs/demo.gif from the same artwork as docs/demo.svg.
 *
 * Optional tooling: needs `sharp` (SVG rasterisation) and `gifenc` (GIF
 * encoding). They are deliberately not package dependencies — contributors do
 * not need them, and the generated GIF is committed.
 *
 *   npm install --no-save sharp gifenc
 *   node scripts/make-demo-gif.mjs
 *
 * The GIF renderer positions every character explicitly instead of relying on
 * spaces and a monospace font: the rasteriser used here (librsvg) may not have
 * a monospace font installed, which would collapse the column alignment.
 */
// slopgate-ignore-next-line ts/phantom-import — optional tooling, install with --no-save
import gifenc from 'gifenc';
// slopgate-ignore-next-line ts/phantom-import — optional tooling, install with --no-save
import sharp from 'sharp';
import { COLORS, COMMAND_TEXT, HEIGHT, LINES, LINE_HEIGHT, TOP, WIDTH } from './demo-frame.mjs';

const { applyPalette, GIFEncoder, quantize } = gifenc;

const ROOT = new URL('..', import.meta.url);
const SCALE = 0.75;
const FRAME_WIDTH = Math.round(WIDTH * SCALE);
const FRAME_HEIGHT = Math.round(HEIGHT * SCALE);
const FRAME_COUNT = 33;
const DELAY_MS = 70;
/** Character advance in SVG user units (13px monospace is ~7.83px). */
const ADVANCE = 7.83;

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderFrame({ visibleLines, commandChars }) {
  const body = [];
  LINES.forEach((line, index) => {
    if (index >= visibleLines) return;
    const y = TOP + index * LINE_HEIGHT;
    let offset = 0;
    for (const [segmentIndex, segment] of line.segments.entries()) {
      let text = segment.text;
      if (index === 0 && segmentIndex === 1) text = COMMAND_TEXT.slice(0, commandChars);
      for (const ch of text) {
        if (ch !== ' ') {
          body.push(
            `<text x="${(26 + offset * ADVANCE).toFixed(1)}" y="${y}" fill="${segment.color ?? COLORS.fg}">${escapeXml(ch)}</text>`,
          );
        }
        offset += 1;
      }
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="10" fill="${COLORS.bg}"/>
  <rect x="0" y="0" width="${WIDTH}" height="38" rx="10" fill="${COLORS.chrome}"/>
  <rect x="0" y="24" width="${WIDTH}" height="14" fill="${COLORS.chrome}"/>
  <circle cx="22" cy="19" r="5.5" fill="#ff5f56"/>
  <circle cx="42" cy="19" r="5.5" fill="#ffbd2e"/>
  <circle cx="62" cy="19" r="5.5" fill="#27c93f"/>
  <text x="${WIDTH / 2}" y="23" text-anchor="middle" fill="${COLORS.dim}" font-size="12">slopgate — precision-first linting for AI-written code</text>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="10" fill="none" stroke="${COLORS.border}"/>
  ${commandChars < COMMAND_TEXT.length ? `<rect x="${(26 + (2 + commandChars) * ADVANCE).toFixed(1)}" y="${TOP - 10}" width="7" height="14" fill="${COLORS.fg}"/>` : ''}
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
    const { data } = await sharp(Buffer.from(svg))
      .resize(FRAME_WIDTH, FRAME_HEIGHT)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    rendered.push(data);
  }

  const palette = quantize(rendered[rendered.length - 1], 64);
  const gif = GIFEncoder();
  for (const rgba of rendered) {
    gif.writeFrame(applyPalette(rgba, palette), FRAME_WIDTH, FRAME_HEIGHT, { palette, delay: DELAY_MS });
  }
  gif.finish();

  const { writeFileSync } = await import('node:fs');
  const out = new URL('docs/demo.gif', ROOT);
  const bytes = gif.bytes();
  writeFileSync(out, bytes);
  console.log(
    `wrote docs/demo.gif (${Math.round(bytes.length / 1024)} KB, ${frames.length} frames, ${FRAME_WIDTH}x${FRAME_HEIGHT})`,
  );

  // A static PNG of the final frame is handy for a quick visual check.
  const preview = await sharp(Buffer.from(renderFrame({ visibleLines: LINES.length, commandChars: COMMAND_TEXT.length })))
    .png()
    .toBuffer();
  writeFileSync(new URL('docs/demo-preview.png', ROOT), preview);
  console.log('wrote docs/demo-preview.png');
}

await main();
