const { performance } = require('perf_hooks');
const TextRecord = require('../models/TextRecord');
const GenerationJob = require('../models/GenerationJob');
const { enqueueGenerationJob } = require('../queues/generationQueue');
const { ALPHABET, MAX_LENGTH, maxSequenceNumber } = require('../utils/sequenceGenerator');

const GENERATION_BATCH_SIZE = 25000;
const PAGE_SIZE_MAX = 500;

async function getLastSequenceNumber() {
  const last = await TextRecord.findOne().sort({ sequenceNumber: -1 }).select('sequenceNumber').lean();
  return last ? last.sequenceNumber : 0;
}

async function startGeneration(req, res) {
  try {
    const minLength = Number(req.body.minLength);
    const maxLength = Number(req.body.maxLength);

    if (!Number.isInteger(minLength) || minLength < 1 || minLength > MAX_LENGTH) {
      return res.status(400).json({ error: `minLength must be an integer from 1 to ${MAX_LENGTH}.` });
    }
    if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > MAX_LENGTH) {
      return res.status(400).json({ error: `maxLength must be an integer from 1 to ${MAX_LENGTH}.` });
    }
    if (minLength > maxLength) {
      return res.status(400).json({ error: 'minLength cannot be greater than maxLength.' });
    }

    const startPosition = maxSequenceNumber(minLength - 1);
    const targetCount = maxSequenceNumber(maxLength) - startPosition;
    if (await GenerationJob.exists({ status: { $in: ['queued', 'running'] } })) {
      return res.status(409).json({ error: 'A generation job is already queued or running.' });
    }

    try {
      const lastSequence = await getLastSequenceNumber();
      const firstRecord = await TextRecord.findOne().sort({ sequenceNumber: 1 }).select('sequenceNumber').lean();
      const firstSequence = startPosition + 1;
      if (firstRecord && firstRecord.sequenceNumber !== firstSequence) {
        return res.status(409).json({ error: `Stored records begin at position ${firstRecord.sequenceNumber}; clear records before changing the minimum length to ${minLength}.` });
      }
      if (lastSequence >= maxSequenceNumber(maxLength)) {
        return res.status(409).json({ error: 'The database already contains the complete selected range.' });
      }
      if (lastSequence > 0 && lastSequence < startPosition) {
        return res.status(409).json({ error: `The database ends before the selected minimum length ${minLength}; clear records to start this range.` });
      }
      const startSequence = Math.max(lastSequence, startPosition);
      const job = await GenerationJob.create({
        minLength,
        maxLength,
        targetCount: maxSequenceNumber(maxLength),
        batchSize: GENERATION_BATCH_SIZE,
        startSequence,
        lastSequence: startSequence,
        generated: 0,
        status: 'queued',
        activeSlot: 'generation',
      });

      try {
        await enqueueGenerationJob(job._id);
      } catch (queueError) {
        await GenerationJob.updateOne(
          { _id: job._id },
          { $set: { status: 'failed', error: 'Could not connect to Redis queue.', activeSlot: null } }
        );
        console.error('Could not enqueue generation job:', queueError);
        return res.status(503).json({ error: 'Generation queue is unavailable. Check that Redis is running.' });
      }
      return res.status(202).json({ job });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'A generation job is already queued or running.' });
      }
      throw err;
    }
  } catch (err) {
    console.error('startGeneration error:', err);
    return res.status(500).json({ error: 'Could not start generation.', details: err.message });
  }
}

async function getGenerationJob(req, res) {
  try {
    const job = await GenerationJob.findById(req.params.jobId).lean();
    if (!job) return res.status(404).json({ error: 'Generation job not found.' });
    return res.json({ job });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid generation job id.' });
  }
}

async function getActiveGenerationJob(req, res) {
  try {
    const job = await GenerationJob.findOne({ status: { $in: ['queued', 'running'] } })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ job });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load the active generation job.' });
  }
}

async function getLatestGenerationJob(req, res) {
  try {
    const job = await GenerationJob.findOne().sort({ createdAt: -1 }).lean();
    return res.json({ job });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load the latest generation job.' });
  }
}

async function getGenerationHistory(req, res) {
  try {
    const allowedStatuses = ['queued', 'running', 'completed', 'cancelled', 'failed'];
    const status = String(req.query.status || 'all');
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (status !== 'all' && !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid generation status filter.' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'limit must be between 1 and 100.' });
    }
    const filter = status === 'all' ? {} : { status };
    const jobs = await GenerationJob.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('minLength maxLength targetCount startSequence lastSequence generated status error createdAt updatedAt')
      .lean();
    return res.json({ jobs });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load generation history.' });
  }
}

async function cancelGeneration(req, res) {
  try {
    const job = await GenerationJob.findById(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Generation job not found.' });
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return res.status(409).json({ error: `This job is already ${job.status}.` });
    }
    job.cancelRequested = true;
    await job.save();
    return res.json({ job });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid generation job id.' });
  }
}

