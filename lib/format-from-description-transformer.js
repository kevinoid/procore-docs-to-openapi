/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import OpenApiTransformerBase from 'openapi-transformer-base';

/** Transformer to infer schema format from description.
 */
export default class FormatFromDescriptionTransformer
  extends OpenApiTransformerBase {
  transformSchema(schema) {
    schema = super.transformSchema(schema);

    if (!schema
      || schema.type !== 'string'
      || schema.format !== undefined) {
      return schema;
    }

    const { transformPath } = this;
    const name = transformPath[transformPath.length - 2] === 'properties'
      ? transformPath[transformPath.length - 1]
      : undefined;
    const description = schema.description || '';

    // Infer format from description
    // https://json-schema.org/draft/2020-12/json-schema-validation.html#rfc.section.7
    let format;
    if (/\bYYYY-MM-DD\b/i.test(description)) {
      format = 'date';
    } else if (/\bdatetime range/i.test(description)) {
      // No format for ISO 8601 datetime range
      // https://en.wikipedia.org/wiki/ISO_8601#Time_intervals
      // TODO: Set pattern for datetime/datetime?
    } else if (/\bdatetime\b/i.test(description)) {
      format = 'date-time';
    } else if (/\bUUID\b/i.test(description)) {
      format = 'uuid';
    } else if (/^UR[IL]$/i.test(name) || /\bUR[IL]\b/i.test(description)) {
      format = 'uri';
    } else if (/^email$/i.test(name) || /\bemail\b/i.test(description)) {
      format = 'email';
    } else if (/\b(?:money|price|cost)\b/i.test(description)) {
      format = 'decimal';
    }

    if (format === undefined) {
      return schema;
    }

    return {
      ...schema,
      format,
    };
  }
}
