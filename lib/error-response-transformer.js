/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import { isDeepStrictEqual } from 'node:util';

import OpenApiTransformerBase from 'openapi-transformer-base';
import visit from 'openapi-transformer-base/visit.js';

const errorSchema = {
  type: 'object',
  properties: {
    code: {
      type: 'integer',
      format: 'int32',
    },
    message: {
      type: 'string',
    },
    fields: {
      type: 'string',
    },
    reason: {
      description:
        'A human-readable code providing additional detail on the cause of the error.',
      type: 'string',
    },
  },
};
const errorContent = {
  'application/json': {
    schema: errorSchema,
  },
};
const genericObjectResponse = {
  content: {
    'application/json': {
      schema: {
        type: 'object',
      },
    },
  },
};

// Note: Descriptions from
// https://developers.procore.com/documentation/restful-api-concepts
const componentsResponses = {
  BadRequest: {
    description:
      '**400 Bad Request** - The request was invalid or could not be understood by the server. Resubmitting the request will likely result in the same error.',
    content: errorContent,
  },
  Unauthorized: {
    description: '**401 Unauthorized** - Your API key is missing.',
    content: errorContent,
  },
  Forbidden: {
    description:
      '**403 Forbidden** - The application is attempting to perform an action it does not have privileges to access. Verify your API key belongs to an enabled user with the required permissions.',
    content: errorContent,
  },
  NotFound: {
    description:
      '**404 Not Found** - The resource was not found with the given identifier. Either the URL given is not a valid API, or the ID of the object specified in the request is invalid.',
    content: errorContent,
  },
  /* FIXME: Which operations can return this error?  None currently documented.
  NotAcceptable: {
    description:
      '**406 Not Acceptable** - The request contains references to non-existent fields.',
    content: errorContent,
  },
  */
  Conflict: {
    description:
      '**409 Conflict** - The request attempts to create a duplicate. For employees, duplicate emails are not allowed. For lists, duplicate values are not allowed.',
    content: errorContent,
  },
  UnprocessableEntity: {
    description:
      '**422 Unprocessable Entity** - The structure, syntax, etc of the API call was correct, but due to business logic the server is unable to process the request.',
    content: errorContent,
  },
  LimitExceeded: {
    description:
      '**429 Limit Exceeded** - API rate limit exceeded.  See https://developers.procore.com/documentation/rate-limiting',
    headers: {
      'X-Rate-Limit-Limit': {
        description: 'The total number of requests per 60 minute window.',
        required: true,
        schema: {
          type: 'integer',
          exclusiveMinimum: 0,
        },
        example: 3600,
      },
      'X-Rate-Limit-Remaining': {
        description:
          'The number of requests you are allowed to make in the current 60 minute window.',
        required: true,
        schema: {
          type: 'integer',
          minimum: 0,
        },
        example: 3599,
      },
      'X-Rate-Limit-Reset': {
        description: 'The Unix timestamp for when the next window begins.',
        required: true,
        schema: {
          type: 'integer',
          // Could use a tighter bound (now() - slew), but likely to be more
          // confusing for users, and not useful for generators.
          // 0 may be useful for generating code with unsigned types.
          exclusiveMinimum: 0,
        },
        example: 1466182244,
      },
    },
    content: errorContent,
  },
  InternalServerError: {
    description:
      '**500 Internal Server Error** - The server encountered an error while processing your request and failed.',
    content: errorContent,
  },
  GatewayError: {
    description:
      '**502 Gateway Error** - The load balancer or web server had trouble connecting to the ACME app. Please try the request again.',
    content: errorContent,
  },
  ServiceUnavailable: {
    description:
      '**503 Service Unavailable** - The service is temporarily unavailable. Please try the request again.',
    content: errorContent,
  },
};

const codeToResponseNames = Object.assign(Object.create(null), {
  400: ['BadRequest'],
  401: ['Unauthorized'],
  403: ['Forbidden'],
  404: ['NotFound'],
  406: ['NotAcceptable'],
  409: ['Conflict'],
  422: ['UnprocessableEntity'],
  429: ['LimitExceeded'],
  500: ['InternalServerError'],
  502: ['GatewayError'],
  503: ['ServiceUnavailable'],
});

/** Responses applicable to every operation which should be added when not
 * present.
 *
 * @private
 */
const ubiquitousResponses = {
  429: { $ref: '#/components/responses/LimitExceeded' },
  500: { $ref: '#/components/responses/InternalServerError' },
  502: { $ref: '#/components/responses/GatewayError' },
  503: { $ref: '#/components/responses/ServiceUnavailable' },
};

function isResponseEqual(response1, response2) {
  let response1NoDesc = response1;
  if (hasOwnProperty.call(response1, 'description')) {
    const { description, ...noDesc } = response1;
    response1NoDesc = noDesc;
  }

  let response2NoDesc = response2;
  if (hasOwnProperty.call(response2, 'description')) {
    const { description, ...noDesc } = response2;
    response2NoDesc = noDesc;
  }

  return isDeepStrictEqual(response1NoDesc, response2NoDesc);
}

function addComponentsResponses(responses) {
  if (responses === undefined) {
    // Deep clone componentsResponses as new components.responses
    return JSON.parse(JSON.stringify(componentsResponses));
  }

  // Merge componentsResponses into components.responses
  const newResponses = { ...responses };
  for (const [responseName, response] of Object.keys(componentsResponses)) {
    if (hasOwnProperty.call(responses, responseName)) {
      const oldResponse = responses[responseName];
      if (!isDeepStrictEqual(response, oldResponse)) {
        throw new Error(
          `components.responses.${responseName} already exists`,
        );
      }
    } else {
      newResponses[responseName] = JSON.parse(JSON.stringify(response));
    }
  }

  return newResponses;
}

/** Transformer to move common error responses to components and add missing
 * error responses to operations.
 */
export default class ErrorResponseTransformer extends OpenApiTransformerBase {
  // eslint-disable-next-line class-methods-use-this
  transformResponses(responses) {
    const newResponses = {
      ...ubiquitousResponses,
      ...responses,
    };
    for (const [code, response] of Object.entries(responses)) {
      const responseNames = codeToResponseNames[code];
      if (!responseNames) {
        continue;
      }

      for (const [i, responseName] of Object.entries(responseNames)) {
        const namedResponse = componentsResponses[responseName];
        if (isResponseEqual(response, namedResponse)
          // Replace generic object with first named response
          || (i === '0' && isResponseEqual(response, genericObjectResponse))) {
          const responseRef = {
            $ref: `#/components/responses/${responseName}`,
          };
          if (response.description
            && !namedResponse.description.includes(response.description)) {
            responseRef.description = response.description;
          }
          newResponses[code] = responseRef;
          break;
        }
      }

      /* TODO: Investigate whether documented schema variants are actually
       * returned by the API, and whether they can be returned from any path
       * (i.e. response content should be schema union) or always returned
       * from specific paths (i.e. single response-specific schema) or
       * conditionally from specific paths.
      if (!foundMatch) {
        this.warn('Unexpected response for %s: %o', code, response);
      }
       */
    }
    return newResponses;
  }

  transformComponents(components) {
    return {
      ...components,
      responses: visit(
        this,
        addComponentsResponses,
        'responses',
        components && components.responses,
      ),
    };
  }

  transformOpenApi(openApi) {
    return {
      ...openApi,
      components: visit(
        this,
        this.transformComponents,
        'components',
        openApi.components,
      ),
      paths: visit(
        this,
        this.transformPaths,
        'paths',
        openApi.paths,
      ),
    };
  }
}
