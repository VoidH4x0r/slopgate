// JavaScript hoists function declarations, so a helper declared after `return`
// is callable from above: it is not dead code.

export function selectMode(flag: boolean): string {
  const helper = () => helperMode(flag);
  return helper();

  function helperMode(value: boolean): string {
    return value ? 'on' : 'off';
  }
}

// This one really is dead code and must still be reported.
export function genuinelyDead(input: number): number {
  return input + 1;
  const unused = input * 2;
  console.log(unused);
}
