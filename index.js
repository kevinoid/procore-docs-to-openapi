/**
 * @copyright Copyright 2016-2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 * @module procore-docs-to-openapi
 */

'use strict';

const assert = require('assert');
const camelCase = require('camelcase');
const escapeStringRegexp = require('escape-string-regexp');
const { debuglog, isDeepStrictEqual } = require('util');

const groupNameToUrlPath = require('./lib/group-name-to-url-path.js');

const debug = debuglog('procore-docs-to-openapi');
const warn = debug;

const indentIncrement = 2;

const docsUrlSymbol = Symbol('docsUrl');
const versionNameSymbol = Symbol('versionName');
const versionToolsSymbol = Symbol('versionTools');

/** OpenAPI Specification version of documents produced by this module.
 *
 * @private
 */
const openapiVersion = '3.1.0';
const openapiMajorMinor = '3.1.';

const supportLevels = [
  'internal',
  'alpha',
  'beta',
  'production',
];

function removeMatch(string, match) {
  assert.strictEqual(match.input, string);
  return string.slice(0, match.index)
    + string.slice(match.index + match[0].length);
}

function enumIsDateFormats(enumValues) {
  if (!Array.isArray(enumValues) || enumValues.length === 0) {
    return false;
  }

  const formats = enumValues.filter((v) => /^((YYYY|MM|DD)[-/]?)+$/.test(v));
  if (formats.length === enumValues.length) {
    return true;
  }

  if (formats.length > 0) {
    warn('Some, but not all, enum values look like date formats:', formats);
  }

  return false;
}

