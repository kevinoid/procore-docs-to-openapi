/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import assert from 'node:assert';

import OpenApiTransformerBase from 'openapi-transformer-base';

const skipDescriptionSet = new Set([
  // TODO: Figure out how to deal with enum member deprecation
  // (For this particular case, description should be left on $ref to
  // enum, or removed if "recordable" not listed in enum values.)
  "Filing Type - The 'recordable' filing_type value is deprecated. When a filing type of 'recordable' is provided, the `recordable` attribute of the Injury will instead be set to 'true'.",
]);

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
    if (typeof description !== 'string'
      || skipDescriptionSet.has(description)
      || !/deprecat(?:e|ed|ion)/i.test(description)) {
      return newSchema;
    }

    const origDescription = description;
    const { transformPath } = this;
    const propertyName =
      transformPath[transformPath.length - 2] === 'properties'
        ? transformPath[transformPath.length - 1]
        : undefined;
    let newSchemaProps;

    let match, deprecatedName, replacementName;
    for (const deprecationRegexp of [
      /:(?<deprecated>\S+) to be deprecated, use :(?<replacement>\S+)/,
      /\s*\(this property is deprecated - see (?<replacement>\S+)\)/,
      /\s*\*?DEPRECATED\. Please use (?<replacement>\S+) instead/,
      /DEPRECATED - Use (?<replacement>\S+) instead\.\s*/,
      /Deprecated\. Use `(?<replacement>\S+)`/,
      /\(Deprecated\) Use `(?<replacement>\S+)`/,
      /DEPRECATED: Use :(?<replacement>\S+)\.\s*/,
      /\s*\u2014 DEPRECATED, please use "(?<replacement>\S+)" instead/,
      /\s*Note that use of this parameter is deprecated\. Please use `(?<replacement>\S+)` instead\./,
      /\s*Note: this field is now deprecated and will mirror the value of (?<replacement>\S+) until it is no longer supported\./,
      /\s*This field is DEPRECATED as of \w+ [0-9]{1,2}, [0-9]{4} and will no longer be supported as of \w+ [0-9]{1,2}, [0-9]{4}\./,
      /A deprecated value which was originally used to uniquely identify tasks\.\nThis value will be removed in a later version of the API\./,
      /\s*Deprecated - always false/,
      /DEPRECATED\.\s*/,
      /\s*\(deprecated\)$/,
    ]) {
      match = description.match(deprecationRegexp);
      if (match) {
        if (match.groups) {
          deprecatedName = match.groups.deprecated;
          replacementName = match.groups.replacement;
        }

        break;
      }
    }

    if (match) {
      if (deprecatedName === propertyName || deprecatedName === undefined) {
        newSchemaProps = {
          // Mark schema as deprecated
          deprecated: true,

          // Indicate replacement using x-deprecated from Autorest
          // https://github.com/Azure/autorest/tree/master/Samples/test/deprecated
          'x-deprecated': {
            'replaced-by': replacementName,
          },
        };

        // Remove from description, which is now redundant.
        description = removeMatch(description, match);
      } else if ((schema.properties && schema.properties[deprecatedName])
        || (schema.items
          && schema.items.properties
          && schema.items.properties[deprecatedName])) {
        // Notice on parent object or grandparent array schema is not useful.
        description = removeMatch(description, match);
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
      this.warn('Unable to remove deprecation in description %o', description);
      return newSchema;
    }

    return {
      ...newSchema,
      description: description || undefined,
      ...newSchemaProps,
    };
  }
}
