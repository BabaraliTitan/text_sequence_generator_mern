# Text Sequence Generator — MERN Stack

Generates alphanumeric text records in order — `a, b, c, ..., z, aa, ab,
..., az, ba, ..., zz, aaa, ..., zzz` — and stores each one in MongoDB via
an Express API, with a React frontend to trigger generation and browse
what's been stored.

## Stack
- **MongoDB** — storage, via Mongoose
- **Express** — REST API
- **React** (Vite) — frontend
- **Node.js** — runtime

## Project structure

```
text_sequence_generator_mern/
├── backend/
│   ├── config/db.js                    # MongoDB connection
│   ├── config/bullmq.js                 # Redis connection settings
│   ├── models/TextRecord.js            # Mongoose schema
│   ├── models/GenerationJob.js          # Durable job state
│   ├── queues/generationQueue.js        # API-side BullMQ queue
│   ├── workers/generationWorker.js      # Separate background worker
│   ├── utils/sequenceGenerator.js      # pure sequence logic (no DB, no framework)
│   ├── controllers/textRecordController.js
│   ├── routes/textRecordRoutes.js
│   ├── server.js                       # Express app entry point
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.jsx                     # UI: generate form + stored records
    │   ├── api.js                      # fetch wrapper for the backend API
    │   ├── main.jsx
    │   └── index.css
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## How the sequence works

Each value is derived deterministically from an integer `sequenceNumber`
using **bijective base-26** — the same scheme spreadsheet column letters
use (A, B, ..., Z, AA, AB, ...):

```
1 -> a      26 -> z      27 -> aa      52 -> az
53 -> ba    702 -> zz    703 -> aaa    18278 -> zzz
```

This is what makes resuming after a server restart reliable: on each
generate request, the API reads the highest `sequenceNumber` currently in
MongoDB and continues from `last + 1`. There's no need to parse or
increment the previous text value — see `getLastSequenceNumber()` in
`textRecordController.js`.

### Schema (`TextRecord`)
```js
{
  sequenceNumber: Number,  // unique, source of truth for ordering/resuming
  value: String,           // unique, e.g. "aab"
  createdAt, updatedAt      // via Mongoose timestamps
}
```
Both `sequenceNumber` and `value` carry MongoDB unique indexes — a
database-level guarantee on top of the application logic.

### Validation & error handling
- `sequenceNumberToValue()` throws on a non-positive/non-integer input,
  and returns `null` once the sequence would exceed the selected length cap.
- The UI lets the user select minimum and maximum lengths from 1 to 10.
  The target is calculated as the total number of sequence values in that
  inclusive length range; for example, min `2` and max `3` generates `aa`
  through `zzz` (18,252 records).
- Generation runs through BullMQ backed by Redis. MongoDB remains the source of
  truth for records and job status. A single worker processes one ordered ledger
  job at a time in internal batches of 25,000, with no 10-million-record cap.
  The selected length range (1 to 10) determines the maximum sequence size;
  very large jobs can take a long time and require substantial database storage.
  Existing records lock the minimum length; clear the ledger to choose another
  starting length.
- Records are listed in pages of 100 and searches run against MongoDB indexes.
- `POST /api/records/generate` returns `400` for an invalid `maxLength`, `409` if
  the sequence is already exhausted or a duplicate key is hit (e.g. a
  race between two concurrent requests), and `500` for anything
  unexpected — always as JSON with an `error` field.

## API

| Method | Endpoint                 | Body                | Description                          |
|--------|---------------------------|----------------------|---------------------------------------|
| GET    | `/api/records?after=0&limit=100` | — | List one page of records |
| GET    | `/api/records/search?q=ggg` | — | Return exact match and related values with indexes |
| POST   | `/api/records/generate` | `{ "minLength": 2, "maxLength": 3 }` | Start a resumable generation job |
| GET    | `/api/records/generate/active` | — | Get the active job after a page refresh |
| GET    | `/api/records/generate/:jobId` | — | Read job progress |
| POST   | `/api/records/generate/:jobId/cancel` | — | Stop after the current batch |
| DELETE | `/api/records` | — | Delete records and completed jobs |

## Running it

### 1. MongoDB
Have a MongoDB instance running locally (`mongod`) or a connection string
to Atlas or another hosted instance.

### 2. Backend
```bash
cd backend
cp .env.example .env      # edit MONGO_URI if not using the local default
npm install
npm run dev                # terminal 1: API
npm run dev:worker         # terminal 2: BullMQ worker
```
The API runs at `http://localhost:5000`. Redis must be running at
`redis://127.0.0.1:6379`, or set `REDIS_URL` in `.env` to your Redis URL.

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`. Choose minimum and maximum lengths, then click
**Generate**. The target count is calculated automatically. Generation runs in
the background and the ledger loads records in pages.

### 4. Restart recovery
If the worker stops, BullMQ keeps queued work in Redis. Start
`npm run dev:worker` again and it will resume processing. The worker checks
MongoDB's latest sequence position before each batch, so already-inserted
records are not inserted again after a retry.

## Extending this later

- **Different alphabet/length cap:** edit `ALPHABET` / `MAX_LENGTH` in
  `ackend/utils/sequenceGenerator.js` (`MAX_SEQUENCE_NUMBER` derives from
  them automatbically).
- **Auth:** add middleware in `server.js` in front of the `/api/records`
  routes.
- **Pagination:** `listRecords` currently returns everything; swap in
  `.skip()`/`.limit()` on the Mongoose query for large datasets.
- **Scheduled generation:** add a cron job (e.g. `node-cron`) that calls
  the same logic used by `generateNext`.
