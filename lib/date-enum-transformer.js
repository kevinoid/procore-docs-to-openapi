/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import OpenApiTransformerBase from 'openapi-transformer-base';

function enumIsDateFormats(enumValues) {
  if (!Array.isArray(enumValues) || enumValues.length === 0) {
    return false;
  }

  const formats = enumValues.filter((v) => /^((YYYY|MM|DD)[-/]?)+$/.test(v));
  if (formats.length === enumValues.length) {
    return true;
  }

  if (formats.length > 0) {
    this.warn(
      'Some, but not all, enum values look like date formats:',
      formats,
    );
  }

  return false;
}

/** Transformer to convert schemas with enum values that are date formats
 * into `format: date`.
 */
export default class DateEnumTransformer extends OpenApiTransformerBase {
  transformSchema(schema) {
    schema = super.transformSchema(schema);

    if (schema && enumIsDateFormats(schema.enum)) {
      if (schema.type !== 'string') {
        this.warn('schema with date format enum has type %O', schema.type);
      } else {
        const { enum: _, ...newSchema } = schema;

        if (schema.format === undefined) {
          newSchema.format = 'date';
        } else if (schema.format !== 'date') {
          this.warn(
            'schema with date format enum values has string format %O',
            schema.format,
          );
        }

        return newSchema;
      }
    }

    return schema;
  }
}
