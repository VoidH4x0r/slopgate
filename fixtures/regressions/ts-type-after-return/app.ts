// Type-level declarations have no runtime presence: a `type`/`interface`
// after a `return` is not dead code.

export function describe(input: string): string {
  return input.trim();

  type Trimmed = { value: string };
  interface Options {
    strict: boolean;
  }
}

export function reallyDead(input: number): number {
  return input;
  const doubled = input * 2;
  return doubled;
}
