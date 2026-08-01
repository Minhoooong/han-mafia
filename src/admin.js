import crypto from 'node:crypto';

export const FAST_TIMERS = Object.freeze({
  reveal: 2,
  night: 10,
  dawn: 2,
  discussion: 20,
  vote: 10,
  result: 2
});

export function isLoopbackAddress(address) {
  const value = String(address ?? '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

export function safeTokenEquals(expected, received) {
  const expectedBuffer = Buffer.from(String(expected ?? ''));
  const receivedBuffer = Buffer.from(String(received ?? ''));
  if (expectedBuffer.length === 0 || expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function randomItem(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[crypto.randomInt(items.length)];
}
