/**
 * Standard-library roots for Go imports. Go's standard packages are grouped
 * under stable top-level roots (`net/http`, `encoding/json`, `crypto/tls`,
 * `go/ast`, ...), so checking the first path segment avoids a brittle list of
 * every leaf package and every Go release.
 */
export const GO_STDLIB_ROOTS: ReadonlySet<string> = new Set([
  'archive',
  'arena',
  'bufio',
  'bytes',
  'cmp',
  'compress',
  'container',
  'context',
  'crypto',
  'database',
  'debug',
  'embed',
  'encoding',
  'errors',
  'expvar',
  'flag',
  'fmt',
  'go',
  'hash',
  'html',
  'image',
  // `internal/...` is reserved for the Go tree and its submodules. A bare
  // `internal/foo` import outside that tree is invalid, but treating the root
  // as standard keeps the rule from flagging stdlib-internal imports.
  'internal',
  'index',
  'io',
  'iter',
  'log',
  'maps',
  'math',
  'mime',
  'net',
  'os',
  'path',
  'plugin',
  'reflect',
  'regexp',
  'runtime',
  'slices',
  'sort',
  'strconv',
  'strings',
  'structs',
  'sync',
  'syscall',
  'testing',
  'text',
  'time',
  'unicode',
  'unique',
  'unsafe',
  'weak',
]);

export function isGoStdlib(importPath: string): boolean {
  if (importPath === 'C') return true;
  const root = importPath.split('/')[0] ?? '';
  return GO_STDLIB_ROOTS.has(root);
}
