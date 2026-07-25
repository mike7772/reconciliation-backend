// Curated subset of ISO 4217 currency codes. Not exhaustive by design - the
// spec requires rejecting "unsupported currency codes", so this is the
// explicit allowlist that defines "supported". Extend as needed.
export const SUPPORTED_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "HKD",
  "SGD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "INR", "BRL",
  "MXN", "ZAR", "TRY", "AED", "SAR", "ILS", "KRW", "THB", "MYR", "IDR",
  "PHP", "VND", "PKR", "EGP", "NGN", "KES", "ARS", "CLP", "COP", "PEN",
]);
