/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import OpenApiTransformerBase from 'openapi-transformer-base';
import visit from 'openapi-transformer-base/visit.js';

function applyToPath(transform, obj, propPath, i) {
  if (i >= propPath.length) {
    return transform(obj);
  }

  const propName = propPath[i];
  if (!hasOwnProperty.call(obj, propName)) {
    this.warn('Expected %s on %o', propName, obj);
    return obj;
  }

  const newObj = Array.isArray(obj) ? [...obj] : { ...obj };
  newObj[propName] = visit(
    this,
    applyToPath,
    propName,
    transform,
    obj[propName],
    propPath,
    i + 1,
  );
  return newObj;
}

/** Remove items from a schema with type object.
 *
 * It appears the items schema was inadvertently copied into this object.
 *
 * @private
 */
function removeObjectItems(schema) {
  const { type, properties } = schema;
  const { items, ...newSchema } = schema;
  if (type !== 'object'
    || typeof items !== 'object'
    || typeof properties !== 'object') {
    this.warn('Expected object schema with items and properties', schema);
    return schema;
  }

  return newSchema;
}

/** Transformer to fix bugs in the Procore REST API documentation.
 */
export default class DocBugsTransformer extends OpenApiTransformerBase {
  transformOpenApi(openApi) {
    return applyToPath.call(
      this,
      removeObjectItems,
      openApi,
      [
        'paths',
        '/rest/v1.0/potential_change_orders/sync',
        'patch',
        'responses',
        '200',
        'content',
        'application/json',
        'schema',
        'properties',
        'errors',
        'items',
      ],
      0,
    );
  }
}
