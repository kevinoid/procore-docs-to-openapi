/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

import NullableToTypeNullTransformer
  from '@kevinoid/openapi-transformers/nullable-to-type-null.js';
import OpenApiTransformerBase from 'openapi-transformer-base';

import DateEnumTransformer from './lib/date-enum-transformer.js';
import DeprecatedTransformer from './lib/deprecated-transformer.js';
import DocBugsTransformer from './lib/doc-bugs-transformer.js';
import ErrorResponseTransformer from './lib/error-response-transformer.js';
import FormatFromContextTransformer
  from './lib/format-from-context-transformer.js';
import MultipartTransformer from './lib/multipart-transformer.js';
import TimeMinMaxTransformer from './lib/time-min-max-transformer.js';

/** OpenAPI Transformer to apply various fix-ups to the OpenAPI document
 * generated directly from the Procore API documentation JSON.
 */
export default class ProcoreFixupsTransformer extends OpenApiTransformerBase {
  constructor() {
    super();
    this.transformers = [
      new DocBugsTransformer(),
      new NullableToTypeNullTransformer(),
      new DateEnumTransformer(),
      new TimeMinMaxTransformer(),
      new FormatFromContextTransformer(),
      new DeprecatedTransformer(),
      new MultipartTransformer(),
      new ErrorResponseTransformer(),
    ];
  }

  transformOpenApi(openApi) {
    if (typeof openApi !== 'object'
      || openApi === null
      || Array.isArray(openApi)) {
      this.warn('Ignoring non-object OpenAPI', openApi);
      return openApi;
    }

    for (const transformer of this.transformers) {
      openApi = transformer.transformOpenApi(openApi);
    }

    const securityScheme = {
      type: 'oauth2',
      /* eslint-disable max-len */
      description: `OAuth 2.0 Authentication.
See: https://developers.procore.com/documentation/oauth-introduction

Documentation for Flows (i.e. Grant Types):\\
Authorization Code: https://developers.procore.com/documentation/oauth-auth-grant-flow\\
Client Credentials: https://developers.procore.com/documentation/oauth-client-credentials\\
Implicit: https://developers.procore.com/documentation/oauth-implicit-flow`,
      /* eslint-enable max-len */
      flows: {
        authorizationCode: {
          authorizationUrl:
            'https://login.procore.com/oauth/authorize?response_type=code',
          tokenUrl:
            'https://api.procore.com/oauth/authorize?response_type=code',
          refreshUrl: 'https://api.procore.com/oauth/token',
          scopes: {},
        },
        clientCredentials: {
          tokenUrl: 'https://login.procore.com/oauth/token',
          refreshUrl: 'https://api.procore.com/oauth/token',
          scopes: {},
        },
        implicit: {
          authorizationUrl:
            'https://api.procore.com/oauth/authorize?response_type=token',
          refreshUrl: 'https://api.procore.com/oauth/token',
          scopes: {},
        },
      },
    };
    const securitySchemeJson = JSON.stringify(securityScheme);

    return {
      info: {
        title: 'Procore REST API',
        version: '1.0.0',
        description:
          // From https://developers.procore.com/documentation/introduction
          'Procore\'s open Application Programming Interface (API) provides the underlying framework for developing applications and custom integrations between Procore and other software tools and technologies.',
        contact: {
          name: 'Procore Developer Support',
          email: 'apisupport@procore.com',
          url: 'https://developers.procore.com/developer_support',
        },
        termsOfService: 'https://developers.procore.com/terms_and_conditions',
        license: {
          name: 'Procore API License and Application Developer Agreement',
          url: 'https://developers.procore.com/terms_and_conditions',
        },
        'x-apiClientRegistration': 'https://developers.procore.com/signup',
        'x-apisguru-categories': [
          'project_management',
        ],
        'x-description-language': 'en',
        'x-logo': {
          backgroundColor: '#FFFFFF',
          // From https://www.procore.design/logos/
          // Full Logo:
          url: 'https://www.procore.design/images/procore_logo_fc_k.png',
          // "C" Icon Only:
          // 'https://www.procore.design/images/procore_graphicmark_fc_k.png',
        },
        'x-unofficialSpec': true,
      },
      externalDocs: {
        description: 'Procore Developer Documentation',
        url: 'https://developers.procore.com/documentation',
      },
      servers: [
        {
          url: 'https://api.procore.com',
          description: 'Production',
        },
        // https://developers.procore.com/documentation/development-environments
        {
          url: 'https://api-monthly.procore.com',
          description:
            '**Monthly Sandbox** - refreshed with current production data on a regularly scheduled basis once each month.',
        },
        {
          url: 'https://sandbox.procore.com',
          description:
            '**Development Sandbox** - automatically generated for third-party developers in their Developer Portal account and includes seed project data that can be used for testing purposes.',
        },
      ],
      // FIXME: Want to require security scheme corresponding to server
      // https://github.com/OAI/OpenAPI-Specification/issues/2628
      security: [
        { apiSecurity: [] },
        { monthlySecurity: [] },
        { sandboxSecurity: [] },
      ],
      ...openApi,
      components: {
        ...openApi.components || {},
        securitySchemes: {
          apiSecurity: securityScheme,
          // TODO [engine:node@>=15] .replaceAll()
          monthlySecurity: JSON.parse(securitySchemeJson.replace(
            /https:\/\/login\.procore\.com/g,
            'https://login-sandbox-monthly.procore.com',
          )),
          // TODO [engine:node@>=15] .replaceAll()
          sandboxSecurity: JSON.parse(securitySchemeJson.replace(
            /https:\/\/login\.procore\.com/g,
            'https://login-sandbox.procore.com',
          )),
        },
      },
    };
  }
}
