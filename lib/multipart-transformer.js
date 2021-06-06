/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import { JsonPointer, setValueAtPath } from 'json-ptr';
import OpenApiTransformerBase from 'openapi-transformer-base';

const { get } = JsonPointer;

/** Recognized names of object property for attachments array.
 *
 * @private
 */
const attachmentItemPropNameSet = new Set([
  'attachment_item',
  'attachments_to_upload_item',
  'file_item',
  'image_item',
]);

/** Recognized suffixes for description property of multipart attachment (in
 * sorted order).
 *
 * @private
 */
// TODO: Combine into single RegExp for faster matching?
const multipartDescriptionSuffixes = [
  ' Note that it\'s only possible to post a\n  file using a multipart/form-data body (see RFC 2388). Most HTTP\n  libraries will do the right thing when you pass in an open file or\n  IO stream.',
  ' Note that it\'s only possible to post a\nfile using a multipart/form-data body (see RFC 2388). Most HTTP\nlibraries will do the right thing when you pass in an open file or\nIO stream. Alternatively you can use an upload_uuid (see Company\nUploads or Project Uploads). You should not use both file and\nupload_uuid fields in the same request.',
  ' Note that it\'s only possible to post a\nfile using a multipart/form-data body (see RFC 2388). Most HTTP\nlibraries will do the right thing when you pass in an open file or\nIO stream. Alternatively you can use attachment_upload_uuids. You should not\nuse both file and upload_uuid fields in the same request.',
  ' Note that it\'s only possible to post a\nfile using a multipart/form-data body (see RFC 2388). Most HTTP\nlibraries will do the right thing when you pass in an open file or\nIO stream. Alternatively you can use attachment_upload_uuids. You should not\nuse both file and upload_uuid fields in the same request.',
  ' Note that it\'s only possible to post a\nfile using a multipart/form-data body (see RFC 2388). Most HTTP\nlibraries will do the right thing when you pass in an open file or\nIO stream. Alternatively you can use snapshot_upload_uuid. You should not\nuse both file and upload_uuid fields in the same request.',
  ' Note that it\'s only possible to post a\nfile using a multipart/form-data body (see RFC 2388). Most HTTP\nlibraries will do the right thing when you pass in an open file or\nIO stream. Alternatively you can use snapshot_upload_uuid. You should not\nuse both file and upload_uuid fields in the same request.',
  ' To upload attachments you must upload the entire payload as `multipart/form-data` content-type and specify each parameter as form-data together with `attachments[]` as files.',
  ' you must upload the entire payload as `multipart/form-data` content-type',
  'To upload drawings you must upload the entire payload as `multipart/form-data` content-type and specify each parameter as form-data together with `files[]` as files.\n*Required only if upload_uuids is empty',
  '\nTo upload a fillable PDF you must upload the entire payload as `multipart/form-data` content-type and\nspecify each parameter as form-data together with `fillable_pdf` as files.',
  '\nTo upload an attachment you must upload the entire payload as `multipart/form-data` content-type \nwith the `attachment` file.\n',
  '\nTo upload an attachment you must upload the entire payload as `multipart/form-data` content-type and\nspecify each parameter as form-data together with the `attachment` file.',
  '\nTo upload an attachment you must upload the entire payload as `multipart/form-data` content-type and\nspecify each parameter as form-data together with the `signature` file.',
  '\nTo upload an attachment you must upload the entire payload as `multipart/form-data` content-type\nwith the `attachment` file.',
  '\nTo upload an attachment, you must upload the entire payload as `multipart/form-data` content-type\nand specify each parameter as form-data together with `data` file.',
  '\nTo upload an office logo you must upload whole payload as `multipart/form-data` content-type and\nspecify each parameter as form-data together with `office[logo]` as file.',
  '\nTo upload attachments you must upload the entire payload as `multipart/form-data` content-type and\nspecify each parameter as form-data together with `attachments[]` as files.',
  '\nTo upload attachments you must upload the entire payload as `multipart/form-data` content-type and\nspecify each parameter as form-data together with `attachments_to_upload[]` as files.',
  '\nTo upload attachments you must upload the entire payload as a `multipart/form-data` content-type and\nspecify each parameter as form-data together with `attachments[]` as files.',
  '\nTo upload avatar you must upload whole payload as `multipart/form-data` content-type and\nspecify each parameter as form-data together with `user[avatar]` as file.',
  '\nTo upload images you must upload the entire payload as `multipart/form-data` content-type and\nspecify each parameter as form-data together with `punch_item[images][0]` as files. `punch_item[images][0]` and `punch_item[images][1]`\nand so forth if you want to attach multiple images.',
  '\n\nTo upload attachments you must upload the entire payload as `multipart/form-data` content-type and\nspecify each parameter as form-data together with `attachments[]` as files.',
];

function removeMultipartDescriptionSuffix(description) {
  for (const suffix of multipartDescriptionSuffixes) {
    if (description.endsWith(suffix)) {
      return description.slice(0, -suffix.length);
    }
  }

  return description;
}

