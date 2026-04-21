import cors from 'cors';
import express from 'express';
import {
  addBatchWithSeeds,
  getBatchData,
  initDatabase,
  saveReviewState,
} from './db.js';

const app = express();
const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS.'));
  },
}));
app.use(express.json({ limit: '2mb' }));

function isValidPersistedReviewEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  if (typeof entry.textId !== 'string') {
    return false;
  }

  if (typeof entry.reviewed !== 'boolean') {
    return false;
  }

  if (!(entry.approved === true || entry.approved === false || entry.approved === null)) {
    return false;
  }

  if (entry.reviewed === false && entry.approved !== null) {
    return false;
  }

  if (entry.reviewed === true && entry.approved === null) {
    return false;
  }

  if (entry.approved === false && typeof entry.suggestedTranslation !== 'string') {
    return false;
  }

  if (entry.approved !== false && entry.suggestedTranslation !== undefined && typeof entry.suggestedTranslation !== 'string') {
    return false;
  }

  return true;
}

function isValidReviewSessions(reviewSessions) {
  if (!reviewSessions || typeof reviewSessions !== 'object' || Array.isArray(reviewSessions)) {
    return false;
  }

  return Object.values(reviewSessions).every((sessionEntries) =>
    Array.isArray(sessionEntries) && sessionEntries.every(isValidPersistedReviewEntry)
  );
}

function isValidSubmittedSessions(submittedSessions) {
  if (!submittedSessions || typeof submittedSessions !== 'object' || Array.isArray(submittedSessions)) {
    return false;
  }

  return Object.values(submittedSessions).every((value) => typeof value === 'boolean');
}

function validateData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid payload.');
  }

  if (!Array.isArray(data.batchDefinitions) || !Array.isArray(data.translationSeeds)) {
    throw new Error('Invalid data shape.');
  }

  if (!isValidReviewSessions(data.reviewSessions)) {
    throw new Error('Invalid reviewSessions shape.');
  }

  if (!isValidSubmittedSessions(data.submittedSessions)) {
    throw new Error('Invalid submittedSessions shape.');
  }
}

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/api/batches', async (_req, res) => {
  try {
    const data = await getBatchData();
    validateData(data);
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to read batch data.' });
  }
});

app.post('/api/batches', async (req, res) => {
  const { batch, translationSeeds } = req.body ?? {};

  if (!batch || typeof batch !== 'object') {
    return res.status(400).json({ error: 'Batch payload is required.' });
  }

  if (!Array.isArray(translationSeeds) || !translationSeeds.length) {
    return res.status(400).json({ error: 'Translation seed payload is required.' });
  }

  if (typeof batch.name !== 'string' || typeof batch.importedAt !== 'string') {
    return res.status(400).json({ error: 'Batch fields are invalid.' });
  }

  for (const seed of translationSeeds) {
    if (
      !seed ||
      typeof seed.id !== 'string' ||
      typeof seed.englishText !== 'string' ||
      typeof seed.batchId !== 'string' ||
      typeof seed.translations !== 'object' ||
      !seed.translations
    ) {
      return res.status(400).json({ error: 'A translation row is invalid.' });
    }

    if (
      typeof seed.translations.Spanish !== 'string' ||
      typeof seed.translations.French !== 'string' ||
      typeof seed.translations.German !== 'string'
    ) {
      return res.status(400).json({ error: 'Translation row must include Spanish, French, and German strings.' });
    }
  }

  try {
    const data = await addBatchWithSeeds(batch, translationSeeds);

    if (!data) {
      return res.status(409).json({ error: 'A batch with this zip name already exists.' });
    }
    validateData(data);
    return res.status(201).json(data);
  } catch {
    return res.status(500).json({ error: 'Failed to save batch data.' });
  }
});

app.post('/api/review-state', async (req, res) => {
  const { reviewSessions, submittedSessions } = req.body ?? {};

  if (!isValidReviewSessions(reviewSessions)) {
    return res.status(400).json({ error: 'reviewSessions payload is invalid.' });
  }

  if (!isValidSubmittedSessions(submittedSessions)) {
    return res.status(400).json({ error: 'submittedSessions payload is invalid.' });
  }

  try {
    await saveReviewState(reviewSessions, submittedSessions);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to persist review state.' });
  }
});

await initDatabase();

app.listen(port, () => {
  console.log(`Batch API running on port ${port}`);
});
