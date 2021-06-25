/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import OpenApiTransformerBase from 'openapi-transformer-base';
import visit from 'openapi-transformer-base/visit.js';

// Any unique, deterministic stringify function would work.
// TODO: Benchmark against native JSON.stringify result of sort-keys deep
// https://github.com/sindresorhus/getKey-obj/blob/master/index.js#L17
// https://github.com/epoberezkin/fast-json-stable-stringify#benchmark
import stringify from 'fast-json-stable-stringify';

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

/** Removes duplicate values from a given array.
 *
 * Duplicates are determined by deep equality (using JSON stringification,
 * ignoring property order).
 *
 * @private
 */
function removeDuplicates(array) {
  if (!Array.isArray(array)) {
    this.warn('Expected Array', array);
    return array;
  }

  const set = new Set();
  const arrayUnique = array.filter((item) => {
    const itemJson = stringify(item);
    const isDuplicate = set.has(itemJson);
    if (!isDuplicate) {
      set.add(itemJson);
    }
    return !isDuplicate;
  });

  if (arrayUnique.length === array.length) {
    this.warn('Expected duplicate values in', array);
  }

  return arrayUnique;
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

/** Removes requestBody from an Operation Object.
 *
 * @private
 */
function removeRequestBody(operation) {
  const { requestBody, ...newOperation } = operation;
  if (requestBody === null
    || typeof requestBody !== 'object'
    || Array.isArray(requestBody)) {
    this.warn('Expected requestBody in Operation', operation);
    return operation;
  }

  return newOperation;
}

/** Transformer to fix bugs in the Procore REST API documentation.
 */
export default class DocBugsTransformer extends OpenApiTransformerBase {
  transformOpenApi(openApi) {
    openApi = applyToPath.call(
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

    // Remove requestBody from "Show Actual Production Quantity" (GET)
    // Inadvertently copied from "Update Actual Production Quantity"?
    openApi = applyToPath.call(
      this,
      removeRequestBody,
      openApi,
      [
        'paths',
        '/rest/v1.0/projects/{project_id}/actual_production_quantities/{id}',
        'get',
      ],
      0,
    );

    // Remove duplicate "id" path parameter from "Show a Bid within a Project"
    // in bids.json
    openApi = applyToPath.call(
      this,
      removeDuplicates,
      openApi,
      [
        'paths',
        '/rest/v1.0/projects/{project_id}/bids/{id}',
        'get',
        'parameters',
      ],
      0,
    );

    return openApi;
  }
}
