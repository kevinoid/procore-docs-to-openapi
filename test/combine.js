/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import assert from 'node:assert';

import combineOpenapi from '../index.js';

describe('combineOpenapi', () => {
  it('throws TypeError for non-iterable argument', () => {
    assert.throws(
      () => combineOpenapi(1),
      TypeError,
    );
  });
});
