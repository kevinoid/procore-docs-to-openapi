/**
 * @copyright Copyright 2016-2020 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

function trimDashes(str) {
  let start = 0;
  while (str[start] === '-') {
    start += 1;
  }

  let end = str.length - 1;
  while (str[end] === '-') {
    end -= 1;
  }

  return str.slice(start, end + 1);
}

export default function groupNameToUrlPath(groupName) {
  if (typeof groupName !== 'string') {
    throw new TypeError('groupName must be a string');
  }

  const sanitized = groupName
    // Preserve Unreserved Characters and coalesce all others to '-'
    // https://tools.ietf.org/html/rfc3986#section-2.3
    .replaceAll(/[^A-Za-z0-9._~-]+/g, '-');
  const trimmed = trimDashes(sanitized);
  return trimmed.toLowerCase();
}