function tuneSchema(transformer, name, schema) {
  name = name || '';
  let description = schema.description || '';

  if (enumIsDateFormats(schema.enum)) {
    if (schema.type !== 'string') {
      warn('schema with date format enum has type %s', schema.type);
    }

    if (schema.format === undefined) {
      schema.format = 'date';
    } else if (schema.format !== 'date') {
      warn('schema with date format enum has format %s', schema.format);
    }

    schema.enum = undefined;
  }

  // Infer format from description
  // https://json-schema.org/draft/2020-12/json-schema-validation.html#rfc.section.7
  if (schema.type === 'string' && schema.format === undefined) {
    if (/\bYYYY-MM-DD\b/i.test(description)) {
      schema.format = 'date';
    } else if (/\bdatetime range/i.test(description)) {
      // No format for ISO 8601 datetime range
      // https://en.wikipedia.org/wiki/ISO_8601#Time_intervals
      // TODO: Set pattern for datetime/datetime?
    } else if (/\bdatetime\b/i.test(description)) {
      schema.format = 'date-time';
    } else if (/\bUUID\b/i.test(description)) {
      schema.format = 'uuid';
    } else if (/^UR[IL]$/i.test(name) || /\bUR[IL]\b/i.test(description)) {
      schema.format = 'uri';
    } else if (/^email$/i.test(name) || /\bemail\b/i.test(description)) {
      schema.format = 'email';
    } else if (/\b(?:money|price|cost)\b/i.test(description)) {
      schema.format = 'decimal';
    }
  }

  // The Procore docs set min/max on hour/minute inconsistently.  Fix.
  if (schema.type === 'integer'
    && schema.maximum === undefined
    && schema.minimum === undefined) {
    if (/^(time_)?hour$/.test(name)) {
      schema.maximum = 23;
      schema.minimum = 0;
    } else if (/^(time_)?minute$/.test(name)) {
      schema.maximum = 59;
      schema.minimum = 0;
    }
  }

  if (description) {
    // Check for deprecation notice
    const deprecatedXY =
      description.match(/:(\S+) to be deprecated, use :(\S+)/);
    if (deprecatedXY) {
      const deprecatedName = deprecatedXY[1];
      if (deprecatedName === name) {
        // Mark schema as deprecated
        schema.deprecated = true;

        // Indicate replacement using x-deprecated from Autorest
        // https://github.com/Azure/autorest/tree/master/Samples/test/deprecated
        schema['x-deprecated'] = {
          'replaced-by': deprecatedXY[2],
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
        warn('Deprecation notice for %s on %s!?', deprecatedName, name);
      }
    }

    // Deprecation notice on recommended replacement.
    const deprecatedYX =
      description.match(/Use :(\S+), :(\S+) to be deprecated/);
    if (deprecatedYX) {
      const useName = deprecatedYX[1];
      if (useName === name) {
        // Notice on recommended replacement is not very useful.  Remove.
        description = removeMatch(description, deprecatedYX);
      } else {
        // Don't understand.  Leave as-is.
        warn('Deprecation notice to use %s on %s!?', useName, name);
      }
    }

    schema.description = description || undefined;
  }

  return schema;
}

/** Convert an Array of property names to a JSON Pointer (RFC 6901).
 *
 * @private
 * @param {!Array<string>} propPath Property names.
 * @returns {string} JSON Pointer.
 */
function toJsonPointer(propPath) {
  // eslint-disable-next-line prefer-template
  return '/' + propPath
    .map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1'))
    .join('/');
}

function visit(transformer, method, propName, propValue) {
  transformer.transformPath.push(propName);

  let handlingException = false;
  try {
    return method.call(transformer, propValue);
  } catch (err) {
    handlingException = true;
    if (!hasOwnProperty.call(err, 'transformPath')) {
      err.transformPath = transformer.transformPath.slice(0);
      err.message +=
        ` (while transforming ${toJsonPointer(err.transformPath)})`;
    }

    throw err;
  } finally {
    const popProp = transformer.transformPath.pop();

    // Avoid clobbering an exception which is already propagating
    if (!handlingException) {
      assert.strictEqual(popProp, propName);
    }
  }
}

exports.ProcoreApiDocToOpenApiTransformer =
class ProcoreApiDocToOpenApiTransformer {
  constructor(options = {}) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('options must be an object or undefined');
    }

    this.options = options;

    /** Property names traversed in current transformation.
     *
     * @type {Array<string>}
     */
    this.transformPath = [];

    /** URL of the Procore API docs for the current version object.
     *
     * @private
     * @type {string=}
     */
    this[docsUrlSymbol] = undefined;

    /** Name of the current Procore API version object.
     *
     * @private
     * @type {string=}
     */
    this[versionNameSymbol] = undefined;

    /** Tools categorization for the current Procore API version.
     *
     * @private
     * @type {Array<string>=}
     */
    this[versionToolsSymbol] = undefined;
  }

  /** Transforms a path_params or query_params object to an OpenAPI Parameter
   * Object.
   *
   * @param {!object} param Item from path_params or query_params array.
   * @returns {!object} OpenAPI Parameter Object.
   */
  transformParam(param) {
    const {
      description,
      enum: enumValues,
      name,
      type,
    } = param;

    // Procore docs add enum: [] to non-enumerated parameters.
    // Sanity check enumValues before use.
    let checkedEnum;
    if (enumValues !== undefined && enumValues !== null) {
      if (!Array.isArray(enumValues)) {
        warn('Unexpected non-Array enum:', enumValues);
      } else if (enumValues.length > 0) {
        checkedEnum = enumValues;
      }
    }

    const schema = {
      description: description || undefined,
      type,
      enum: checkedEnum,
    };
    return tuneSchema(this, name, schema);
  }

  /** Transforms path_params or query_params to an array of OpenAPI Parameter
   * Objects.
   *
   * @param {!Array<!object>} params path_params or query_params array.
   * @param {string} paramsIn in property of the returned Parameter Objects.
   * @returns {!Array<!object>} Array of OpenAPI Parameter Objects.
   */
  transformParams(params, paramsIn) {
    const oasParams = [];
    let prevSchema;
    for (const [i, param] of Object.entries(params)) {
      const {
        description,
        enum: enumValues,
        name,
        required,
        type,
        ...unrecognized
      } = param;
      const unrecognizedProps = Object.keys(unrecognized);
      if (unrecognizedProps.length > 0) {
        warn(
          'Unrecognized properties on %s_param:',
          paramsIn,
          unrecognizedProps,
        );
      }

      if (type === 'object') {
        // Without indentation, how do we know which of the following params
        // are properties?
        throw new Error('Unsupported parameter with type object');
      }

      const schema = visit(this, this.transformParam, i, param);
      if (prevSchema && prevSchema.type === 'array') {
        if (prevSchema.items) {
          throw new Error(`${name} conflicts with existing array item schema`);
        }

        prevSchema.items = schema;
      } else {
        oasParams.push({
          name,
          in: paramsIn,
          description: schema.description,
          required,
          schema,
        });
        delete schema.description;
      }

      prevSchema = schema;
    }

    return oasParams;
  }

  /** Transforms path_params array to an array of OpenAPI Parameter Objects.
   *
   * @param {!Array<!object>} pathParams path_params array.
   * @returns {!Array<!object>} Array of OpenAPI Parameter Objects.
   */
  transformPathParams(pathParams) {
    return this.transformParams(pathParams, 'path');
  }

  /** Transforms query_params array to an array of OpenAPI Parameter Objects.
   *
   * @param {!Array<!object>} queryParams query_params array.
   * @returns {!Array<!object>} Array of OpenAPI Parameter Objects.
   */
  transformQueryParams(queryParams) {
    return this.transformParams(queryParams, 'query');
  }

  /** Transforms body_params to JSON Schema.
   *
   * @param {!Array<!object>} params body_params array.
   * @returns {!object} JSON Schema.
   */
  transformBodyParams(params) {
    // The Procore docs represent schema hierarchy for body using indentation.
    // Keep track of most recent schema for each indent depth, so child schema
    // can be matched to parent.
    const schemaForDepth = [{ type: 'object' }];
    for (const [i, param] of Object.entries(params)) {
      const {
        description,
        direct_child_of_object: directChildOfObject,
        enum: enumValues,
        indentation,
        name,
        required,
        type,
        ...unrecognized
      } = param;
      const unrecognizedProps = Object.keys(unrecognized);
      if (unrecognizedProps.length > 0) {
        warn('Unrecognized properties on body_param:', unrecognizedProps);
      }

      if (directChildOfObject !== undefined && directChildOfObject !== true) {
        warn('Unrecognized direct_child_of_object:', directChildOfObject);
      }

      if (indentation < indentIncrement
        || indentation % indentIncrement !== 0) {
        throw new Error(
          `indentation ${indentation} is not a multiple of ${indentIncrement}`,
        );
      }

      const depth = indentation / indentIncrement;

      // Procore docs omits array parameter for array of array
      // Check for missing parent with grandparent array missing item type
      if (depth > 2 && depth - 1 === schemaForDepth.length) {
        const maybeGrandparent = schemaForDepth[depth - 2];
        if (maybeGrandparent.type === 'array' && !maybeGrandparent.items) {
          const parentArray = { type: 'array' };
          maybeGrandparent.items = parentArray;
          schemaForDepth[depth - 1] = parentArray;
        }
      }

      const parentSchema = schemaForDepth[depth - 1];
      if (!parentSchema) {
        throw new Error(
          `param ${name} has no parent at indent ${depth * indentIncrement}`,
        );
      }

      const schema = visit(this, this.transformParam, i, param);
      const parentType = parentSchema.type;
      if (parentType === 'array' && !name) {
        // Parameter is array item
        if (parentSchema.items) {
          throw new Error(
            `item schema for array with existing item schema: ${
              JSON.stringify(parentSchema.items)}`,
          );
        }

        parentSchema.items = schema;
      } else {
        let parentObjectSchema;
        if (parentType === 'object') {
          // Parameter is property of parent object
          parentObjectSchema = parentSchema;
        } else if (parentType === 'array') {
          // Parameter is property of parent array item
          parentObjectSchema = parentSchema.items;
          if (!parentObjectSchema) {
            parentObjectSchema = { type: 'object' };
            parentSchema.items = parentObjectSchema;
          } else if (parentObjectSchema.type !== 'object') {
            throw new Error(`property ${name} for array of non-object items`);
          }
        } else {
          throw new Error(
            `param ${name} is child of non-object/array type ${parentType}`,
          );
        }

        if (!name) {
          throw new Error('missing name for child param of object');
        }

        // Procore docs represent variables in param names as %{var}
        // e.g. "custom_field_%{custom_field_definition_id}"
        const variableParts = name.split(/(%\{[^}]+\})/g).filter(Boolean);
        if (variableParts.length === 1 && !variableParts[0].startsWith('%{')) {
          // No variables in name, add to properties
          let parentProperties = parentObjectSchema.properties;
          if (!parentProperties) {
            parentProperties = Object.create(null);
            parentObjectSchema.properties = parentProperties;
          }

          if (hasOwnProperty.call(parentProperties, name)) {
            throw new Error(`duplicate property ${name} for parameter`);
          }

          parentProperties[name] = schema;
        } else {
          // Variables in name, add converted pattern to patternProperties
          // Note: patterns are not implicitly anchored.  Need ^$.
          // https://github.com/json-schema-org/json-schema-spec/issues/897
          let pattern = '^';
          for (const variablePart of variableParts) {
            if (variablePart.startsWith('%{')) {
              if (variablePart.endsWith('_id}')) {
                pattern += '([0-9]+)';
              } else {
                pattern += '(.*)';
              }
            } else {
              pattern += escapeStringRegexp(variablePart);
            }
          }
          pattern += '$';

          let { patternProperties } = parentObjectSchema;
          if (!patternProperties) {
            patternProperties = Object.create(null);
            parentObjectSchema.patternProperties = patternProperties;
          }

          if (hasOwnProperty.call(patternProperties, pattern)) {
            throw new Error(
              `duplicate patternProperty ${pattern} for parameter ${name}`,
            );
          }

          patternProperties[pattern] = schema;
        }

        if (required) {
          const parentRequired = parentObjectSchema.required;
          if (!parentRequired) {
            parentObjectSchema.required = [name];
          } else {
            parentObjectSchema.required.push(name);
          }
        }
      }

      schemaForDepth.splice(depth, schemaForDepth.length - depth, schema);
    }

    return schemaForDepth[0];
  }

  /** Transforms schema properties to JSON Schema properties.
   *
   * @param {!Array<!object>} properties schema properties array.
   * @returns {!object} JSON Schema properties.
   */
  transformSchemaProperties(properties) {
    if (properties.length === 0) {
      return undefined;
    }

    const propertiesByName = Object.create(null);
    for (const [i, property] of Object.entries(properties)) {
      const { field } = property;
      if (!field || typeof field !== 'string') {
        throw new Error(
          `Invalid field '${field}' in schema properties`,
        );
      }

      if (hasOwnProperty.call(propertiesByName, field)) {
        throw new Error(
          `Duplicate field '${field}' in schema properties`,
        );
      }

      propertiesByName[field] = visit(
        this,
        this.transformSchema,
        i,
        property,
      );
    }

    return propertiesByName;
  }

  /** Transforms a schema to a JSON Schema.
   *
   * @param {!object} schema schema object.
   * @returns {!object} JSON Schema.
   */
  transformSchema(schema) {
    const {
      field,
      ...newSchema
    } = schema;
    const {
      items,
      properties,
      type,
    } = schema;

    switch (type) {
      case 'array':
        newSchema.items = visit(this, this.transformSchema, 'items', items);
        break;

      case 'object':
        newSchema.properties = properties === undefined ? undefined : visit(
          this,
          this.transformSchemaProperties,
          'properties',
          properties,
        );
        break;

      default:
        break;
    }

    return tuneSchema(this, field, newSchema);
  }

  /** Transforms a response object to an OpenAPI Response Object.
   *
   * @param {!object} response responses array item.
   * @returns {!object} OpenAPI Response Object.
   */
  transformResponse(response) {
    const {
      description,
      status,
      schema,
      ...unrecognized
    } = response;
    const unrecognizedProps = Object.keys(unrecognized);
    if (unrecognizedProps.length > 0) {
      warn('Unrecognized properties on response:', unrecognizedProps);
    }

    if (schema.field) {
      throw new Error('field on top-level schema');
    }

    return {
      description: description || undefined,
      content: {
        'application/json': {
          schema: visit(this, this.transformSchema, 'schema', schema),
        },
      },
    };
  }

  /** Transforms a responses array to an OpenAPI Responses Object.
   *
   * @param {!Array<!object>} responses responses array.
   * @returns {!object} OpenAPI Responses Object.
   */
  transformResponses(responses) {
    const responseByStatus = Object.create(null);
    for (const [i, response] of Object.entries(responses)) {
      const { status } = response;

      if (typeof status !== 'string' || !/^[2-5][0-9][0-9]$/.test(status)) {
        warn('Invalid status:', status);
      }

      if (hasOwnProperty.call(responseByStatus, status)) {
        throw new Error(`Multiple responses for status ${status}`);
      }

      responseByStatus[status] =
        visit(this, this.transformResponse, i, response);
    }

    return responseByStatus;
  }

  /** Transforms an endpoint object to a path, method name, and OpenAPI
   * Operation Object.
   *
   * @param {!object} endpoint endpoint object.
   * @returns {!{
   *   path: string,
   *   method: string,
   *   operation: !object
   * }} Path, method name, and OpenAPI Operation Object.
   */
  transformEndpoint(endpoint) {
    const {
      base_path: basePath,
      beta_programs: betaPrograms,
      body_example: example,
      body_params: bodyParams,
      changelog,
      deprecated_at: deprecatedAt,
      description,
      group,
      internal_only: internalOnly,
      path,
      path_params: pathParams,
      query_params: queryParams,
      responses,
      support_level: supportLevel,
      summary,
      tools,
      verb: method,
      ...unrecognized
    } = endpoint;
    const unrecognizedProps = Object.keys(unrecognized);
    if (unrecognizedProps.length > 0) {
      warn('Unrecognized properties on endpoint:', unrecognizedProps);
    }

    const parameters = [
      ...visit(this, this.transformPathParams, 'path_params', pathParams),
      ...visit(this, this.transformQueryParams, 'query_params', queryParams),
    ];

    // Warn if name used for docsUrl differs.
    // Currently occurs for several endpoints with "Drawings" group.
    const versionName = this[versionNameSymbol];
    if (versionName && group !== versionName) {
      warn(
        'endpoint.group (%s) differs from ancestor version.name (%s).'
        + '  Using version.name for externalDocs.url.',
        group,
        versionName,
      );
    }

    let docsUrl = this[docsUrlSymbol];
    if (docsUrl && summary) {
      docsUrl += `#${groupNameToUrlPath(summary)}`;
    }

    let combinedSummary = '';
    if (internalOnly) {
      combinedSummary += '(Internal Only)';
    }
    if (supportLevel !== 'production') {
      combinedSummary +=
        `(${supportLevel[0].toUpperCase() + supportLevel.slice(1)}) `;
    }
    combinedSummary += summary;

    let combinedDescription = description || '';
    if (betaPrograms && betaPrograms.length > 0) {
      combinedDescription += `\nPart of Beta Program: ${betaPrograms}`;
    }

    if (changelog) {
      const expectEndpoint = `${method.toUpperCase()} ${path}`;
      combinedDescription += '\n#### Changelog\n\n'
        + '| Date       | Change |\n'
        + '| ---------- | ------ |\n';
      for (const {
        breaking: clBreaking,
        datestamp: clDatestamp,
        description: clDescription,
        endpoint: clEndpoint,
        summary: clSummary,
        // FIXME: What is the meaning of support_level?
        // For example, some changelogs in weather-logs.json have
        // support_level: "alpha" for endpoints which are "production".
        // Maybe changelog item was added when endpoint was "alpha"?
        // support_level: clSupportLevel,
        type: clType,
        // TODO: versions
      } of changelog) {
        if (clEndpoint !== expectEndpoint) {
          warn(
            'Expected changelog entry to have endpoint %s, got %s',
            expectEndpoint,
            clEndpoint,
          );
        }

        // eslint-disable-next-line prefer-template
        combinedDescription += `| ${clDatestamp} | `
          + `(${clType[0].toUpperCase() + clType.slice(1)})`
          + (clBreaking ? '(BREAKING)' : '')
          + ` **${clSummary.replace(/\.?$/, '.')}**`
          + ` ${clDescription}`
          + ' |\n';
      }
    }

    const versionTools = this[versionToolsSymbol];
    const tags = tools || versionTools;
    if (tools && versionTools && !isDeepStrictEqual(tools, versionTools)) {
      warn(
        'endpoint.tools (%o) differs from ancestor version.tools (%o).'
        + '  Using endpoint.tools for tags.',
        tools,
        versionTools,
      );
    }

    return {
      path: basePath + path,
      method,
      operation: {
        operationId: camelCase(summary),
        summary: combinedSummary || undefined,
        description: combinedDescription || undefined,
        externalDocs: docsUrl ? { url: docsUrl } : undefined,
        tags,
        deprecated: deprecatedAt ? true : undefined,
        parameters: parameters.length > 0 ? parameters : undefined,
        requestBody: bodyParams.length === 0 ? undefined : {
          required: true,
          content: {
            'application/json': {
              schema: visit(
                this,
                this.transformBodyParams,
                'body_params',
                bodyParams,
              ),
              example: example || undefined,
            },
          },
        },
        responses: visit(this, this.transformResponses, 'responses', responses),
      },
    };
  }

  /** Transforms an endpoints array to an OpenAPI Paths Object.
   *
   * @param {!Array<!object>} endpoints endpoints array.
   * @returns {!object} OpenAPI Paths Object.
   */
  transformEndpoints(endpoints) {
    const paths = Object.create(null);
    for (const [i, endpoint] of Object.entries(endpoints)) {
      if (!this.options.endpointFilter
        || this.options.endpointFilter(endpoint)) {
        const { path, method, operation } =
          visit(this, this.transformEndpoint, i, endpoint);

        const pathItem = paths[path];
        if (!pathItem) {
          paths[path] = { [method]: operation };
        } else if (!pathItem[method]) {
          pathItem[method] = operation;
        } else {
          throw new Error(
            `Method ${method} appears multiple times for ${path}`,
          );
        }
      }
    }

    return paths;
  }

  /** Transforms a version object to an OpenAPI document.
   *
   * @param {!object} version version object.
   * @returns {!object} OpenAPI document.
   */
  transformVersion(version) {
    const {
      api_version: apiVersion,
      endpoints,
      name,
      product_category: productCategory,
      resource_version: resourceVersion,
      tools,

      // Checked on individual endpoints.  Ignored on version object.
      highest_support_level: highestSupportLevel,
      internal_only: internalOnly,
      beta_programs: betaPrograms,

      ...unrecognized
    } = version;

    const unrecognizedProps = Object.keys(unrecognized);
    if (unrecognizedProps.length > 0) {
      warn('Unrecognized properties on version:', unrecognizedProps);
    }

    this[docsUrlSymbol] = `https://developers.procore.com/reference/rest/v1/${
      groupNameToUrlPath(name)}`;
    this[versionNameSymbol] = name;
    this[versionToolsSymbol] = tools;
    try {
      return {
        openapi: openapiVersion,
        paths: visit(this, this.transformEndpoints, 'endpoints', endpoints),
      };
    } finally {
      this[docsUrlSymbol] = undefined;
      this[versionNameSymbol] = undefined;
      this[versionToolsSymbol] = undefined;
    }
  }

  /** Transforms a versions array to an OpenAPI document.
   *
   * @param {!Array<!object>} versions versions array.
   * @returns {!object} OpenAPI document.
   */
  transformVersions(versions) {
    if (!Array.isArray(versions)) {
      throw new TypeError('versions must be an Array');
    }

    if (versions.length > 1) {
      warn('Found %d versions.  Ignoring all but the last.', versions.length);
    }

    const last = versions.length - 1;
    return visit(this, this.transformVersion, String(last), versions[last]);
  }

  /** Transforms the root object to an OpenAPI document.
   *
   * @param {!object} doc Procore REST API document root object.
   * @returns {!object} OpenAPI document.
   */
  transformApiDoc(doc) {
    if (!doc || typeof doc !== 'object') {
      throw new TypeError('doc must be an object');
    }

    const {
      versions,

      // api_version and resource_version are handled in each version
      api_version: apiVersion,
      resource_version_list: resourceVersionList,

      ...unrecognized
    } = doc;
    const unrecognizedProps = Object.keys(unrecognized);
    if (unrecognizedProps.length > 0) {
      warn('Unrecognized properties on doc:', unrecognizedProps);
    }

    return visit(this, this.transformVersions, 'versions', versions);
  }
};

