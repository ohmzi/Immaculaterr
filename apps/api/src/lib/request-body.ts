// DTO instances carry every declared field as an own property (set to
// `undefined` when the client omits it), so presence is defined by value.
export function hasProvidedValue(
  body: Record<string, unknown>,
  key: string,
): boolean {
  return body[key] !== undefined;
}
