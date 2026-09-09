require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initBroadcaster } = require('./realtime/broadcaster');

const PORT = process.env.PORT || 5000;

// Create an explicit HTTP server so that both Express and the WebSocket
// server can share the same port without requiring an extra process.
const httpServer = http.createServer(app);

// Attach WebSocket server + Redis subscriber → broadcaster wiring.
initBroadcaster(httpServer);

httpServer.listen(PORT, () => {
  console.log(`🚀 CartSync backend server listening on port ${PORT}`);
  console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}`);
});

