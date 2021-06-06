/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import OpenApiTransformerBase from 'openapi-transformer-base';
import visit from 'openapi-transformer-base/visit.js';

/** Transformer to add minimum/maximum to time properties (e.g. hours, minutes,
 * seconds) which are not set consistently in the Procore API docs.
 */
export default class TimeMinMaxTransformer
  extends OpenApiTransformerBase {
  /** Transforms a schema with name from context (e.g.  property or parameter
   * name).
   *
   * @param {!object} schema Schema to transform.
   * @param {string} name Name of schema (i.e. property or parameter name).
   * @returns {!object} If a format can be inferred, a copy of schema with
   * format added.  Otherwise, the result of #transformSchema(schema).
   */
  transformSchemaWithName(schema, name) {
    schema = super.transformSchema(schema);

    if (!schema) {
      return schema;
    }

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

  transformSchemaProperties(properties) {
    if (typeof properties !== 'object'
      || properties === null
      || Array.isArray(properties)) {
      this.warn('Ignoring non-object Schema properties', properties);
      return properties;
    }

    const newProperties = { ...properties };
    for (const [propName, propValue] of Object.entries(properties)) {
      if (propValue !== undefined) {
        newProperties[propName] = visit(
          this,
          this.transformSchemaWithName,
          propName,
          propValue,
          propName,
        );
      }
    }

    return newProperties;
  }

  transformParameter(parameter) {
    if (typeof parameter !== 'object'
      || parameter === null
      || Array.isArray(parameter)) {
      this.warn('Ignoring non-object Parameter', parameter);
      return parameter;
    }

    const {
      name,
      schema,
      content,
    } = parameter;

    // TODO
    if (content !== undefined) {
      this.warn('Unhandled parameter.content', parameter);
      return parameter;
    }

    if (schema === undefined) {
      this.warn('Parameter without schema', parameter);
      return parameter;
    }

    return {
      ...parameter,
      schema: visit(
        this,
        this.transformSchemaWithName,
        'schema',
        schema,
        name,
      ),
    };
  }
}
