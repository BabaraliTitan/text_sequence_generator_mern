const mongoose = require('mongoose');

const generationJobSchema = new mongoose.Schema(
  {
    minLength: { type: Number, required: true, min: 1, max: 10, default: 1 },
    maxLength: { type: Number, required: true, min: 1, max: 10 },
    targetCount: { type: Number, required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
    batchSize: { type: Number, required: true, min: 1, max: 25000 },
    startSequence: { type: Number, required: true, min: 0 },
    lastSequence: { type: Number, required: true, min: 0 },
    generated: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'cancelled', 'failed'],
      default: 'queued',
    },
    cancelRequested: { type: Boolean, default: false },
    error: { type: String, default: '' },
    activeSlot: { type: String, default: null },
  },
  { timestamps: true }
);

generationJobSchema.index({ status: 1, createdAt: 1 });
generationJobSchema.index(
  { activeSlot: 1 },
  { unique: true, partialFilterExpression: { activeSlot: 'generation' } }
);

module.exports = mongoose.model('GenerationJob', generationJobSchema);
