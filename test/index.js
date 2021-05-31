/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import assert from 'assert';

import ProcoreApiDocToOpenApiTransformer, {
  makeEndpointFilter,
} from '../index.js';

describe('ProcoreApiDocToOpenApiTransformer', () => {
  it('throws TypeError for non-object constructor argument', () => {
    assert.throws(
      () => new ProcoreApiDocToOpenApiTransformer(1),
      TypeError,
    );
  });
});

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
});
