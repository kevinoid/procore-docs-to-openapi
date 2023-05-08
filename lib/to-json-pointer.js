/**
 * @copyright Copyright 2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

/** Convert an Array of property names to a JSON Pointer (RFC 6901).
 *
 * @private
 * @param {!Array<string>} propPath Property names.
 * @returns {string} JSON Pointer.
 */
export default function toJsonPointer(propPath) {
  // eslint-disable-next-line prefer-template
  return '/' + propPath
    .map((p) => p.replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/');
}
