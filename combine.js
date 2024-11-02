/**
 * @copyright Copyright 2016-2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 * @module procore-docs-to-openapi
 */

import assert from 'node:assert';

/** Combines OpenAPI Objects created by {@see
 * ProcoreApiDocToOpenApiTransformer}.
 *
 * @param {!Array<!object>} openapiDocs Array of OpenAPI Objects produced
 * by {@see ProcoreApiDocToOpenApiTransformer}.
 * @returns {!object} OpenAPI Object with all information from openapiDocs.
 * @throws {Error} If any object in openapiDocs contains properties not
 * produced by {@see ProcoreApiDocToOpenApiTransformer}.
 * @throws {Error} If the same path appears in multiple objects in openapiDocs.
 */
export default function combineOpenapi(openapiDocs) {
  const combinedPaths = Object.create(null);
  const tagsByName = new Map();
  let firstVer;
  for (const openapiDoc of openapiDocs) {
    const {
      openapi,
      tags,
      paths,
      ...unrecognized
    } = openapiDoc;

    if (!openapi.startsWith('3.')) {
      throw new Error(`Unsupported OpenAPI version: ${openapi}`);
    }

    if (firstVer === undefined) {
      firstVer = openapi;
    } else if (openapi !== firstVer) {
      // TODO: Ignore patch version and just compare major.minor?
      throw new Error(`Can not combine different OpenAPI versions: ${
        openapi} != ${firstVer}`);
    }

    const unrecognizedKeys = Object.keys(unrecognized);
    if (unrecognizedKeys.length > 0) {
      throw new Error(`Unsupported OpenAPI properties: ${unrecognizedKeys}`);
    }

    if (tags) {
      for (const tag of tags) {
        const tagName = tag.name;
        const oldTag = tagsByName.get(tagName);
        if (oldTag) {
          assert.deepStrictEqual(tag, oldTag, `Tag ${tagName} must match`);
        } else {
          tagsByName.set(tagName, tag);
        }
      }
    }

    for (const [pathStr, pathObj] of Object.entries(paths)) {
      if (Object.hasOwn(combinedPaths, pathStr)) {
        throw new Error(`Duplicate path ${pathStr}`);
      }

      combinedPaths[pathStr] = pathObj;
    }
  }

  if (firstVer === undefined) {
    return undefined;
  }

  return {
    openapi: firstVer,
    tags: [...tagsByName.values()],
    paths: combinedPaths,
  };
}
