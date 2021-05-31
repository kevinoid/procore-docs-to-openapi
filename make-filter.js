/**
 * @copyright Copyright 2016-2021 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

/** Values of support_level which have been observed in Procore docs,
 * in order of increasing support.
 */
export const supportLevels = [
  'internal',
  'alpha',
  'beta',
  'production',
];

export default function makeEndpointFilter(
  minSupportLevel,
  includeBetaPrograms,
) {
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
      this.warn('Unrecognized support_level:', supportLevel);
    }

    return supportIndex >= minIndex;
  };
}
