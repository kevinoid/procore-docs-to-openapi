Convert Procore API Docs to OpenAPI
===================================

[![Build Status](https://img.shields.io/github/workflow/status/kevinoid/procore-docs-to-openapi/Node.js%20CI/main.svg?style=flat&label=build)](https://github.com/kevinoid/procore-docs-to-openapi/actions?query=branch%3Amain)
[![Coverage](https://img.shields.io/codecov/c/github/kevinoid/procore-docs-to-openapi.svg?style=flat)](https://codecov.io/github/kevinoid/procore-docs-to-openapi?branch=main)
[![Dependency Status](https://img.shields.io/david/kevinoid/procore-docs-to-openapi.svg?style=flat)](https://david-dm.org/kevinoid/procore-docs-to-openapi)
[![Supported Node Version](https://img.shields.io/node/v/@kevinoid/procore-docs-to-openapi.svg?style=flat)](https://www.npmjs.com/package/@kevinoid/procore-docs-to-openapi)
[![Version on NPM](https://img.shields.io/npm/v/@kevinoid/procore-docs-to-openapi.svg?style=flat)](https://www.npmjs.com/package/@kevinoid/procore-docs-to-openapi)

This project implements a tool to convert JSON from the [Procore REST API
Documentation](https://developers.procore.com/documentation/rest-api-overview)
to [OpenAPI](https://www.openapis.org/) suitable for generating API clients.

This project is **unofficial**.  It is not affiliated with Procore
Technologies, Inc.


## Introductory Example

```sh
fetch-procore-api-docs && procore-docs-to-openapi *.json
```


## Installation

[This package](https://www.npmjs.com/package/@kevinoid/procore-docs-to-openapi) can be
installed using [npm](https://www.npmjs.com/), either globally or locally, by
running:

```sh
npm install @kevinoid/procore-docs-to-openapi
```


## API Docs

To use this module as a library, see the [API
Documentation](https://kevinoid.github.io/procore-docs-to-openapi/api).


## Contributing

Contributions are appreciated.  Contributors agree to abide by the [Contributor
Covenant Code of
Conduct](https://www.contributor-covenant.org/version/1/4/code-of-conduct.html).
If this is your first time contributing to a Free and Open Source Software
project, consider reading [How to Contribute to Open
Source](https://opensource.guide/how-to-contribute/)
in the Open Source Guides.

If the desired change is large, complex, backwards-incompatible, can have
significantly differing implementations, or may not be in scope for this
project, opening an issue before writing the code can avoid frustration and
save a lot of time and effort.


## License

This project is available under the terms of the [MIT License](LICENSE.txt).
See the [summary at TLDRLegal](https://tldrlegal.com/license/mit-license).
