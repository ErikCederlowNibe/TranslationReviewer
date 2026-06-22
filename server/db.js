import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SUPPORTED_LANGUAGES } from './languages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
const legacyJsonPath = path.join(dataDir, 'batches.json');

let firestore;

function normalizePersisted(data) {
  return {
    batchDefinitions: Array.isArray(data?.batchDefinitions) ? data.batchDefinitions : [],
    translationSeeds: Array.isArray(data?.translationSeeds) ? data.translationSeeds : [],
    reviewSessions:
      data?.reviewSessions && typeof data.reviewSessions === 'object' && !Array.isArray(data.reviewSessions)
        ? data.reviewSessions
        : {},
    submittedSessions:
      data?.submittedSessions && typeof data.submittedSessions === 'object' && !Array.isArray(data.submittedSessions)
        ? data.submittedSessions
        : {},
  };
}

function splitSessionKey(sessionKey) {
  const [language, ...batchParts] = sessionKey.split(':');
  const batchId = batchParts.join(':');

  if (!SUPPORTED_LANGUAGES.includes(language) || !batchId) {
    return null;
  }

  return {
    language,
    batchId,
  };
}

function parseServiceAccountFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is set but not valid JSON.');
  }
}

function ensureFirestore() {
  if (firestore) {
    return firestore;
  }

  if (!getApps().length) {
    const serviceAccount = parseServiceAccountFromEnv();

    if (serviceAccount) {
      initializeApp({
        credential: cert(serviceAccount),
      });
    } else {
      initializeApp({
        credential: applicationDefault(),
      });
    }
  }

  firestore = getFirestore();
  return firestore;
}

function batchRef(db, batchName) {
  return db.collection('batches').doc(batchName);
}

function seedDocRef(db, batchName, seedId) {
  return batchRef(db, batchName).collection('translation_seeds').doc(seedId);
}

function reviewRef(db, batchName, language) {
  return batchRef(db, batchName).collection('reviews').doc(language);
}

async function readReviewEntries(db, batchName, language, seedsForBatch) {
  const reviewSnap = await reviewRef(db, batchName, language).get();
  const rawEntries = Array.isArray(reviewSnap.data()?.entries) ? reviewSnap.data().entries : [];

  const entryMap = new Map();
  for (const entry of rawEntries) {
    if (!entry || typeof entry !== 'object' || typeof entry.textId !== 'string') {
      continue;
    }

    const reviewed = !!entry.reviewed;
    const approved = reviewed ? (entry.approved === true ? true : entry.approved === false ? false : null) : null;
    const normalized = {
      textId: entry.textId,
      reviewed,
      approved,
      ...(approved === false ? { suggestedTranslation: typeof entry.suggestedTranslation === 'string' ? entry.suggestedTranslation : '' } : {}),
    };

    entryMap.set(normalized.textId, normalized);
  }

  return seedsForBatch.map((seed) => {
    const entry = entryMap.get(seed.id);
    if (!entry) {
      return {
        textId: seed.id,
        reviewed: false,
        approved: null,
      };
    }

    return entry;
  });
}

