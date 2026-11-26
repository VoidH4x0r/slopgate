// Minimal tar.gz extractor: dependency-free and identical on Windows, macOS
// and Linux. Handles ustar, GNU long names (typeflag L) and PAX path records
// (typeflag x); the corpus archive needs the latter for paths over 100 chars.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

function stringField(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/s, '');
}

function octal(buffer, offset, length) {
  const text = stringField(buffer, offset, length).trim();
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  return Number.isNaN(value) ? 0 : value;
}

function paxPath(data) {
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) break;
    const length = Number.parseInt(data.subarray(offset, space).toString('ascii'), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals > 0 && record.slice(0, equals) === 'path') return record.slice(equals + 1);
    offset += length;
  }
  return undefined;
}

function safeJoin(root, name) {
  const normalized = name.replaceAll('\\', '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  const base = path.resolve(root);
  if (!normalized || normalized === '.') return base;
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`unsafe archive path: ${name}`);
  }
  const target = path.resolve(base, ...normalized.split('/'));
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error(`unsafe archive path: ${name}`);
  return target;
}

/** Extract `archive` into `destination`; returns the number of files written. */
export function extractTarGz(archive, destination) {
  const root = path.resolve(destination);
  mkdirSync(root, { recursive: true });
  const data = gunzipSync(readFileSync(archive));
  let offset = 0;
  let pendingName;
  let files = 0;

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    offset += 512;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const name = stringField(header, 0, 100);
    const prefix = stringField(header, 345, 155);
    const payload = data.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (type === 'x' || type === 'g') {
      pendingName = paxPath(payload) ?? pendingName;
      continue;
    }
    if (type === 'L') {
      pendingName = stringField(payload, 0, size);
      continue;
    }
    const fullName = pendingName ?? (prefix ? `${prefix}/${name}` : name);
    pendingName = undefined;
    if (type === '5') {
      mkdirSync(safeJoin(root, fullName), { recursive: true });
      continue;
    }
    if (type !== '0' && type !== '7' && type !== '') continue;
    const target = safeJoin(root, fullName);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, payload);
    files += 1;
  }
  if (pendingName) throw new Error('truncated archive: dangling long name');
  return files;
}
