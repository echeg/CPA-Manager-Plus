const CLIENT_KEY_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CLIENT_KEY_RANDOM_LENGTH = 64;

/** A new client API key: `sk-` followed by 64 alphanumeric characters from the secure RNG. */
export function generateClientKey(): string {
  const array = new Uint8Array(CLIENT_KEY_RANDOM_LENGTH);
  crypto.getRandomValues(array);
  return (
    'sk-' + Array.from(array, (b) => CLIENT_KEY_CHARSET[b % CLIENT_KEY_CHARSET.length]).join('')
  );
}
