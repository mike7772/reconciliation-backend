/**
 * Caps a value to a maximum JSON-serialized size before persistence, so an
 * adversarial or accidentally huge payload (e.g. a malformed record) can't
 * be stored without bound. Returns the value unchanged if it's already
 * within the limit.
 */
export function capJsonValue(value: unknown, maxChars: number): unknown {
  const json = JSON.stringify(value);
  if (json === undefined) {
    return null;
  }
  if (json.length <= maxChars) {
    return value;
  }
  return { truncated: true, preview: json.slice(0, maxChars) };
}