async function listRecords(req, res) {
  try {
    const after = req.query.after === undefined ? 0 : Number(req.query.after);
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    const length = req.query.length === undefined || req.query.length === 'all' ? null : Number(req.query.length);
    if (!Number.isSafeInteger(after) || after < 0) {
      return res.status(400).json({ error: 'after must be a non-negative sequence number.' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE_MAX) {
      return res.status(400).json({ error: `limit must be between 1 and ${PAGE_SIZE_MAX}.` });
    }

    if (length !== null && (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH)) {
      return res.status(400).json({ error: `length must be all or an integer from 1 to ${MAX_LENGTH}.` });
    }

    const sequenceFilter = {};
    if (after > 0) sequenceFilter.$gt = after;
    if (length !== null) {
      sequenceFilter.$gte = maxSequenceNumber(length - 1) + 1;
      sequenceFilter.$lte = maxSequenceNumber(length);
    }
    const recordFilter = Object.keys(sequenceFilter).length ? { sequenceNumber: sequenceFilter } : {};

    const [records, firstRecord, lastRecord, globalFirst, globalLast] = await Promise.all([
      TextRecord.find(recordFilter)
        .sort({ sequenceNumber: 1 })
        .limit(limit)
        .lean(),
      TextRecord.findOne(length === null ? {} : { sequenceNumber: { $gte: maxSequenceNumber(length - 1) + 1, $lte: maxSequenceNumber(length) } })
        .sort({ sequenceNumber: 1 }).select('sequenceNumber value').lean(),
      TextRecord.findOne(length === null ? {} : { sequenceNumber: { $gte: maxSequenceNumber(length - 1) + 1, $lte: maxSequenceNumber(length) } })
        .sort({ sequenceNumber: -1 }).select('sequenceNumber value').lean(),
      length === null ? Promise.resolve(null) : TextRecord.findOne().sort({ sequenceNumber: 1 }).select('sequenceNumber value').lean(),
      length === null ? Promise.resolve(null) : TextRecord.findOne().sort({ sequenceNumber: -1 }).select('sequenceNumber value').lean(),
    ]);
    const firstOverall = globalFirst || firstRecord;
    const lastOverall = globalLast || lastRecord;
    return res.json({
      count: firstRecord && lastRecord ? lastRecord.sequenceNumber - firstRecord.sequenceNumber + 1 : 0,
      totalCount: firstOverall && lastOverall ? lastOverall.sequenceNumber - firstOverall.sequenceNumber + 1 : 0,
      firstValue: firstOverall ? firstOverall.value : null,
      firstSequence: firstRecord ? firstRecord.sequenceNumber : null,
      lastSequence: lastRecord ? lastRecord.sequenceNumber : null,
      lastValue: lastOverall ? lastOverall.value : null,
      records,
      nextAfter: records.length ? records[records.length - 1].sequenceNumber : null,
      lengthFilter: length,
    });
  } catch (err) {
    console.error('listRecords error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

function valueToSequenceNumber(value) {
  return [...value].reduce(
    (total, character) => total * ALPHABET.length + ALPHABET.indexOf(character) + 1,
    0
  );
}

async function searchRecords(req, res) {
  const startedAt = performance.now();
  const query = String(req.query.q || '').trim().toLowerCase();
  if (!query) return res.status(400).json({ error: 'Enter a value or sequence number to search.' });

  try {
    if (/^\d+$/.test(query)) {
      const sequenceNumber = Number(query);
      if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) {
        return res.status(400).json({ error: 'Sequence number is outside the supported range.' });
      }
      const record = await TextRecord.findOne({ sequenceNumber }).lean();
      return res.json({ query, record, lookupTimeMs: performance.now() - startedAt });
    }

    if (!/^[a-z]+$/.test(query) || query.length > MAX_LENGTH) {
      return res.status(400).json({ error: `Search with letters up to ${MAX_LENGTH} characters, or a sequence number.` });
    }

    const prefix = query.slice(0, -1);
    const values = [...ALPHABET].map((letter) => `${prefix}${letter}`);
    const [queryRecord, storedRecords] = await Promise.all([
      TextRecord.findOne({ value: query }).lean(),
      TextRecord.find({ value: { $in: values } }).select('sequenceNumber value').lean(),
    ]);
    const storedByValue = new Map(storedRecords.map((record) => [record.value, record]));
    const related = values.map((value) => ({
      value,
      sequenceNumber: valueToSequenceNumber(value),
      record: storedByValue.get(value) || null,
    }));

    return res.json({ queryRecord, related, lookupTimeMs: performance.now() - startedAt });
  } catch (err) {
    console.error('searchRecords error:', err);
    return res.status(500).json({ error: 'Search failed.', details: err.message });
  }
}

async function clearRecords(req, res) {
  try {
    if (await GenerationJob.exists({ status: { $in: ['queued', 'running'] } })) {
      return res.status(409).json({ error: 'Cancel the active generation job before clearing records.' });
    }
    const [result] = await Promise.all([TextRecord.deleteMany({}), GenerationJob.deleteMany({})]);
    return res.json({ deleted: result.deletedCount });
  } catch (err) {
    console.error('clearRecords error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

module.exports = {
  startGeneration,
  getGenerationJob,
  getActiveGenerationJob,
  getLatestGenerationJob,
  getGenerationHistory,
  cancelGeneration,
  listRecords,
  searchRecords,
  clearRecords,
};
