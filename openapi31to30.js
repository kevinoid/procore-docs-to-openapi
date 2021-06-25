/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 * @module "procore-docs-to-openapi/openapi31to30.js"
 */

import OpenApi31To30Transformer
  from '@kevinoid/openapi-transformers/openapi31to30.js';
import RemoveTypeIfTransformer
  from '@kevinoid/openapi-transformers/remove-type-if.js';
import OpenApiTransformerBase from 'openapi-transformer-base';

/** Predicate which matches a schema type constraint that validates all
 * non-null primitive types, excluding 'array' and 'object'.
 *
 * Removing a type constraint matching this predicate expands the types which
 * the schema validates to include 'array' and 'object' (and 'null' in OAS 3.1).
 * Since few generators support union types, and this is currently only used
 * for custom_field_*, which includes `array`, unconstrained type is likely
 * preferable to splitting such schemas using anyOf/oneOf.
 *
 * @private
 */
function allPrimitiveTypes(type) {
  return Array.isArray(type)
    && type.length >= 3
    && [
      'boolean',
      'number',
      'string',
    ].every((t) => type.includes(t));
}

/**
 * Transforms an OpenAPI 3.1.* document for the Procore API to OpenAPI 3.0.3.
 */
// eslint-disable-next-line import/no-unused-modules
export default class ProcoreOpenApi31To30Transformer
  extends OpenApiTransformerBase {
  constructor() {
    super();
    this.transformers = [
      new RemoveTypeIfTransformer(allPrimitiveTypes),
      new OpenApi31To30Transformer(),
    ];
  }

  transformOpenApi(openApi) {
    if (typeof openApi !== 'object'
      || openApi === null
      || Array.isArray(openApi)) {
      this.warn('Ignoring non-object OpenAPI', openApi);
      return openApi;
    }

    if (typeof openApi.openapi !== 'string'
      || !openApi.openapi.startsWith('3.1.')) {
      this.warn('Expected OpenAPI 3.1, got', openApi.openapi);
    }

    for (const transformer of this.transformers) {
      openApi = transformer.transformOpenApi(openApi);
    }

    return {
      ...openApi,
      openapi: '3.0.3',
    };
  }
}
