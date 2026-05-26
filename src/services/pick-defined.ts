/**
 * Pick properties from `source` whose values are not `undefined`.
 * Properties with `null` values ARE included - they represent explicit
 * "clear" or "set-to-null" intent (e.g., detaching an epic, clearing
 * dependencies).
 *
 * @returns A new Partial<T> containing only the requested keys whose
 *          values are not undefined.
 */
export const pickDefined = <T extends Record<string, unknown>>(
  source: T,
  keys: readonly (keyof T & string)[],
): Partial<T> => {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
};