function isMultipartArraySchema(schema) {
  const { type, items } = schema;
  if (type !== 'array'
    || items === null
    || typeof items !== 'object') {
    return false;
  }

  const {
    type: itemType,
    properties: itemProps,
  } = items;
  if (itemType !== 'object'
    || itemProps === null
    || typeof itemProps !== 'object') {
    return false;
  }

  const itemPropNames = Object.keys(itemProps);
  if (itemPropNames.length !== 1) {
    return false;
  }

  const itemPropName = itemPropNames[0];
  if (!attachmentItemPropNameSet.has(itemPropName)) {
    return false;
  }

  const itemProp = itemProps[itemPropName];
  if (itemProp === null || typeof itemProp !== 'object') {
    return false;
  }

  return itemProp.type === 'string';
}

function collectMultipartProperties(schema, multipart, propPath) {
  if (!schema || !schema.properties) {
    return;
  }

  for (const [propName, propSchema] of Object.entries(schema.properties)) {
    if (propSchema) {
      propPath.push('properties', propName);

      const { description } = propSchema;
      if (typeof description === 'string'
        && description.includes('multipart/form-data')) {
        multipart.push([...propPath]);
      } else {
        collectMultipartProperties(propSchema, multipart, propPath);
      }

      propPath.pop();
      propPath.pop();
    }
  }
}

/**
 * Transformer to convert requestBody schemas with attachments to
 * multipart/form-data suitable for the Procore API attachment convention:
 * https://developers.procore.com/documentation/attachments
 *
 * - Moves .requestBody.content from application/json to multipart/form-data.
 * - Adds .encoding to array and object properties so that nested property
 *   names are flattened to multipart field names using square bracket syntax.
 * - Removes description of multipart/form-data from schema.description, which
 *   do not add value to generated code or docs now that the information is
 *   conveyed structurally.
 */
export default class MultipartTransformer extends OpenApiTransformerBase {
  transformSchema(schema) {
    const newSchema = super.transformSchema(schema);
    if (!newSchema) {
      return newSchema;
    }

    const { description } = newSchema;
    if (typeof description !== 'string') {
      return newSchema;
    }

    const newDescription = removeMultipartDescriptionSuffix(description);
    if (newDescription === description) {
      return newSchema;
    }

    return {
      ...newSchema,
      description: newDescription,
    };
  }

  transformRequestBody(requestBody) {
    const { content } = requestBody;
    const contentTypes = Object.keys(content);
    if (contentTypes.length !== 1 || contentTypes[0] !== 'application/json') {
      this.warn(
        'Skipping requestBody with unexpected content types:',
        contentTypes,
      );
      return requestBody;
    }

    const mediaType = content['application/json'];
    const { schema } = mediaType;
    const multipartPropPaths = [];
    collectMultipartProperties(schema, multipartPropPaths, []);
    if (multipartPropPaths.length === 0) {
      return requestBody;
    }

    const schemaMulti = JSON.parse(JSON.stringify(schema));
    for (const multipartPropPath of multipartPropPaths) {
      const multipartSchema = get(schema, multipartPropPath, 0);
      if (multipartSchema.type === 'string') {
        const newSchema = {
          ...multipartSchema,
          description:
            removeMultipartDescriptionSuffix(multipartSchema.description),
          format: 'binary',
        };
        setValueAtPath(schemaMulti, newSchema, multipartPropPath);
      } else if (isMultipartArraySchema(multipartSchema)
        // Schema for attachments appears to be copied from response for
        // createGenericToolItem.  Convert anyway.
        || (multipartSchema.type === 'array'
          && multipartPropPath[1] === 'generic_tool_item')) {
        const newSchema = {
          ...multipartSchema,
          description:
            removeMultipartDescriptionSuffix(multipartSchema.description),
          // Replace items schema for object with attachment_item props
          // with a binary string.
          items: {
            type: 'string',
            format: 'binary',
          },
        };
        setValueAtPath(schemaMulti, newSchema, multipartPropPath);
      } else {
        this.warn(
          'Skipping multipart schema with unexpected structure:',
          multipartSchema,
        );
      }
    }

    let haveEncoding = false;
    const encoding = {};
    for (const [propName, propValue] of Object.entries(schema.properties)) {
      switch (propValue.type) {
        case 'boolean':
        case 'integer':
        case 'null':
        case 'number':
        case 'string':
          break;
        default:
          // Array items and nested object properties are represented as
          // separate (i.e. exploded) values "deep object" form
          // (e.g. "prop[nested1][nested2]").
          haveEncoding = true;
          encoding[propName] = {
            deepObject: true,
            explode: true,
          };
          break;
      }
    }

    return {
      ...requestBody,
      content: {
        'multipart/form-data': {
          ...mediaType,
          schema: schemaMulti,
          encoding: haveEncoding ? encoding : undefined,
          // TODO: If example can be parsed as JSON, move to schema (since it
          // is an example of the schema, not of the media type).
          // If it can't be parsed as JSON, remove it.  It's an example of
          // neither.
        },
        // TODO: If all multipartProps are not required, add application/json
        // content with multipartProps removed from schema.
      },
    };
  }

  // Transform paths of OpenAPI Object
  transformOpenApi(openApi) {
    if (!openApi
      || typeof openApi.openapi !== 'string'
      || !openApi.openapi.startsWith('3.')) {
      throw new Error(
        `Only OpenAPI 3 is currently supported, got ${openApi.openapi}`,
      );
    }

    return {
      ...openApi,
      paths: this.transformPaths(openApi.paths),
    };
  }
}
