const { WebSocketServer } = require('ws');
const { subscriber } = require('../redis/redisClient');

const CHANNEL = 'stock-updates';

/** @type {WebSocketServer | null} */
let wss = null;

/**
 * Attaches a WebSocket server to an existing HTTP server and wires up
 * the Redis subscriber so every stock-update event is broadcast to all
 * currently connected WebSocket clients.
 *
 * @param {import('http').Server} httpServer - The HTTP server created by Express.
 */
function initBroadcaster(httpServer) {
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[WS] Client connected   — ${ip} (total: ${wss.clients.size})`);

    ws.on('close', () => {
      console.log(`[WS] Client disconnected — ${ip} (total: ${wss.clients.size})`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Client error — ${ip}:`, err.message);
    });
  });

  // Subscribe once; the subscriber connection is reused for the lifetime
  // of the process. ioredis automatically re-subscribes after reconnects.
  subscriber.subscribe(CHANNEL, (err) => {
    if (err) {
      console.error(`[Redis] Failed to subscribe to "${CHANNEL}":`, err.message);
    } else {
      console.log(`[Redis] Subscribed to channel "${CHANNEL}"`);
    }
  });

  subscriber.on('message', (channel, message) => {
    if (channel !== CHANNEL) return;

    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      console.warn('[Broadcaster] Received non-JSON message on stock-updates; skipping.');
      return;
    }

    let fwdCount = 0;
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
        fwdCount++;
      }
    });

    console.log(
      `[Broadcaster] Forwarded stock update (productId=${parsed.productId}, newQty=${parsed.newQty}) to ${fwdCount} client(s)`
    );
  });

  console.log('[WS] WebSocket server initialised (attached to HTTP server)');
}

module.exports = { initBroadcaster };
