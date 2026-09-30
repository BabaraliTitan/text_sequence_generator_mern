require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { generationQueue } = require('./queues/generationQueue');
const textRecordRoutes = require('./routes/textRecordRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok', service: 'text-sequence-generator-api' }));
app.get('/api/health', async (req, res) => {
  const database = mongoose.connection.readyState === 1 ? 'online' : 'offline';
  let redis = 'offline';
  let worker = 'unknown';
  let queue = null;

  try {
    await generationQueue.waitUntilReady();
    const client = await generationQueue.client;
    await client.ping();
    redis = 'online';
  } catch (err) {
    redis = 'offline';
  }

  if (redis === 'online') {
    const [workersResult, countsResult] = await Promise.allSettled([
      generationQueue.getWorkersCount(),
      generationQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    ]);
    if (workersResult.status === 'fulfilled') worker = workersResult.value > 0 ? 'online' : 'offline';
    if (countsResult.status === 'fulfilled') queue = countsResult.value;
  }

  return res.json({
    status: database === 'online' && redis === 'online' && worker === 'online' ? 'online' : 'degraded',
    checks: { api: 'online', database, redis, worker },
    queue,
    queueName: 'sequence-generation',
    checkedAt: new Date().toISOString(),
  });
});
app.use('/api/records', textRecordRoutes);

// Catch-all error handler for anything that slips past route-level try/catch
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;

let server;

async function shutdown() {
  if (server) await new Promise((resolve) => server.close(resolve));
  await generationQueue.close();
  await mongoose.disconnect();
  process.exit(0);
}

connectDB().then(() => {
  server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
