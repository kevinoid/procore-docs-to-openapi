/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import OpenApiTransformerBase from 'openapi-transformer-base';

/** Transformer to add minimum/maximum to time properties (e.g. hours, minutes,
 * seconds) which are not set consistently in the Procore API docs.
 */
export default class TimeMinMaxTransformer
  extends OpenApiTransformerBase {
  transformSchema(schema) {
    schema = super.transformSchema(schema);

    const { transformPath } = this;
    const name = transformPath[transformPath.length - 2] === 'properties'
      ? transformPath[transformPath.length - 1]
      : undefined;

    let newSchema;
    if (/^(time_)?hour$/.test(name)) {
      if (schema.type !== 'integer') {
        this.warn(
          'Property %O has type %O.  Expected "integer"',
          name,
          schema.type,
        );
      } else if (schema.minimum === undefined && schema.maximum === undefined) {
        newSchema = {
          ...schema,
          minimum: 0,
          maximum: 23,
        };
      } else if (schema.minimum !== 0 || schema.maximum !== 23) {
        this.warn(
          'Property %O has min/max %O/%O, expected 0/23',
          name,
          schema.minimum,
          schema.maximum,
        );
      }
    } else if (/^(time_)?minute$/.test(name)) {
      if (schema.type !== 'integer') {
        this.warn(
          'Property %O has type %O.  Expected "integer"',
          name,
          schema.type,
        );
      } else if (schema.minimum === undefined && schema.maximum === undefined) {
        newSchema = {
          ...schema,
          minimum: 0,
          maximum: 59,
        };
      } else if (schema.minimum !== 0 || schema.maximum !== 59) {
        this.warn(
          'Property %O has min/max %O/%O, expected 0/59',
          name,
          schema.minimum,
          schema.maximum,
        );
      }
    }

    return newSchema || schema;
  }
}