function combineOpenapis(openapiDocs) {
  const combinedPaths = Object.create(null);
  const tagsByName = new Map();
  for (const openapiDoc of openapiDocs) {
    const {
      openapi,
      tags,
      paths,
      ...unrecognized
    } = openapiDoc;

    if (!openapi.startsWith(openapiMajorMinor)) {
      throw new Error(`Unsupported OpenAPI version: ${openapi}`);
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
      if (hasOwnProperty.call(combinedPaths, pathStr)) {
        throw new Error(`Duplicate path ${pathStr}`);
      }

      combinedPaths[pathStr] = pathObj;
    }
  }

  return {
    openapi: openapiVersion,
    tags: [...tagsByName.values()],
    paths: combinedPaths,
  };
}

exports.docsToOpenapi =
function docsToOpenapi(docs, options) {
  const transformer = new exports.ProcoreApiDocToOpenApiTransformer(options);
  return combineOpenapis(docs.map((doc) => transformer.transformApiDoc(doc)));
};

exports.makeEndpointFilter =
function makeEndpointFilter(minSupportLevel, includeBetaPrograms) {
  const minIndex = supportLevels.indexOf(minSupportLevel);
  if (minIndex < 0) {
    throw new RangeError(`Unrecognized minSupportLevel '${minSupportLevel}'`);
  }

  if (!(includeBetaPrograms instanceof Set)) {
    includeBetaPrograms = new Set(includeBetaPrograms);
  }

  return function endpointFilter({
    support_level: supportLevel,
    beta_programs: betaPrograms,
    internal_only: internalOnly,
  }) {
    if (internalOnly && minIndex > 0) {
      return false;
    }

    for (const betaProgram of betaPrograms) {
      if (includeBetaPrograms.has(betaProgram)) {
        return true;
      }
    }

    const supportIndex = supportLevels.indexOf(supportLevel);
    if (supportIndex < 0) {
      warn('Unrecognized support_level:', supportLevel);
    }

    return supportIndex >= minIndex;
  };
};
