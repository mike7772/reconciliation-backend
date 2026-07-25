const SENSITIVE_FIELDS = ["password"];

function sanitize<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitize) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.includes(key) || val == null) {
      continue;
    }
    result[key] = sanitize(val);
  }
  return result as T;
}

export interface ApiResponse<T = unknown> {
  msg: string;
  error: boolean;
  statusCode: number;
  data?: T;
}

export default function ResponseJSON<T = unknown>(
  msg: string,
  statusCode: number,
  error = false,
  data?: T
): ApiResponse<T> {
  return {
    msg,
    error,
    statusCode,
    data: data === undefined ? undefined : sanitize(data),
  };
}
