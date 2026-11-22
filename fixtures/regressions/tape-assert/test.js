const test = require('tape');

test('tape assertions are assertions', (t) => {
  t.equal(1 + 1, 2);
  t.end();
});

test('tape structural assertions', (t) => {
  t.deepEqual({ a: 1 }, { a: 1 });
  t.end();
});

test('this one really has no assertion', (t) => {
  doNothing();
  t.end();
});

function doNothing() {}
