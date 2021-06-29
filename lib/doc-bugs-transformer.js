/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import OpenApiTransformerBase from 'openapi-transformer-base';
import visit from 'openapi-transformer-base/visit.js';

function applyToPath(transform, obj, propPath, i) {
  if (i >= propPath.length) {
    return transform.call(this, obj);
  }

  const propName = propPath[i];
  if (!hasOwnProperty.call(obj, propName)) {
    this.warn('Expected %s on %o', propName, obj);
    return obj;
  }

  const newObj = Array.isArray(obj) ? [...obj] : { ...obj };
  newObj[propName] = visit(
    this,
    applyToPath,
    propName,
    transform,
    obj[propName],
    propPath,
    i + 1,
  );
  return newObj;
}

/** Moves an enum constraint from a schema with `type: array` to its item
 * schema.
 *
 * @private
 */
function moveEnumToItem(schema) {
  if (schema === null
    || typeof schema !== 'object'
    || Array.isArray(schema)) {
    this.warn('Expected Schema Object', schema);
    return schema;
  }

  const { type, items } = schema;
  if (type !== 'array'
    || items === null
    || typeof items !== 'object') {
    this.warn('Expected array Schema with items', schema);
    return schema;
  }

  if (items.enum !== undefined) {
    this.warn('Expected item schema without enum', items);
    return schema;
  }

  const itemType = items.type;
  const { enum: enumValues, ...newSchema } = schema;
  if (!Array.isArray(enumValues)
    || enumValues.length === 0
    // eslint-disable-next-line valid-typeof
    || !enumValues.every((v) => typeof v === itemType)) {
    this.warn(
      'Expected enum values %O to match item type %s in',
      enumValues,
      itemType,
      schema,
    );
    return schema;
  }

  newSchema.items = {
    ...items,
    enum: enumValues,
  };

  return newSchema;
}

/** Determines if a given value is a superset of another.
 *
 * Where superset is defined as:
 * 1. Any value is a superset of `undefined`.
 * 2. Any value is a superset of itself.
 * 3. A non-null object value is a superset of another non-null object value
 *    if each property value is a superset.
 * Otherwise it is not a superset.
 *
 * @private
 */
function isSuperset(value1, value2) {
  if (value2 === undefined) {
    return true;
  }

  if (typeof value1 !== 'object'
    || typeof value2 !== 'object'
    || value1 === null
    || value2 === null) {
    return value1 === value2;
  }

  for (const [prop, child2] of Object.entries(value2)) {
    const child1 = value1[prop];
    if (!isSuperset(child1, child2)) {
      return false;
    }
  }

  return true;
}

/** Removes duplicate values from a given array.
 *
 * Duplicates are determined by deep equality (using JSON stringification,
 * ignoring property order).
 *
 * @private
 */
function removeDuplicateParameters(parameters) {
  if (!Array.isArray(parameters)) {
    this.warn('Expected Array', parameters);
    return parameters;
  }

  const inNameToParam = new Map();
  for (const parameter of parameters) {
    if (!parameter) {
      this.warn('Expected truthy Parameters', parameter);
      return parameters;
    }

    const { in: paramIn } = parameter;
    if (paramIn === undefined) {
      this.warn('Expected in on Parameter', parameter);
      return parameters;
    }

    const { name } = parameter;
    if (typeof name !== 'string'
      || name.length === 0
      || name.includes('\0')) {
      this.warn('Expected Parameter name to be a string', parameter);
      return parameters;
    }

    const inName = `${paramIn}\0${name}`;
    const prevParam = inNameToParam.get(inName);
    try {
      const prevIsSuperset = isSuperset(prevParam, parameter);
      const curIsSuperset = isSuperset(parameter, prevParam);
      if (curIsSuperset && !prevIsSuperset) {
        inNameToParam.set(inName, parameter);
      } else if (!curIsSuperset && !prevIsSuperset) {
        this.warn(
          'Neither %s parameter %s is a superset of the other',
          paramIn,
          name,
          prevParam,
          parameter,
        );
        return parameters;
      }
    } catch (errPrefer) {
      this.warn(errPrefer);
      return parameters;
    }
  }

  if (inNameToParam.size === parameters.length) {
    this.warn('Expected duplicate parameters in', parameters);
    return parameters;
  }

  return [...inNameToParam.values()];
}

/** Remove items from a schema with type object.
 *
 * It appears the items schema was inadvertently copied into this object.
 *
 * @private
 */
function removeObjectItems(schema) {
  const { type, properties } = schema;
  const { items, ...newSchema } = schema;
  if (type !== 'object'
    || typeof items !== 'object'
    || typeof properties !== 'object') {
    this.warn('Expected object schema with items and properties', schema);
    return schema;
  }

  return newSchema;
}

