const express = require('express');
const {
  startGeneration,
  getGenerationJob,
  getActiveGenerationJob,
  getLatestGenerationJob,
  getGenerationHistory,
  cancelGeneration,
  listRecords,
  searchRecords,
  clearRecords,
} = require('../controllers/textRecordController');

const router = express.Router();

router.get('/', listRecords);
router.get('/search', searchRecords);
router.get('/generate/active', getActiveGenerationJob);
router.get('/generate/latest', getLatestGenerationJob);
router.get('/generate/history', getGenerationHistory);
router.get('/generate/:jobId', getGenerationJob);
router.post('/generate', startGeneration);
router.post('/generate/:jobId/cancel', cancelGeneration);
router.delete('/', clearRecords);

module.exports = router;
