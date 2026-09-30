const mongoose = require('mongoose');

const textRecordSchema = new mongoose.Schema(
  {
    sequenceNumber: {
      type: Number,
      required: true,
      unique: true, // enforced at the database level via a unique index
      min: 1,
    },
    value: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
  },
  {
    timestamps: true, // adds createdAt / updatedAt
  }
);

module.exports = mongoose.model('TextRecord', textRecordSchema);
