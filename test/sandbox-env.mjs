// `test:sandbox` runs without a network or child-process allowance; the one
// git-backed CLI test opts out via this flag instead of failing the release gate.
process.env.SLOPGATE_SANDBOX = '1';
