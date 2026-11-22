/**
 * Compare benchmark durations with a previous results file.
 *
 * Timings are machine- and load-dependent; this guard is intended for repeated
 * runs on the same machine, not across CI runners.
 */
export function compareDurations(previous, current, thresholdPercent) {
  const before = new Map((previous.corpora ?? []).map((corpus) => [corpus.name, corpus.durationMs]));
  return (current.corpora ?? []).flatMap((corpus) => {
    const previousMs = before.get(corpus.name);
    // Short scans are dominated by process startup and timer noise. Only gate
    // corpora large enough for a 5% threshold to be meaningful.
    if (previousMs === undefined || previousMs < 1000) return [];
    const limit = previousMs * (1 + thresholdPercent / 100);
    return corpus.durationMs > limit
      ? [{ name: corpus.name, previousMs, currentMs: corpus.durationMs }]
      : [];
  });
}
