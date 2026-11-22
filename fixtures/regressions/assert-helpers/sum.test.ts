import { test } from 'node:test';
import { assertEqual, assertTruthy, assertNotNull } from './helpers.js';

test('helper assertions count', () => {
  assertEqual(2 + 2, 4);
});

test('another helper assertion', () => {
  assertNotNull('x');
});

test('truthy helper', () => {
  assertTruthy(1);
});

test.runIf(process.platform === 'linux')('runIf form still analysed', () => {
  doNothing();
});

test.skipIf(process.platform === 'win32')('skipIf form still analysed', () => {
  doNothing();
});

declare function doNothing(): void;
