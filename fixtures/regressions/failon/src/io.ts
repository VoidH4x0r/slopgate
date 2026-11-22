// A medium-confidence finding only: empty catch is idiomatic in JS.
declare function send(): void;

export function ping(): void {
  try {
    send();
  } catch {}
}