async function importLegacyJsonIfNeeded(db) {
  const existingBatches = await db.collection('batches').limit(1).get();
  if (!existingBatches.empty) {
    return;
  }

  try {
    const raw = await fs.readFile(legacyJsonPath, 'utf8');
    const parsed = normalizePersisted(JSON.parse(raw));

    if (!parsed.batchDefinitions.length) {
      return;
    }

    const writer = db.bulkWriter();

    for (const batch of parsed.batchDefinitions) {
      const batchName = batch.name;
      if (typeof batchName !== 'string' || !batchName.trim()) {
        continue;
      }

      writer.set(batchRef(db, batchName), {
        name: batchName,
        importedAt: typeof batch.importedAt === 'string' ? batch.importedAt : new Date().toISOString(),
      });
    }

    for (const seed of parsed.translationSeeds) {
      if (
        !seed ||
        typeof seed.id !== 'string' ||
        typeof seed.batchId !== 'string' ||
        typeof seed.englishText !== 'string' ||
        !seed.translations
      ) {
        continue;
      }

      writer.set(seedDocRef(db, seed.batchId, seed.id), {
        id: seed.id,
        englishText: seed.englishText,
        batchId: seed.batchId,
        translations: typeof seed.translations === 'object' && seed.translations ? seed.translations : {},
      });
    }

    for (const [sessionKey, entries] of Object.entries(parsed.reviewSessions)) {
      const session = splitSessionKey(sessionKey);
      if (!session || !Array.isArray(entries)) {
        continue;
      }

      writer.set(
        reviewRef(db, session.batchId, session.language),
        {
          entries: entries.map((entry) => ({
            textId: entry.textId,
            reviewed: !!entry.reviewed,
            approved: entry.reviewed ? (entry.approved === true ? true : false) : null,
            ...(entry.reviewed && entry.approved === false
              ? { suggestedTranslation: typeof entry.suggestedTranslation === 'string' ? entry.suggestedTranslation : '' }
              : {}),
          })),
        },
        { merge: true }
      );
    }

    for (const [sessionKey, submitted] of Object.entries(parsed.submittedSessions)) {
      writer.set(db.collection('submitted_sessions').doc(sessionKey), {
        submitted: !!submitted,
      });
    }

    await writer.close();
  } catch {
    // If no legacy file exists we just start with an empty Firestore dataset.
  }
}

export async function initDatabase() {
  const db = ensureFirestore();
  await importLegacyJsonIfNeeded(db);
}

async function readAllBatches(db) {
  const snapshot = await db.collection('batches').get();
  const batchDefinitions = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        name: typeof data.name === 'string' ? data.name : doc.id,
        importedAt: typeof data.importedAt === 'string' ? data.importedAt : new Date(0).toISOString(),
      };
    })
    .sort((a, b) => {
      const timeDiff = new Date(a.importedAt).getTime() - new Date(b.importedAt).getTime();
      if (Number.isNaN(timeDiff) || timeDiff === 0) {
        return a.name.localeCompare(b.name);
      }
      return timeDiff;
    });

  return batchDefinitions;
}

async function readAllSeeds(db, batchDefinitions) {
  const snapshots = await Promise.all(
    batchDefinitions.map((batch) =>
      batchRef(db, batch.name).collection('translation_seeds').get()
        .then((snap) => ({ batch, snap }))
    )
  );

  const translationSeeds = [];
  const seedsByBatch = new Map();

  for (const { batch, snap } of snapshots) {
    const seeds = snap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: typeof data.id === 'string' ? data.id : doc.id,
          englishText: typeof data.englishText === 'string' ? data.englishText : '',
          batchId: batch.name,
          translations: Object.fromEntries(
            SUPPORTED_LANGUAGES.map((lang) => [
              lang,
              typeof data?.translations?.[lang] === 'string' ? data.translations[lang] : '',
            ])
          ),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    seedsByBatch.set(batch.name, seeds);
    translationSeeds.push(...seeds);
  }

  return {
    translationSeeds,
    seedsByBatch,
  };
}

export async function getBatchData() {
  const db = ensureFirestore();
  const batchDefinitions = await readAllBatches(db);
  const { translationSeeds, seedsByBatch } = await readAllSeeds(db, batchDefinitions);

  const reviewEntryPromises = batchDefinitions.flatMap((batch) => {
    const seedsForBatch = seedsByBatch.get(batch.name) ?? [];
    return SUPPORTED_LANGUAGES.map((language) =>
      readReviewEntries(db, batch.name, language, seedsForBatch)
        .then((entries) => ({ sessionKey: `${language}:${batch.name}`, entries }))
    );
  });

  const [reviewResults, submittedSnap, lockedSnap, archivedSnap] = await Promise.all([
    Promise.all(reviewEntryPromises),
    db.collection('submitted_sessions').get(),
    db.collection('locked_sessions').get(),
    db.collection('archived_sessions').get(),
  ]);

  const reviewSessions = {};
  for (const { sessionKey, entries } of reviewResults) {
    reviewSessions[sessionKey] = entries;
  }

  const submittedSessions = {};
  for (const doc of submittedSnap.docs) {
    submittedSessions[doc.id] = !!doc.data().submitted;
  }

  const lockedSessions = {};
  for (const doc of lockedSnap.docs) {
    lockedSessions[doc.id] = !!doc.data().locked;
  }

  const archivedSessions = {};
  for (const doc of archivedSnap.docs) {
    archivedSessions[doc.id] = !!doc.data().archived;
  }

  return {
    batchDefinitions,
    translationSeeds,
    reviewSessions,
    submittedSessions,
    lockedSessions,
    archivedSessions,
  };
}

