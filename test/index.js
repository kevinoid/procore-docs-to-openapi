/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import assert from 'node:assert';

import ProcoreApiDocToOpenApiTransformer from '../index.js';

describe('ProcoreApiDocToOpenApiTransformer', () => {
  it('throws TypeError for non-object constructor argument', () => {
    assert.throws(
      () => new ProcoreApiDocToOpenApiTransformer(1),
      TypeError,
    );
  });
});