/** Removes requestBody from an Operation Object.
 *
 * @private
 */
function removeRequestBody(operation) {
  const { requestBody, ...newOperation } = operation;
  if (requestBody === null
    || typeof requestBody !== 'object'
    || Array.isArray(requestBody)) {
    this.warn('Expected requestBody in Operation', operation);
    return operation;
  }

  return newOperation;
}

function setAssignmentIdsSchema(schema) {
  if (schema === null || typeof schema !== 'object') {
    this.warn('Expected Schema Object', schema);
    return schema;
  }

  const { type, ...newSchema } = schema;
  if (type !== 'array') {
    this.warn('Expected Schema Object with type array', schema);
    return schema;
  }

  newSchema.oneOf = [
    {
      type: 'array',
      items: {
        type: 'integer',
      },
    },
    { const: 'none' },
  ];

  return newSchema;
}

/** Sets `type` on a schema to match the type of its `enum` values.
 *
 * @private
 */
function setEnumType(schema) {
  if (schema === null
    || typeof schema !== 'object'
    || Array.isArray(schema)) {
    this.warn('Expected Schema Object', schema);
    return schema;
  }

  const enumValues = schema.enum;
  if (!Array.isArray(enumValues) || enumValues.length === 0) {
    this.warn('Expected non-empty enum', schema);
    return schema;
  }

  let type;
  for (const enumValue of enumValues) {
    const enumValueType = typeof enumValue;
    if (type === undefined) {
      type = enumValueType;
    } else if (type !== enumValueType) {
      this.warn('Expected all enum values to have the same type', schema);
      return schema;
    }
  }

  return {
    ...schema,
    type,
  };
}

/** Transformer to fix bugs in the Procore REST API documentation.
 */
