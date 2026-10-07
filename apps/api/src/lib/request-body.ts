// DTO instances carry every declared field as an own property (set to
// `undefined` when the client omits it), so presence is defined by value.
export const hasProvidedValue = (
  body: Record<string, unknown>,
  key: string,
): boolean => body[key] !== undefined;
