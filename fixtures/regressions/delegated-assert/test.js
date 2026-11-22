const test = require('tape');

// Table-driven tests: the assertions live in a local helper that receives `t`.
function runSuite(t, suite) {
  for (const item of suite) {
    t.equal(item.actual, item.expected);
  }
}

test('table driven assertions delegated to a helper', (t) => {
  runSuite(t, [
    { actual: 1 + 1, expected: 2 },
    { actual: 2 + 2, expected: 4 },
  ]);
  t.end();
});

test('genuinely asserts nothing', (t) => {
  runSuite(t, []);
  t.end();
});
