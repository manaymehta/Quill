/**
 * Client-side MongoDB-compliant 24-character hexadecimal ObjectId generator.
 *
 * Format matches official BSON specification:
 * - 4-byte timestamp (seconds since Unix epoch)
 * - 5-byte random value (cryptographically secure)
 * - 3-byte incrementing counter
 *
 * This provides immutable identity from frame 0 for optimistic creations,
 * avoiding temporary ID states and eliminating identity reconciliation complexity.
 */

let counter = Math.floor(Math.random() * 0x1000000);

export const generateObjectId = () => {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const randomBytes = Array.from(crypto.getRandomValues(new Uint8Array(5)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  counter = (counter + 1) % 0x1000000;
  const counterHex = counter.toString(16).padStart(6, '0');
  return `${timestamp}${randomBytes}${counterHex}`.toLowerCase();
};
