const { Queue } = require('bullmq');
const { connection, queueName } = require('../config/bullmq');

const generationQueue = new Queue(queueName, {
  connection: { ...connection, maxRetriesPerRequest: 2 },
});

async function enqueueGenerationJob(generationJobId) {
  const jobId = `generation-${generationJobId}`;
  const existingJob = await generationQueue.getJob(jobId);
  if (existingJob) {
    if (await existingJob.getState() === 'failed') {
      await existingJob.retry('failed', { resetAttemptsMade: true });
    }
    return existingJob;
  }

  return generationQueue.add(
    'generate-sequence',
    { generationJobId: String(generationJobId) },
    {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }
  );
}

module.exports = { generationQueue, enqueueGenerationJob };
