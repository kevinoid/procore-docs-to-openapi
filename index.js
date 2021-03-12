/**
 * @copyright Copyright 2016-2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 * @module procore-docs-to-openapi
 */

'use strict';

const assert = require('assert');
const camelCase = require('camelcase');
const { debuglog } = require('util');

const groupNameToUrlPath = require('./lib/group-name-to-url-path.js');

const debug = debuglog('procore-docs-to-openapi');
const warn = debug;

const indentIncrement = 2;

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

function checkEnum(enumValues) {
  if (enumValues !== undefined
    && enumValues !== null
    && !Array.isArray(enumValues)) {
    warn('Unexpected non-Array enum value:', enumValues);
  }

  // Procore docs add enum: [] to non-enumerated parameters.
  return enumValues && enumValues.length > 0 ? enumValues : undefined;
}

function removeMatch(string, match) {
  assert.strictEqual(match.input, string);
  return string.slice(0, match.index)
    + string.slice(match.index + match[0].length);
}

function tuneSchema(name, schema) {
  name = name || '';
  let description = schema.description || '';

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

function paramToSchema(param) {
  const {
    description,
    enum: enumValues,
    name,
    type,
  } = param;
  const schema = {
    description: description || undefined,
    type,
    enum: checkEnum(enumValues),
  };
  return tuneSchema(name, schema);
}

function paramsToParams(params, paramsIn, options) {
  const oasParams = [];
  let prevSchema;
  for (const param of params) {
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
      warn('Unrecognized properties on %s_param:', paramsIn, unrecognizedProps);
    }

    if (type === 'object') {
      // Without indentation, how do we know which of the following params
      // are properties?
      throw new Error('Unsupported parameter with type object');
    }

    const schema = paramToSchema(param);
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

function bodyParamsToSchema(params) {
  // The Procore docs represent schema hierarchy for body using indentation.
  // Keep track of most recent schema for each indent depth, so child schema
  // can be matched to parent.
  const schemaForDepth = [{ type: 'object' }];
  for (const param of params) {
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

    if (indentation < indentIncrement || indentation % indentIncrement !== 0) {
      throw new Error(
        `indentation ${indentation} is not a multiple of ${indentIncrement}`,
      );
    }

    const depth = indentation / indentIncrement;
    const parentSchema = schemaForDepth[depth - 1];
    if (!parentSchema) {
      throw new Error(
        `param ${name} has no parent at indent ${depth * indentIncrement}`,
      );
    }

    const schema = paramToSchema(param);
    const parentType = parentSchema.type;
    if (parentType === 'object') {
      if (!name) {
        throw new Error('missing name for child param of object');
      }

      const parentProperties = parentSchema.properties;
      if (!parentProperties) {
        parentSchema.properties = { [name]: schema };
      } else if (!parentProperties[name]) {
        parentProperties[name] = schema;
      } else {
        throw new Error(`duplicate property ${name} for parameter`);
      }
    } else if (parentType === 'array') {
      if (name === null) {
        if (parentSchema.items) {
          throw new Error(
            `item schema for array with existing item schema: ${
              JSON.stringify(parentSchema.items)}`,
          );
        }

        parentSchema.items = schema;
      } else if (!parentSchema.items) {
        parentSchema.items = {
          type: 'object',
          properties: {
            [name]: schema,
          },
        };
      } else {
        const { items } = parentSchema;
        const { properties } = items;
        if (items.type !== 'object' || !properties) {
          throw new Error(`property ${name} for array of non-object items`);
        }
        if (hasOwnProperty.call(properties, name)) {
          throw new Error(
            `duplicate property ${name} for array item parameter`,
          );
        }
        properties[name] = schema;
      }
    } else {
      throw new Error(
        `param ${name} is child of non-object/array type ${parentType}`,
      );
    }

    if (required) {
      const parentRequired = parentSchema.required;
      if (!parentRequired) {
        parentSchema.required = [name];
      } else {
        parentSchema.required.push(name);
      }
    }

    schemaForDepth.splice(depth, schemaForDepth.length - depth, schema);
  }

  return schemaForDepth[0];
}

function schemaPropertiesToProperties(properties) {
  const propertiesByName = Object.create(null);
  for (const { field, ...property } of properties) {
    // eslint-disable-next-line no-use-before-define
    propertiesByName[field] = responseSchemaToSchema(property, field);
  }

  return propertiesByName;
}

function responseSchemaToSchema(schema, name) {
  if (schema.field) {
    throw new Error('field on top-level schema');
  }

  let newSchema;
  switch (schema.type) {
    case 'array':
      newSchema = {
        ...schema,
        items: responseSchemaToSchema(schema.items),
      };
      break;

    case 'object':
      newSchema = {
        ...schema,
        properties: schemaPropertiesToProperties(schema.properties),
      };
      break;

    default:
      newSchema = {
        ...schema,
      };
      break;
  }

  return tuneSchema(name, newSchema);
}

function responsesToResponses(responses) {
  const responseByStatus = {};
  for (const response of responses) {
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

    if (responseByStatus[status]) {
      throw new Error(`Multiple responses for status ${status}`);
    }

    responseByStatus[status] = {
      description: description || undefined,
      content: {
        'application/json': {
          schema: responseSchemaToSchema(schema),
        },
      },
    };
  }

  return responseByStatus;
}

function endpointToOperation(endpoint, options) {
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
    ...paramsToParams(pathParams, 'path', options),
    ...paramsToParams(queryParams, 'query', options),
  ];

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
      support_level: clSupportLevel,
      type: clType,
      versions: clVersions,
    } of changelog) {
      if (clEndpoint !== expectEndpoint) {
        warn(
          'Expected changelog entry to have endpoint %s, got %s',
          expectEndpoint,
          clEndpoint,
        );
      }
      if (clSupportLevel.toLowerCase() !== supportLevel) {
        // TODO: Add column for support level?
        // FIXME: How to reconcile with options.minSupportLevel?
        warn(
          'Expected changelog entry to have support_level %s, got %s',
          supportLevel,
          clSupportLevel.toLowerCase(),
        );
      }
      if (clVersions.length !== 1 || clVersions[0] !== '1.0') {
        // TODO: Add column for versions (or min version?)?
        // FIXME: How to reconcile with parent version object?
        warn(
          'Expected changelog entry to have versions %o, got %o',
          ['1.0'],
          clVersions,
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

  return {
    path: basePath + path,
    method,
    operation: {
      operationId: camelCase(summary),
      summary: combinedSummary || undefined,
      description: combinedDescription || undefined,
      tags: group ? [group] : undefined,
      deprecated: deprecatedAt ? true : undefined,
      parameters: parameters.length > 0 ? parameters : undefined,
      requestBody: bodyParams.length === 0 ? undefined : {
        required: true,
        content: {
          'application/json': {
            schema: bodyParamsToSchema(bodyParams, options),
            example: example || undefined,
          },
        },
      },
      responses: responsesToResponses(responses, options),
    },
  };
}

function checkVersions(apiVersion, resourceVersion) {
  if (apiVersion !== 1) {
    warn('Unexpected api_version:', apiVersion);
  }

  if (resourceVersion !== 0) {
    warn('Unexpected resource_version:', resourceVersion);
  }
}

function versionToOpenapi(version, options) {
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

  checkVersions(apiVersion, resourceVersion);

  const tagDocsUrl = `https://developers.procore.com/reference/rest/v1/${
    groupNameToUrlPath(name)}`;

  const opTags = [name];
  const paths = Object.create(null);
  for (const endpoint of endpoints) {
    if (options.endpointFilter && !options.endpointFilter(endpoint)) {
      continue; // eslint-disable-line no-continue
    }

    const { path, method, operation } = endpointToOperation(endpoint, options);

    if (operation.tags === undefined) {
      operation.tags = opTags;
    } else {
      assert.deepStrictEqual(
        operation.tags,
        opTags,
        'endpoint.group matches version.name',
      );
    }

    const pathItem = paths[path];
    if (!pathItem) {
      paths[path] = { [method]: operation };
    } else if (!pathItem[method]) {
      pathItem[method] = operation;
    } else {
      throw new Error(`Method ${method} appears multiple times for ${path}`);
    }
  }

  return {
    openapi: openapiVersion,
    tags: [
      {
        name,
        externalDocs: {
          url: tagDocsUrl,
        },
      },
    ],
    paths,
  };
}

function versionsToOpenapi(versions, options) {
  if (!Array.isArray(versions)) {
    throw new TypeError('versions must be an Array');
  }

  if (versions.length > 1) {
    warn('Found %d versions.  Ignoring all but the last.', versions.length);
  }

  return versionToOpenapi(versions[versions.length - 1], options);
}

exports.docToOpenapi =
function docToOpenapi(doc, options = {}) {
  if (!doc || typeof doc !== 'object') {
    throw new TypeError('doc must be an object');
  }
  if (!options || typeof options !== 'object') {
    throw new TypeError('options must be an object or undefined');
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

  return versionsToOpenapi(versions, options);
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

    for (const tag of tags) {
      const tagName = tag.name;
      const oldTag = tagsByName.get(tagName);
      if (oldTag) {
        assert.deepStrictEqual(tag, oldTag, `Tag ${tagName} must match`);
      } else {
        tagsByName.set(tagName, tag);
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
  return combineOpenapis(docs.map((doc) => exports.docToOpenapi(doc, options)));
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
