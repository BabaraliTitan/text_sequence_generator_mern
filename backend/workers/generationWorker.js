require('dotenv').config();
const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { connection, queueName } = require('../config/bullmq');
const { enqueueGenerationJob, generationQueue } = require('../queues/generationQueue');
const TextRecord = require('../models/TextRecord');
const GenerationJob = require('../models/GenerationJob');
const { sequenceNumberToValue } = require('../utils/sequenceGenerator');

async function getLastSequenceNumber() {
  const last = await TextRecord.findOne().sort({ sequenceNumber: -1 }).select('sequenceNumber').lean();
  return last ? last.sequenceNumber : 0;
}

async function processGeneration({ data }) {
  const generation = await GenerationJob.findById(data.generationJobId);
  if (!generation) throw new Error(`Generation job ${data.generationJobId} was not found.`);

  await GenerationJob.updateOne(
    { _id: generation._id },
    { $set: { status: 'running', error: '' } }
  );

  while (true) {
    const current = await GenerationJob.findById(generation._id).lean();
    if (!current) throw new Error(`Generation job ${generation._id} was deleted.`);

    const lastSequence = Math.max(await getLastSequenceNumber(), current.startSequence);
    if (current.cancelRequested) {
      await GenerationJob.updateOne(
        { _id: current._id },
        {
          $set: {
            status: 'cancelled',
            generated: Math.max(0, lastSequence - current.startSequence),
            lastSequence,
            activeSlot: null,
          },
        }
      );
      return;
    }

    if (lastSequence >= current.targetCount) {
      await GenerationJob.updateOne(
        { _id: current._id },
        {
          $set: {
            status: 'completed',
            generated: current.targetCount - current.startSequence,
            lastSequence: current.targetCount,
            activeSlot: null,
          },
        }
      );
      return;
    }

    const batchCount = Math.min(current.batchSize, current.targetCount - lastSequence);
    const batch = new Array(batchCount);
    for (let offset = 0; offset < batchCount; offset += 1) {
      const sequenceNumber = lastSequence + offset + 1;
      const value = sequenceNumberToValue(sequenceNumber, current.maxLength);
      if (value === null) throw new Error('Generated sequence exceeded the selected maximum length.');
      batch[offset] = { sequenceNumber, value };
    }

    await TextRecord.insertMany(batch, { ordered: true });
    await GenerationJob.updateOne(
      { _id: current._id },
      {
        $set: {
          generated: lastSequence + batchCount - current.startSequence,
          lastSequence: lastSequence + batchCount,
        },
      }
    );
  }
}

async function startWorker() {
  await connectDB();
  const pendingGeneration = await GenerationJob.findOne({ status: { $in: ['queued', 'running'] } })
    .sort({ createdAt: 1 })
    .lean();
  if (pendingGeneration) {
    await GenerationJob.updateOne(
      { _id: pendingGeneration._id },
      { $set: { activeSlot: 'generation' } }
    );
    await enqueueGenerationJob(pendingGeneration._id);
    console.log(`Recovered generation job ${pendingGeneration._id} from MongoDB`);
  }

  const worker = new Worker(queueName, processGeneration, {
    connection,
    concurrency: 1,
  });

  worker.on('ready', () => console.log(`BullMQ worker listening on "${queueName}"`));
  worker.on('failed', async (queueJob, error) => {
    console.error('Generation queue attempt failed:', error.message);
    if (queueJob && queueJob.attemptsMade >= (queueJob.opts.attempts || 1)) {
      await GenerationJob.updateOne(
        { _id: queueJob.data.generationJobId, status: { $in: ['queued', 'running'] } },
        { $set: { status: 'failed', error: error.message, activeSlot: null } }
      ).catch((updateError) => console.error('Could not update failed generation job:', updateError));
    }
  });
  worker.on('error', (error) => console.error('BullMQ worker error:', error));

  const shutdown = async () => {
    await worker.close(true);
    await generationQueue.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startWorker().catch((error) => {
  console.error('Could not start generation worker:', error);
  process.exit(1);
});