export async function addBatchWithSeeds(batch, translationSeeds) {
  const db = ensureFirestore();

  const existing = await batchRef(db, batch.name).get();
  if (existing.exists) {
    return null;
  }

  const writer = db.bulkWriter();

  writer.set(batchRef(db, batch.name), {
    name: batch.name,
    importedAt: batch.importedAt,
  });

  for (const seed of translationSeeds) {
    writer.set(seedDocRef(db, batch.name, seed.id), {
      id: seed.id,
      englishText: seed.englishText,
      batchId: batch.name,
      translations: seed.translations,
    });
  }

  for (const language of SUPPORTED_LANGUAGES) {
    writer.set(reviewRef(db, batch.name, language), {
      entries: translationSeeds.map((seed) => ({
        textId: seed.id,
        reviewed: false,
        approved: null,
      })),
    });
  }

  await writer.close();

  return getBatchData();
}

export async function archiveSessions(sessionKeys) {
  const db = ensureFirestore();
  const writer = db.bulkWriter();
  const archivedAt = new Date().toISOString();
  for (const sessionKey of sessionKeys) {
    writer.set(db.collection('archived_sessions').doc(sessionKey), { archived: true, archivedAt });
  }
  await writer.close();
}

export async function purgeOldArchives() {
  const db = ensureFirestore();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 1);

  const archivedSnap = await db.collection('archived_sessions').get();
  const oldKeys = archivedSnap.docs
    .filter((doc) => {
      const { archivedAt } = doc.data();
      return typeof archivedAt === 'string' && new Date(archivedAt) <= cutoff;
    })
    .map((doc) => doc.id);

  if (!oldKeys.length) return { purged: 0 };

  const writer = db.bulkWriter();
  for (const sessionKey of oldKeys) {
    const session = splitSessionKey(sessionKey);
    if (!session) continue;
    writer.delete(db.collection('archived_sessions').doc(sessionKey));
    writer.delete(db.collection('locked_sessions').doc(sessionKey));
    writer.delete(db.collection('submitted_sessions').doc(sessionKey));
    writer.delete(reviewRef(db, session.batchId, session.language));
    writer.delete(
      db.collection('reviewed_batches').doc(session.batchId)
        .collection('languages').doc(session.language)
    );
  }
  await writer.close();

  return { purged: oldKeys.length };
}

export async function unlockSessions(sessionKeys) {
  const db = ensureFirestore();
  const writer = db.bulkWriter();
  for (const sessionKey of sessionKeys) {
    const session = splitSessionKey(sessionKey);
    if (!session) continue;
    writer.delete(db.collection('locked_sessions').doc(sessionKey));
    writer.delete(db.collection('archived_sessions').doc(sessionKey));
    writer.delete(
      db.collection('reviewed_batches').doc(session.batchId)
        .collection('languages').doc(session.language)
    );
  }
  await writer.close();
}

