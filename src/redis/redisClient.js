const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Publisher connection — used by services to publish events.
 * A dedicated connection is needed because a subscriber connection
 * cannot also send regular commands.
 */
const publisher = new Redis(REDIS_URL);

publisher.on('connect', () => console.log('[Redis] Publisher connected'));
publisher.on('error', (err) => console.error('[Redis] Publisher error:', err.message));

/**
 * Subscriber connection — kept separate from the publisher so that
 * it can enter subscribe mode without blocking general Redis commands.
 */
const subscriber = new Redis(REDIS_URL);

subscriber.on('connect', () => console.log('[Redis] Subscriber connected'));
subscriber.on('error', (err) => console.error('[Redis] Subscriber error:', err.message));

module.exports = { publisher, subscriber };
