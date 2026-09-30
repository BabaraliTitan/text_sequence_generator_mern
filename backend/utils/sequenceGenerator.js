/**
 * Alphanumeric sequence generation logic.
 *
 * Produces bijective base-26 values up to ten characters.
 *
 * Uses "bijective base-26" numbering (the same scheme spreadsheet column
 * letters use). It is deterministic: a given sequenceNumber always maps to
 * exactly one value, so resuming after a server restart only requires
 * knowing the highest sequenceNumber already stored in MongoDB.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length;
const MAX_LENGTH = 10;

function maxSequenceNumber(maxLength = MAX_LENGTH) {
  let total = 0;
  for (let length = 1; length <= maxLength; length += 1) {
    total += BASE ** length;
  }
  return total;
}

// Length ten still fits safely in JavaScript's exact integer range.
const MAX_SEQUENCE_NUMBER = maxSequenceNumber();


/**
 * Convert a 1-indexed sequence number to its alphanumeric value.
 * Returns null if n exceeds the selected maximum length.
 * Throws RangeError if n is not a positive integer.
 */
function sequenceNumberToValue(n, maxLength = MAX_LENGTH) {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`Sequence number must be a positive integer, got ${n}`);
  }
  if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > MAX_LENGTH) {
    throw new RangeError(`maxLength must be an integer between 1 and ${MAX_LENGTH}`);
  }
  if (n > maxSequenceNumber(maxLength)) {
    return null;
  }

  const chars = [];
  while (n > 0) {
    n -= 1;
    chars.push(ALPHABET[n % BASE]);
    n = Math.floor(n / BASE);
  }
  return chars.reverse().join('');
}

module.exports = {
  ALPHABET,
  BASE,
  MAX_LENGTH,
  MAX_SEQUENCE_NUMBER,
  maxSequenceNumber,
  sequenceNumberToValue,
};