export async function lockSessions(sessionKeys) {
  const db = ensureFirestore();

  // Group by batchId so we only read seeds once per batch.
  const sessionsByBatch = new Map();
  for (const sessionKey of sessionKeys) {
    const session = splitSessionKey(sessionKey);
    if (!session) continue;
    if (!sessionsByBatch.has(session.batchId)) {
      sessionsByBatch.set(session.batchId, []);
    }
    sessionsByBatch.get(session.batchId).push(session);
  }

  const writer = db.bulkWriter();

  for (const [batchId, sessions] of sessionsByBatch) {
    const seedSnapshot = await batchRef(db, batchId).collection('translation_seeds').get();
    const seedsForBatch = seedSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: typeof data.id === 'string' ? data.id : doc.id,
        englishText: typeof data.englishText === 'string' ? data.englishText : '',
        translations: data.translations && typeof data.translations === 'object' ? data.translations : {},
      };
    });
    const seedMap = new Map(seedsForBatch.map((s) => [s.id, s]));

    for (const session of sessions) {
      const reviewEntries = await readReviewEntries(db, batchId, session.language, seedsForBatch);

      const archivedEntries = reviewEntries.map((entry) => {
        const seed = seedMap.get(entry.textId);
        const originalTranslation =
          typeof seed?.translations?.[session.language] === 'string'
            ? seed.translations[session.language]
            : '';
        const isDisapproved = entry.reviewed && entry.approved === false;
        const finalTranslation = isDisapproved
          ? (typeof entry.suggestedTranslation === 'string' ? entry.suggestedTranslation : originalTranslation)
          : originalTranslation;

        return {
          textId: entry.textId,
          englishText: seed?.englishText ?? '',
          originalTranslation,
          finalTranslation,
          approved: entry.reviewed ? (entry.approved === true ? true : false) : null,
        };
      });

      writer.set(
        db.collection('reviewed_batches').doc(batchId).collection('languages').doc(session.language),
        {
          batchId,
          language: session.language,
          archivedAt: new Date().toISOString(),
          entries: archivedEntries,
        }
      );

      writer.set(
        db.collection('locked_sessions').doc(`${session.language}:${batchId}`),
        { locked: true }
      );
    }
  }

  await writer.close();
}

export async function getReviewedBatches() {
  const db = ensureFirestore();
  const batchesSnap = await db.collection('reviewed_batches').get();

  const result = [];
  for (const batchDoc of batchesSnap.docs) {
    const languagesSnap = await batchDoc.ref.collection('languages').get();
    for (const langDoc of languagesSnap.docs) {
      const data = langDoc.data();
      result.push({
        batchId: typeof data.batchId === 'string' ? data.batchId : batchDoc.id,
        language: typeof data.language === 'string' ? data.language : langDoc.id,
        archivedAt: typeof data.archivedAt === 'string' ? data.archivedAt : '',
        entries: Array.isArray(data.entries)
          ? data.entries.map((entry) => ({
              textId: typeof entry.textId === 'string' ? entry.textId : '',
              englishText: typeof entry.englishText === 'string' ? entry.englishText : '',
              originalTranslation: typeof entry.originalTranslation === 'string' ? entry.originalTranslation : '',
              finalTranslation: typeof entry.finalTranslation === 'string' ? entry.finalTranslation : '',
              approved: entry.approved === true ? true : entry.approved === false ? false : null,
            }))
          : [],
      });
    }
  }

  return result;
}

export async function saveReviewState(reviewSessions, submittedSessions) {
  const db = ensureFirestore();
  const writer = db.bulkWriter();

  for (const [sessionKey, entries] of Object.entries(reviewSessions ?? {})) {
    const session = splitSessionKey(sessionKey);
    if (!session || !Array.isArray(entries)) {
      continue;
    }

    writer.set(reviewRef(db, session.batchId, session.language), {
      entries: entries.map((entry) => ({
        textId: entry.textId,
        reviewed: !!entry.reviewed,
        approved: entry.reviewed ? (entry.approved === true ? true : false) : null,
        ...(entry.reviewed && entry.approved === false
          ? { suggestedTranslation: typeof entry.suggestedTranslation === 'string' ? entry.suggestedTranslation : '' }
          : {}),
      })),
    });
  }

  const existingSubmitted = await db.collection('submitted_sessions').get();
  for (const doc of existingSubmitted.docs) {
    writer.delete(doc.ref);
  }

  for (const [sessionKey, submitted] of Object.entries(submittedSessions ?? {})) {
    writer.set(db.collection('submitted_sessions').doc(sessionKey), {
      submitted: !!submitted,
    });
  }

  await writer.close();
}
