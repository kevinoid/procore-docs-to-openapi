#!/usr/bin/env node
/**
 * Executable to convert Procore API docs JSON files to OpenAPI.
 *
 * @copyright Copyright 2017-2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 * @module procore-docs-to-openapi/bin/procore-docs-to-openapi
 */

'use strict';

const { readFile } = require('fs');
const { promisify } = require('util');
const Yargs = require('yargs/yargs');

const packageJson = require('../package.json');
const {
  ProcoreApiDocToOpenApiTransformer,
  combineTransformedOpenapi,
} = require('..');

// Note: fs.promises.readFile only accepts FileHandle, not number FD
const readFileP = promisify(readFile);

async function readJson(filename) {
  const jsonData = await readFileP(
    filename === '-' ? 0 : filename,
    { encoding: 'utf8' },
  );
  return JSON.parse(jsonData);
}

/** Options for command entry points.
 *
 * @typedef {{
 *   env: !object<string,string>,
 *   stdin: !module:stream.Readable,
 *   stdout: !module:stream.Writable,
 *   stderr: !module:stream.Writable
 * }} CommandOptions
 * @property {!object<string,string>} env Environment variables.
 * @property {!module:stream.Readable} stdin Stream from which input is read.
 * @property {!module:stream.Writable} stdout Stream to which output is
 * written.
 * @property {!module:stream.Writable} stderr Stream to which errors and
 * non-output status messages are written.
 */
// const CommandOptions;

/** Entry point for this command.
 *
 * @param {Array<string>} args Command-line arguments.
 * @param {!CommandOptions} options Options.
 * @param {function(number)} callback Callback with exit code.
 */
function procoreDocsToOpenapiCmd(args, options, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('callback must be a function');
  }

  if (args !== undefined
      && args !== null
      && Math.floor(args.length) !== args.length) {
    throw new TypeError('args must be Array-like');
  }

  if (!options || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }

  if (!options.stdin || typeof options.stdin.on !== 'function') {
    throw new TypeError('options.stdin must be a stream.Readable');
  }
  if (!options.stdout || typeof options.stdout.write !== 'function') {
    throw new TypeError('options.stdout must be a stream.Writable');
  }
  if (!options.stderr || typeof options.stderr.write !== 'function') {
    throw new TypeError('options.stderr must be a stream.Writable');
  }

  if (args.length >= 2) {
    // Strip "node" and script name, ensure args are strings
    args = Array.prototype.slice.call(args, 2).map(String);
  } else {
    args = [];
  }

  const yargs = new Yargs()
    .parserConfiguration({
      'parse-numbers': false,
      'parse-positional-numbers': false,
      'dot-notation': false,
      'duplicate-arguments-array': false,
      'flatten-duplicate-arrays': false,
      'greedy-arrays': false,
      'strip-aliased': true,
      'strip-dashed': true,
    })
    .usage('Usage: $0 [options] [JSON files...]')
    .help()
    .alias('help', 'h')
    .alias('help', '?')
    .option('quiet', {
      alias: 'q',
      describe: 'Print less output',
      count: true,
    })
    .option('verbose', {
      alias: 'v',
      describe: 'Print more output',
      count: true,
    })
    .version(`${packageJson.name} ${packageJson.version}`)
    .alias('version', 'V')
    .strict();
  yargs.parse(args, (errYargs, argOpts, output) => {
    if (errYargs) {
      options.stderr.write(`${output || errYargs}\n`);
      callback(1);
      return;
    }

    if (output) {
      options.stdout.write(`${output}\n`);
    }

    if (argOpts.help || argOpts.version) {
      callback(0);
      return;
    }

    const filenames = argOpts._;
    if (filenames.length === 0) {
      if (options.stdin.isTTY) {
        options.stderr.write(
          'Warning: No filename given.  Reading Procore API JSON from stdin.\n',
        );
      }

      filenames.push('-');
    }

    // Parse arguments then call API function with parsed options
    const cmdOpts = {
      verbosity: argOpts.verbose - argOpts.quiet,
    };

    // eslint-disable-next-line promise/catch-or-return
    Promise.all(filenames.map(readJson))
      .then((docs) => {
        const transformer = new ProcoreApiDocToOpenApiTransformer();
        const openapiDocs =
          docs.map((doc) => transformer.transformApiDoc(doc));
        options.stdout.write(JSON.stringify(
          combineTransformedOpenapi(openapiDocs),
          undefined,
          2,
        ));
      })
      .then(
        () => 0,
        (err) => {
          options.stderr.write(`${err.stack}\n`);
          return 1;
        },
      )
      // Note: nextTick for unhandledException (like util.callbackify)
      .then((exitCode) => process.nextTick(callback, exitCode));
  });
}

procoreDocsToOpenapiCmd.default = procoreDocsToOpenapiCmd;
module.exports = procoreDocsToOpenapiCmd;

if (require.main === module) {
  // This file was invoked directly.
  // Note:  Could pass process.exit as callback to force immediate exit.
  procoreDocsToOpenapiCmd(process.argv, process, (exitCode) => {
    process.exitCode = exitCode;
  });
}
