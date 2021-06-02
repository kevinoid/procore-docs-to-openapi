/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import assert from 'assert';

import OpenApiTransformerBase from 'openapi-transformer-base';

function removeMatch(string, match) {
  assert.strictEqual(match.input, string);
  return string.slice(0, match.index)
    + string.slice(match.index + match[0].length);
}

/** Transformer to convert deprecation notices in schema descriptions into
 * schema.deprecated and schema['x-deprecated'] properties.
 */
export default class DeprecatedTransformer
  extends OpenApiTransformerBase {
  transformSchema(schema) {
    const newSchema = super.transformSchema(schema);

    let { description } = newSchema || {};
    if (typeof description !== 'string') {
      return newSchema;
    }

    const origDescription = description;
    const { transformPath } = this;
    const propertyName =
      transformPath[transformPath.length - 2] === 'properties'
        ? transformPath[transformPath.length - 1]
        : undefined;
    let newSchemaProps;

    // Check for deprecation notice
    const deprecatedXY =
      description.match(/:(\S+) to be deprecated, use :(\S+)/);
    if (deprecatedXY) {
      const deprecatedName = deprecatedXY[1];
      if (deprecatedName === propertyName) {
        newSchemaProps = {
          // Mark schema as deprecated
          deprecated: true,

          // Indicate replacement using x-deprecated from Autorest
          // https://github.com/Azure/autorest/tree/master/Samples/test/deprecated
          'x-deprecated': {
            'replaced-by': deprecatedXY[2],
          },
        };

        // Remove from description, which is now redundant.
        description = removeMatch(description, deprecatedXY);
      } else if ((schema.properties && schema.properties[deprecatedName])
        || (schema.items
          && schema.items.properties
          && schema.items.properties[deprecatedName])) {
        // Notice on parent object or grandparent array schema is not useful.
        description = removeMatch(description, deprecatedXY);
      } else {
        // Don't understand.  Leave as-is.
        this.warn(
          'Deprecation notice for %s on %s!?',
          deprecatedName,
          propertyName,
        );
      }
    }

    // Deprecation notice on recommended replacement.
    const deprecatedYX =
      description.match(/Use :(\S+), :(\S+) to be deprecated/);
    if (deprecatedYX) {
      const useName = deprecatedYX[1];
      if (useName === propertyName) {
        // Notice on recommended replacement is not very useful.  Remove.
        description = removeMatch(description, deprecatedYX);
      } else {
        // Don't understand.  Leave as-is.
        this.warn(
          'Deprecation notice to use %s on %s!?',
          useName,
          propertyName,
        );
      }
    }

    if (description === origDescription) {
      return newSchema;
    }

    return {
      ...newSchema,
      description: description || undefined,
      ...newSchemaProps,
    };
  }
}