export default class DocBugsTransformer extends OpenApiTransformerBase {
  transformOpenApi(openApi) {
    openApi = applyToPath.call(
      this,
      removeObjectItems,
      openApi,
      [
        'paths',
        '/rest/v1.0/potential_change_orders/sync',
        'patch',
        'responses',
        '200',
        'content',
        'application/json',
        'schema',
        'properties',
        'errors',
        'items',
      ],
      0,
    );

    // Remove requestBody from "Show Actual Production Quantity" (GET)
    // Inadvertently copied from "Update Actual Production Quantity"?
    openApi = applyToPath.call(
      this,
      removeRequestBody,
      openApi,
      [
        'paths',
        '/rest/v1.0/projects/{project_id}/actual_production_quantities/{id}',
        'get',
      ],
      0,
    );

    // Remove duplicate "id" path parameter from "Show a Bid within a Project"
    // in bids.json
    openApi = applyToPath.call(
      this,
      removeDuplicateParameters,
      openApi,
      [
        'paths',
        '/rest/v1.0/projects/{project_id}/bids/{id}',
        'get',
        'parameters',
      ],
      0,
    );

    // Fix type of "Procore Item Type" enum in bim-viewpoint-associations.json
    openApi = applyToPath.call(
      this,
      setEnumType,
      openApi,
      [
        'paths',
        '/rest/v1.0/bim_viewpoints/{bim_viewpoint_id}/associations',
        'delete',
        'parameters',
        '3',
        'schema',
      ],
      0,
    );

    // Remove duplicate "view" query parameter from "List generic tool items"
    // in correspondences.json
    openApi = applyToPath.call(
      this,
      removeDuplicateParameters,
      openApi,
      [
        'paths',
        '/rest/v1.0/projects/{project_id}/generic_tools/{generic_tool_id}/generic_tool_items',
        'get',
        'parameters',
      ],
      0,
    );

    // Disambiguate operations with title "Delete Item's Attachments"
    // in daily-logs.json
    openApi = applyToPath.call(
      this,
      function changeTitle(operation) {
        const expect = '(Alpha) Delete Item\'s Attachments';
        if (operation === null
          || typeof operation !== 'object'
          || operation.summary !== expect) {
          this.warn('Expected Operation with summary "%s"', expect, operation);
          return operation;
        }

        return {
          ...operation,
          operationId: 'deleteItemAttachment',
          summary: '(Alpha) Delete Item Attachment',
        };
      },
      openApi,
      [
        'paths',
        '/rest/v1.0/attachments/{id}',
        'delete',
      ],
      0,
    );

    // Remove duplicate "project_id" and "id" path parameter and duplicate
    // "incident_id" query parameter from "Retrieve Environmental" in
    // environmentals.json
    openApi = applyToPath.call(
      this,
      removeDuplicateParameters,
      openApi,
      [
        'paths',
        '/rest/v1.0/projects/{project_id}/recycle_bin/incidents/environmentals/{id}/restore',
        'patch',
        'parameters',
      ],
      0,
    );

    // Remove duplicate "project_id" and "id" path parameter and duplicate
    // "incident_id" query parameter from "Retrieve Property Damage" in
    // property-damages.json
    openApi = applyToPath.call(
      this,
      removeDuplicateParameters,
      openApi,
      [
        'paths',
        '/rest/v1.0/projects/{project_id}/recycle_bin/incidents/property_damages/{id}/restore',
        'patch',
        'parameters',
      ],
      0,
    );

    // Move enum from array schema to item schema in
    // filters[corresponding_status] query parameter of "List Responses in the
    // Specified Item Response Set" endpoint of item-response-sets.json.
    // FIXME: Is this a bug or how the Procore Docs JSON format is intended?
    openApi = applyToPath.call(
      this,
      moveEnumToItem,
      openApi,
      [
        'paths',
        '/rest/v1.0/companies/{company_id}/checklist/item/response_sets/{response_set_id}/responses',
        'get',
        'parameters',
        '2',
        'schema',
      ],
      0,
    );

    // Move enum from array schema to item schema in
    // filters[corresponding_status] query parameter of "List Responses"
    // endpoint of responses.json.
    // FIXME: Is this a bug or how the Procore Docs JSON format is intended?
    openApi = applyToPath.call(
      this,
      moveEnumToItem,
      openApi,
      [
        'paths',
        '/rest/v1.0/companies/{company_id}/checklist/responses',
        'get',
        'parameters',
        '1',
        'schema',
      ],
      0,
    );

    // Fix schema for meeting_topic.assignment_ids of "Create meeting topic"
    // and "Update meeting topic".  The schema lacks an items schema.  The
    // description says it can be either an array of IDs or "none" to erase
    // assignments.
    openApi = applyToPath.call(
      this,
      setAssignmentIdsSchema,
      openApi,
      [
        'paths',
        '/rest/v1.0/meeting_topics',
        'post',
        'requestBody',
        'content',
        // Note: Changed to multipart/form-data by subsequent Transformer
        'application/json',
        'schema',
        'properties',
        'meeting_topic',
        'properties',
        'assignment_ids',
      ],
      0,
    );
    openApi = applyToPath.call(
      this,
      setAssignmentIdsSchema,
      openApi,
      [
        'paths',
        '/rest/v1.0/meeting_topics/{id}',
        'patch',
        'requestBody',
        'content',
        // Note: Changed to multipart/form-data by subsequent Transformer
        'application/json',
        'schema',
        'properties',
        'meeting_topic',
        'properties',
        'assignment_ids',
      ],
      0,
    );

    // Disambiguate operations with title "List Observation Items" in
    // observations.json
    openApi = applyToPath.call(
      this,
      function changeTitle(operation) {
        const expect = '(Internal) List Observation Items';
        if (operation === null
          || typeof operation !== 'object'
          || operation.summary !== expect) {
          this.warn('Expected Operation with summary "%s"', expect, operation);
          return operation;
        }

        return {
          ...operation,
          operationId: 'listProjectObservationItems',
          summary: '(Internal) List Project Observation Items',
        };
      },
      openApi,
      [
        'paths',
        '/rest/v1.0/projects/{project_id}/observations/items',
        'get',
      ],
      0,
    );

    // Disambiguate operations with title "Show RFI" in rfis.json
    openApi = applyToPath.call(
      this,
      function changeTitle(operation) {
        const expect = 'Show RFI';
        if (operation === null
          || typeof operation !== 'object'
          || operation.summary !== expect) {
          this.warn('Expected Operation with summary "%s"', expect, operation);
          return operation;
        }

        return {
          ...operation,
          operationId: 'showProjectRfi',
          summary: 'Show Project RFI',
        };
      },
      openApi,
      [
        'paths',
        '/rest/v1.0/projects/{project_id}/rfis/{id}',
        'get',
      ],
      0,
    );

    // Change type of filters[only_current_revision] to boolean for
    // "List Submittals" endpoint of submittal-logs.json
    openApi = applyToPath.call(
      this,
      function changeParameters(parameters) {
        if (!Array.isArray(parameters)) {
          this.warn('Expected Parameters Array', parameters);
          return parameters;
        }

        let count = 0;
        const newParameters = parameters.map((param) => {
          if (param && param.name === 'filters[only_current_revision]') {
            count += 1;
            return {
              ...param,
              schema: { type: 'boolean' },
            };
          }

          return param;
        });

        if (count !== 1) {
          this.warn(
            'Expected filters[only_current_revision] parameter once, got ',
            count,
          );
        }

        return newParameters;
      },
      openApi,
      [
        'paths',
        '/rest/v1.0/submittal_logs',
        'get',
        'parameters',
      ],
      0,
    );

    return openApi;
  }
}
