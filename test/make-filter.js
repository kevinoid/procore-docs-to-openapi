/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import assert from 'node:assert';

import makeEndpointFilter, { supportLevels } from '../make-filter.js';

describe('makeEndpointFilter', () => {
  it('throws RangeError if minSupportLevel is unrecognized', () => {
    assert.throws(
      () => makeEndpointFilter('zulu'),
      RangeError,
    );
  });

  it('throws TypeError if includeBetaPrograms is not iterable', () => {
    assert.throws(
      () => makeEndpointFilter('alpha', 1),
      TypeError,
    );
  });

  for (const supportLevel of supportLevels) {
    it(`creates function for ${supportLevel}`, () => {
      const filter = makeEndpointFilter(supportLevel);
      assert.strictEqual(typeof filter, 'function');
    });
  }
});
