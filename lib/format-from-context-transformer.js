/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import OpenApiTransformerBase from 'openapi-transformer-base';
import visit from 'openapi-transformer-base/visit.js';

/** Transformer to infer format of string schema from contextual information
 * (property/parameter name, description, example).
 *
 * Note: JSON Schema defines some formats:
 * https://json-schema.org/draft/2020-12/json-schema-validation.html#rfc.section.7
 * OpenAPI Schema defines some formats:
 * https://github.com/OAI/OpenAPI-Specification/blob/main/versions/3.1.0.md#dataTypeFormat
 * Several others are used in the wild:
 * https://github.com/OAI/OpenAPI-Specification/issues/845#issuecomment-297920820
 * Tool support varies.  This transformer attempts to add formats which may be
 * useful for generating strongly typed API clients and are reasonably
 * unambiguous.
 */
export default class FormatFromContextTransformer
  extends OpenApiTransformerBase {
  /** Transforms a schema with name and parameter context information.
   *
   * @param {!object} schema Schema to transform.
   * @param {string} name Name of schema (i.e. property or parameter name).
   * @param {!object=} parameter Parameter of this schema, if it is the schema
   * for a parameter.
   * @returns {!object} If a format can be inferred, a copy of schema with
   * format added.  Otherwise, the result of #transformSchema(schema).
   */
  transformSchemaWithContext(schema, name, parameter) {
    schema = super.transformSchema(schema);

    if (!schema
      || schema.type !== 'string'
      || schema.format !== undefined) {
      return schema;
    }

    let format;
    // eslint-disable-next-line default-case
    switch (name.toLowerCase()) {
      case 'date':
        format = 'date';
        break;
      case 'datetime':
        format = 'date-time';
        break;
      case 'email':
      case 'email_address':
      case 'inbound_email':
        format = 'email';
        break;
      case 'email_signature':
        format = 'html';
        break;
      case 'uri':
      case 'url':
        format = 'uri';
        break;
      case 'xml':
        format = 'xml';
        break;
    }

    if (format === undefined) {
      for (const description of [
        schema.description,
        parameter && parameter.description,
      ]) {
        if (description && typeof description === 'string') {
          if (/\bYYYY-MM-DD\b/i.test(description)) {
            format = 'date';
            break;
          } else if (/\bdatetime range/i.test(description)) {
            // No format for ISO 8601 datetime range
            // https://en.wikipedia.org/wiki/ISO_8601#Time_intervals
            // TODO: Set pattern for datetime/datetime?
          } else if (/\bdatetime\b/i.test(description)) {
            format = 'date-time';
            break;
          } else if (/\bUUID\b/i.test(description)) {
            format = 'uuid';
            break;
          } else if (/\bUR[IL]\b/i.test(description)) {
            format = 'uri';
            break;
          } else if (/\bemail\b/i.test(description)) {
            format = 'email';
            break;
          } else if (/\b(?:cost|money|price)\b/i.test(description)) {
            format = 'decimal';
            break;
          } else if (/\brich text\b/i.test(description)) {
            format = 'html';
            break;
          }
        }
      }
    }

    if (format === undefined) {
      for (const example of [schema.example, parameter && parameter.example]) {
        if (example && typeof example === 'string') {
          if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(example)) {
            format = 'date';
            break;
          } else if (
            /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}Z$/
              .test(example)) {
            format = 'date-time';
            break;
          } else if (/^[0-9]{1,2}:[0-9]{2}(?: [AaPp][Mm])?$/.test(example)) {
            // FIXME: JSON Schema defines format: time as ISO 8601 full-time
            // (which is HH:MM:SS with offset, no am/pm)
            // https://json-schema.org/draft/2020-12/json-schema-validation.html#rfc.section.7.3.1
            // How do generators handle this?  How does API handle full-date?
            format = 'time';
            break;
          } else if (/^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/
            .test(example)) {
            format = 'uuid';
            break;
          } else if (/^https?:/.test(example)) {
            format = 'uri';
            break;
          } else if (/^[A-Za-z0-9.-]+@[A-Za-z0-9.-]+$/.test(example)) {
            format = 'email';
            break;
          // Note: Not matching (complex) grammar for XML tags
          // https://www.w3.org/TR/2008/REC-xml-20081126/#sec-starttags
          // Heuristic matches start tag with ASCII alnum simple name no attrs
          } else if (/<[A-Za-z0-9]+>/.test(example)) {
            format = 'html';
            break;
          }
        }
      }
    }

    if (format === undefined) {
      return schema;
    }

    return {
      ...schema,
      format,
    };
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
          this.transformSchemaWithContext,
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
        this.transformSchemaWithContext,
        'schema',
        schema,
        name,
        parameter,
      ),
    };
  }
}
