const redisUrl = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  maxRetriesPerRequest: null,
};

if (redisUrl.username) connection.username = decodeURIComponent(redisUrl.username);
if (redisUrl.password) connection.password = decodeURIComponent(redisUrl.password);
if (redisUrl.pathname.length > 1) connection.db = Number(redisUrl.pathname.slice(1));
if (redisUrl.protocol === 'rediss:') connection.tls = {};

module.exports = { connection, queueName: 'sequence-generation' };
