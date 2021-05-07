/**
 * @copyright Copyright 2016-2020 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

export default function groupNameToUrlPath(groupName) {
  if (typeof groupName !== 'string') {
    throw new TypeError('groupName must be a string');
  }

  return groupName
    // Preserve Unreserved Characters and coalesce all others to '-'
    // https://tools.ietf.org/html/rfc3986#section-2.3
    .replace(/[^A-Za-z0-9._~-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .toLowerCase();
}
