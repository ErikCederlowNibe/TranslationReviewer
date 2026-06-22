import JSZip from 'jszip';
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { TranslationCard } from './components/TranslationCard';
import { ProgressBar } from './components/ProgressBar';
import { SubmitDialog } from './components/SubmitDialog';
import { ArrowLeft, Languages, LockKeyhole, Moon, Sun } from 'lucide-react';
import { SUPPORTED_LANGUAGES, LANGUAGE_PASSWORDS } from './languages';

interface Translation {
  id: string;
  englishText: string;
  translatedText: string;
  language: string;
  status: 'approved' | 'disapproved' | null;
  correction?: string;
}

interface TranslationSeed {
  id: string;
  englishText: string;
  batchId: string;
  translations: Record<string, string>;
}

interface BatchDefinition {
  name: string;
  importedAt: string;
}

interface BatchDataResponse {
  batchDefinitions: BatchDefinition[];
  translationSeeds: TranslationSeed[];
  reviewSessions?: PersistedReviewSessions;
  submittedSessions?: SubmissionSessions;
}

interface PersistedReviewEntry {
  textId: string;
  reviewed: boolean;
  approved: boolean | null;
  suggestedTranslation?: string;
}

type PersistedReviewSessions = Record<string, PersistedReviewEntry[]>;

type ReviewSessions = Record<string, Translation[]>;
type SubmissionSessions = Record<string, boolean>;
interface ReviewedBatchReport {
  sessionKey: string;
  language: string;
  batchId: string;
  batchName: string;
  approved: number;
  disapproved: number;
  total: number;
}

const languagePasswords = LANGUAGE_PASSWORDS;

const adminPassword = 'nibe-admin';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '');

function apiUrl(path: string) {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path;
}

interface ImportTranslationRow {
  panelId: string;
  originalText: string;
  suggestedTranslation: string;
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getFieldValue(record: Record<string, unknown>, allowedKeys: string[]) {
  const normalized = new Map(Object.entries(record).map(([key, value]) => [normalizeKey(key), value]));

  for (const candidate of allowedKeys) {
    const value = normalized.get(candidate);
    if (typeof value === 'string') {
      return value.trim();
    }
  }

  return '';
}

function parseImportRows(rawJson: unknown, languageKey: string): ImportTranslationRow[] {
  const rows = Array.isArray(rawJson)
    ? rawJson
    : rawJson && typeof rawJson === 'object'
    ? Object.values(rawJson)
    : null;

  if (!rows) {
    throw new Error(`${languageKey}.json must contain an array or object of row entries.`);
  }

  return rows.map((row, index) => {
    if (!row || typeof row !== 'object') {
      throw new Error(`${languageKey}.json row ${index + 1} must be an object.`);
    }

    const record = row as Record<string, unknown>;
    const panelId = getFieldValue(record, ['panelid', 'id']);
    const originalText = getFieldValue(record, ['originaltext', 'originalenglishtext', 'englishtext', 'original']);
    const suggestedTranslation = getFieldValue(record, ['suggestedtranslation', 'translation', 'suggestedtext']);

    if (!panelId || !originalText || !suggestedTranslation) {
      throw new Error(
        `${languageKey}.json row ${index + 1} must include Panel-ID, Original text, and suggested translation.`
      );
    }

    return {
      panelId,
      originalText,
      suggestedTranslation,
    };
  });
}

function getZipEntry(zip: JSZip, filename: string) {
  const lowerName = filename.toLowerCase();
  const matchKey = Object.keys(zip.files).find((key) => key.toLowerCase().endsWith(`/${lowerName}`) || key.toLowerCase() === lowerName);
  return matchKey ? zip.files[matchKey] : undefined;
}

function parseJsonContent(rawContent: string, filename: string): unknown {
  // Handle UTF-8 BOM so JSON exported from Windows tools imports reliably.
  const clean = rawContent.replace(/^\uFEFF/, '');
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`${filename} is not valid JSON.`);
  }
}

function formatImportedAt(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function getSessionKey(language: string, batchId: string) {
  return `${language}:${batchId}`;
}

function isBatchReviewed(translations: Translation[] | undefined) {
  return !!translations?.length && translations.every((translation) => translation.status !== null);
}

function createTranslationsFromSeeds(seeds: TranslationSeed[], language: string, batchId: string): Translation[] {
  return seeds
    .filter((translation) => translation.batchId === batchId)
    .map((translation) => ({
      id: translation.id,
      englishText: translation.englishText,
      translatedText: translation.translations[language],
      language,
      status: null,
    }));
}

function hydrateReviewSessions(
  persistedReviewSessions: PersistedReviewSessions,
  seeds: TranslationSeed[]
): ReviewSessions {
  const hydrated: ReviewSessions = {};

  for (const [sessionKey, entries] of Object.entries(persistedReviewSessions)) {
    const [language, batchId] = sessionKey.split(':') as [string, string];
    const baseRows = createTranslationsFromSeeds(seeds, language, batchId);
    const entryMap = new Map(entries.map((entry) => [entry.textId, entry]));

    hydrated[sessionKey] = baseRows.map((row) => {
      const entry = entryMap.get(row.id);

      if (!entry || !entry.reviewed) {
        return row;
      }

      if (entry.approved === true) {
        return { ...row, status: 'approved' };
      }

      if (entry.approved === false) {
        return {
          ...row,
          status: 'disapproved',
          correction: entry.suggestedTranslation ?? '',
        };
      }

      return row;
    });
  }

  return hydrated;
}

function toPersistedReviewSessions(reviewSessions: ReviewSessions): PersistedReviewSessions {
  const persisted: PersistedReviewSessions = {};

  for (const [sessionKey, rows] of Object.entries(reviewSessions)) {
    persisted[sessionKey] = rows.map((row) => {
      const reviewed = row.status !== null;
      const approved = row.status === 'approved' ? true : row.status === 'disapproved' ? false : null;

      return {
        textId: row.id,
        reviewed,
        approved,
        ...(approved === false ? { suggestedTranslation: row.correction ?? '' } : {}),
      };
    });
  }

  return persisted;
}

export default function App() {
  const [batchDefinitions, setBatchDefinitions] = useState<BatchDefinition[]>([]);
  const [translationSeeds, setTranslationSeeds] = useState<TranslationSeed[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('Spanish');
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [reviewSessions, setReviewSessions] = useState<ReviewSessions>({});
  const [submittedSessions, setSubmittedSessions] = useState<SubmissionSessions>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDialog, setShowDialog] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminAccessPassword, setAdminAccessPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [batchZipFile, setBatchZipFile] = useState<File | null>(null);
  const [batchZipName, setBatchZipName] = useState('');
  const [adminNotice, setAdminNotice] = useState('');
  const [dataLoadError, setDataLoadError] = useState('');
  const [isBatchesLoading, setIsBatchesLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const batchZipInputRef = useRef<HTMLInputElement | null>(null);

  const persistReviewState = async (nextReviewSessions: ReviewSessions, nextSubmittedSessions: SubmissionSessions) => {
    try {
      await fetch(apiUrl('/api/review-state'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reviewSessions: toPersistedReviewSessions(nextReviewSessions),
          submittedSessions: nextSubmittedSessions,
        }),
      });
    } catch {
      // Keep UI responsive even if persistence temporarily fails.
    }
  };

  useEffect(() => {
    const loadPersistedBatchData = async () => {
      try {
        const response = await fetch(apiUrl('/api/batches'));

        if (!response.ok) {
          throw new Error('Failed to fetch persisted batches.');
        }

        const data = (await response.json()) as BatchDataResponse;

        if (!Array.isArray(data.batchDefinitions) || !Array.isArray(data.translationSeeds)) {
          throw new Error('Batch API returned invalid data.');
        }

        setBatchDefinitions(data.batchDefinitions);
        setTranslationSeeds(data.translationSeeds);
        setReviewSessions(hydrateReviewSessions(data.reviewSessions ?? {}, data.translationSeeds));
        setSubmittedSessions(data.submittedSessions ?? {});
        if (data.batchDefinitions.length) {
          setSelectedBatchId(data.batchDefinitions[0].name);
        }
        setDataLoadError('');
      } catch {
        setDataLoadError('Could not load batches from backend. Using local session data.');
      } finally {
        setIsBatchesLoading(false);
      }
    };

    loadPersistedBatchData();
  }, []);

  const createTranslations = (language: string, batchId: string): Translation[] =>
    createTranslationsFromSeeds(translationSeeds, language, batchId);

  const handleEnterReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== languagePasswords[selectedLanguage]) {
      setPasswordError('The password does not match the selected language.');
      return;
    }

    setActiveLanguage(selectedLanguage);
    setIsAdminMode(false);
    setActiveBatchId(null);
    setCurrentIndex(0);
    setShowDialog(false);
    setPassword('');
    setPasswordError('');
  };

  const handleEnterAdminMode = () => {
    setIsAdminMode(true);
    setActiveLanguage(null);
    setActiveBatchId(null);
    setAdminError('');
    setAdminNotice('');
  };

  const handleExitAdminMode = () => {
    setIsAdminMode(false);
    setIsAdminAuthenticated(false);
    setAdminAccessPassword('');
    setAdminError('');
    setAdminNotice('');
    setBatchZipFile(null);
    setBatchZipName('');
  };

  const handleAdminLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (adminAccessPassword !== adminPassword) {
      setAdminError('Invalid admin password.');
      return;
    }

    setIsAdminAuthenticated(true);
    setAdminAccessPassword('');
    setAdminError('');
  };

  const handleBatchZipSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith('.zip')) {
      setBatchZipFile(null);
      setBatchZipName('');
      setAdminNotice('Please select a .zip file.');
      event.target.value = '';
      return;
    }

    setBatchZipFile(file);
    setBatchZipName(file.name);
    setAdminNotice('');
  };

  const handleOpenBatchZipPicker = () => {
    batchZipInputRef.current?.click();
  };

  const handleAddBatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!batchZipFile) {
      setAdminNotice('A zip file is required.');
      return;
    }

    setIsUploading(true);
    try {
      const zip = await JSZip.loadAsync(batchZipFile);
      const zipBatchName = batchZipFile.name.replace(/\.zip$/i, '').trim();

      if (!zipBatchName) {
        setAdminNotice('Zip filename must contain a batch name.');
        return;
      }

      const langContents = (
        await Promise.all(
          SUPPORTED_LANGUAGES.map(async (lang) => {
            const filename = `${lang.toLowerCase()}.json`;
            const entry = getZipEntry(zip, filename);
            if (!entry) {
              return { lang, rows: null };
            }
            const raw = await entry.async('string');
            const rows = parseImportRows(parseJsonContent(raw, filename), lang.toLowerCase());
            return { lang, rows };
          })
        )
      ).filter((lc) => lc.rows !== null) as { lang: string; rows: ImportTranslationRow[] }[];

      if (!langContents.length) {
        setAdminNotice('Zip file must contain at least one language JSON file.');
        return;
      }

      const firstLang = langContents[0];
      if (!firstLang.rows.length) {
        setAdminNotice(`${firstLang.lang.toLowerCase()}.json is empty. Add at least one translation row.`);
        return;
      }

      const rowCount = firstLang.rows.length;
      const mismatchedCount = langContents.find(({ rows }) => rows.length !== rowCount);
      if (mismatchedCount) {
        setAdminNotice(`All language files must have the same number of rows. ${mismatchedCount.lang.toLowerCase()}.json has ${mismatchedCount.rows.length}, expected ${rowCount}.`);
        return;
      }

      const byPanel = new Map(
        langContents.map(({ lang, rows }) => [
          lang,
          new Map(rows.map((row) => [row.panelId, row])),
        ])
      );

      const panelIds = [...byPanel.get(firstLang.lang)!.keys()];

      for (const { lang, rows } of langContents.slice(1)) {
        const panelMap = byPanel.get(lang)!;
        if (
          panelIds.length !== panelMap.size ||
          panelIds.some((id) => !panelMap.has(id))
        ) {
          setAdminNotice(`All language files must contain the same Panel-ID set. Mismatch in ${lang.toLowerCase()}.json.`);
          return;
        }
        const mismatchedText = panelIds.find(
          (id) => rows.find((r) => r.panelId === id)?.originalText !== byPanel.get(firstLang.lang)!.get(id)?.originalText
        );
        if (mismatchedText) {
          throw new Error(`Panel-ID ${mismatchedText} has mismatched original text across language files.`);
        }
      }

      const importedAt = new Date().toISOString();
      const newBatchId = zipBatchName;
      const nextBatch: BatchDefinition = { name: zipBatchName, importedAt };

      const importedSeeds: TranslationSeed[] = panelIds.map((panelId) => {
        const translations: Record<string, string> = {};
        for (const lang of SUPPORTED_LANGUAGES) {
          const panelMap = byPanel.get(lang);
          translations[lang] = panelMap?.get(panelId)?.suggestedTranslation ?? '';
        }
        return {
          id: panelId,
          englishText: byPanel.get(firstLang.lang)!.get(panelId)!.originalText,
          batchId: newBatchId,
          translations,
        };
      });

      const response = await fetch(apiUrl('/api/batches'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          batch: nextBatch,
          translationSeeds: importedSeeds,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(errorPayload?.error ?? 'Failed to persist batch data.');
      }

      const persistedData = (await response.json()) as BatchDataResponse;
      setBatchDefinitions(persistedData.batchDefinitions);
      setTranslationSeeds(persistedData.translationSeeds);
      setReviewSessions(hydrateReviewSessions(persistedData.reviewSessions ?? {}, persistedData.translationSeeds));
      setSubmittedSessions(persistedData.submittedSessions ?? {});
      setBatchZipFile(null);
      setBatchZipName('');
      if (batchZipInputRef.current) {
        batchZipInputRef.current.value = '';
      }
      setAdminNotice(`Added ${nextBatch.name} with ${importedSeeds.length} translation rows from ${batchZipFile.name}. Saved to backend.`);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Could not import this zip file. Verify Panel-ID, Original text, and suggested translation fields in each language JSON.';
      setAdminNotice(message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyCollectedBatches = async () => {
    const reportPayload = reviewedBatchReports.map((report) => ({
      language: report.language,
      batchId: report.batchId,
      batchName: report.batchName,
      approved: report.approved,
      disapproved: report.disapproved,
      total: report.total,
      submitted: true,
    }));

    try {
      await navigator.clipboard.writeText(JSON.stringify(reportPayload, null, 2));
      setAdminNotice('Collected reviewed batches copied to clipboard.');
    } catch {
      setAdminNotice('Could not copy automatically. Please use the list below.');
    }
  };

  const loadBatch = (language: string, batchId: string) => {
    const sessionKey = getSessionKey(language, batchId);
    const sessionTranslations = reviewSessions[sessionKey] ?? createTranslations(language, batchId);

    setSelectedBatchId(batchId);
    setActiveBatchId(batchId);
    setTranslations(sessionTranslations);
    setCurrentIndex(0);
    setShowDialog(false);
  };

  const updateTranslations = (nextTranslations: Translation[]) => {
    if (!activeLanguage || !activeBatchId) {
      return;
    }

    const sessionKey = getSessionKey(activeLanguage, activeBatchId);
    const nextReviewSessions = {
      ...reviewSessions,
      [sessionKey]: nextTranslations,
    };
    setTranslations(nextTranslations);
    setReviewSessions(nextReviewSessions);
    persistReviewState(nextReviewSessions, submittedSessions);
  };

  const handleApprove = (id: string) => {
    updateTranslations(
      translations.map((translation) =>
        translation.id === id ? { ...translation, status: 'approved' as const } : translation
      )
    );

    setCurrentIndex((prev) => (prev < translations.length - 1 ? prev + 1 : prev));
  };

  const handleDisapprove = (id: string, correction?: string) => {
    updateTranslations(
      translations.map((translation) =>
        translation.id === id
          ? { ...translation, status: 'disapproved' as const, correction }
          : translation
      )
    );

    setCurrentIndex((prev) => (prev < translations.length - 1 ? prev + 1 : prev));
  };

  const handleClearStatus = (id: string) => {
    updateTranslations(
      translations.map((translation) =>
        translation.id === id
          ? { ...translation, status: null, correction: undefined }
          : translation
      )
    );
  };

  const handleNext = () => {
    if (currentIndex < translations.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleGoToUnreviewed = () => {
    const unreviewedIndex = translations.findIndex((t) => t.status === null);
    if (unreviewedIndex !== -1) {
      setCurrentIndex(unreviewedIndex);
    }
  };

  const approved = translations.filter((t) => t.status === 'approved').length;
  const disapproved = translations.filter((t) => t.status === 'disapproved').length;
  const currentTranslation = translations[currentIndex];
  const hasTranslations = translations.length > 0;
  const allReviewed = hasTranslations && translations.every((t) => t.status !== null);
  const unreviewedCount = translations.filter((t) => t.status === null).length;
  const currentSessionKey = activeLanguage && activeBatchId
    ? getSessionKey(activeLanguage, activeBatchId)
    : null;
  const hasSubmittedCurrentBatch = currentSessionKey
    ? !!submittedSessions[currentSessionKey]
    : false;
  const allBatchesSubmitted = activeLanguage
    ? batchDefinitions.every((batch) => submittedSessions[getSessionKey(activeLanguage, batch.name)])
    : false;

  const reviewedBatchReports: ReviewedBatchReport[] = Object.entries(submittedSessions)
    .filter(([, submitted]) => submitted)
    .map(([sessionKey]) => {
      const [language, batchId] = sessionKey.split(':') as [string, string];
      const reportTranslations = reviewSessions[sessionKey] ?? createTranslations(language, batchId);
      const approvedCount = reportTranslations.filter((translation) => translation.status === 'approved').length;
      const disapprovedCount = reportTranslations.filter((translation) => translation.status === 'disapproved').length;
      const batchName = batchDefinitions.find((batch) => batch.name === batchId)?.name ?? batchId;

      return {
        sessionKey,
        language,
        batchId,
        batchName,
        approved: approvedCount,
        disapproved: disapprovedCount,
        total: reportTranslations.length,
      };
    });

  const handleSubmit = () => {
    if (allReviewed) {
      if (currentSessionKey) {
        const nextSubmittedSessions = {
          ...submittedSessions,
          [currentSessionKey]: true,
        };
        setSubmittedSessions(nextSubmittedSessions);
        persistReviewState(reviewSessions, nextSubmittedSessions);
      }
      setShowDialog(true);
    } else {
      setShowDialog(true);
    }
  };

  const handleCloseDialog = () => {
    if (allReviewed) {
      handleBackToBatchSelection();
      return;
    }

    setShowDialog(false);
  };

  const handleLanguageSelection = (language: string) => {
    setSelectedLanguage(language);
    setPasswordError('');
  };

  const handleSelectBatch = (batchId: string) => {
    if (!activeLanguage) {
      return;
    }

    loadBatch(activeLanguage, batchId);
  };

  const handleBackToBatchSelection = () => {
    setActiveBatchId(null);
    setTranslations([]);
    setCurrentIndex(0);
    setShowDialog(false);
  };

  if (isAdminMode) {
    return (
      <div className={`min-h-screen ${isDarkMode ? 'bg-[#111615]' : 'bg-gradient-to-br from-[#f6f8f1] to-[#C4D8B1]'}`}>
        <div className="max-w-5xl mx-auto px-4 py-12">
          <div className="flex justify-between items-center mb-6 gap-4">
            <button
              onClick={handleExitAdminMode}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg shadow-md transition-colors ${
                isDarkMode
                  ? 'bg-[#1f2825] text-[#d5ddd8] hover:bg-[#27322e]'
                  : 'bg-white text-[#6A9266] hover:bg-[#f3f6ef]'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Reviewer Access</span>
            </button>
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-3 rounded-lg shadow-md transition-colors ${
                isDarkMode
                  ? 'bg-[#1f2825] text-[#d5ddd8] hover:bg-[#27322e]'
                  : 'bg-white text-[#6A9266] hover:bg-[#f3f6ef]'
              }`}
              aria-label="Toggle dark mode"
            >
              {isDarkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
            </button>
          </div>

          <div className={`rounded-3xl border shadow-xl p-8 md:p-10 ${
            isDarkMode ? 'bg-[#1a2220] border-[#2f3a35]' : 'bg-white/95 border-[#C4D8B1]'
          }`}>
            <div className="mb-8">
              <p className={`text-sm uppercase tracking-[0.2em] mb-2 ${isDarkMode ? 'text-[#93a19a]' : 'text-[#808080]'}`}>
                Admin Workspace
              </p>
              <h1 className={`text-4xl mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Batch Management</h1>
              <p className={`text-lg ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#808080]'}`}>
                Add new batches and collect reviewed batch submissions.
              </p>
            </div>

            {!isAdminAuthenticated ? (
              <form onSubmit={handleAdminLogin} className="max-w-xl space-y-5">
                <label
                  htmlFor="admin-password"
                  className={`block text-sm ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}`}
                >
                  Admin password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  value={adminAccessPassword}
                  onChange={(event) => {
                    setAdminAccessPassword(event.target.value);
                    if (adminError) {
                      setAdminError('');
                    }
                  }}
                  className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#6A9266] ${
                    isDarkMode
                      ? 'bg-[#121917] border-[#3a4742] text-white placeholder-[#74827b]'
                      : 'bg-white border-[#8BA295] text-gray-900 placeholder-[#808080]'
                  }`}
                  placeholder="Enter admin password"
                />
                {adminError && <p className="text-sm text-[#A81524]">{adminError}</p>}
                <button
                  type="submit"
                  className="px-6 py-3 bg-[#6A9266] text-white rounded-lg hover:bg-[#5d8259] transition-colors"
                >
                  Enter Admin Mode
                </button>
              </form>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <form
                  onSubmit={handleAddBatch}
                  className={`rounded-2xl border p-6 space-y-4 ${
                    isDarkMode ? 'bg-[#141b19] border-[#2f3a35]' : 'bg-[#f7f8f3] border-[#C4D8B1]'
                  }`}
                >
                  <h2 className={`text-2xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Add Batch</h2>
                  <p className={`text-sm ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}`}>
                    Batch name is taken from the zip filename. Include one JSON file per language named
                    <code className="mx-1 font-mono">{'{language}.json'}</code>
                    (e.g. <code className="font-mono">french.json</code>).
                    Each row must contain Panel-ID, Original text, and suggested translation.
                  </p>
                  <input
                    ref={batchZipInputRef}
                    type="file"
                    accept=".zip,application/zip"
                    onChange={handleBatchZipSelect}
                    className="hidden"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleOpenBatchZipPicker}
                      className="px-4 py-2 bg-[#4e5a55] text-white rounded-lg hover:bg-[#5f6d67] transition-colors"
                    >
                      Select Batch Zip
                    </button>
                    <span className={`text-sm ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}`}>
                      {batchZipName || 'No zip file selected'}
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="px-6 py-3 bg-[#6A9266] text-white rounded-lg hover:bg-[#5d8259] transition-colors"
                  >
                    Add Batch
                  </button>
                </form>

                <div
                  className={`rounded-2xl border p-6 ${
                    isDarkMode ? 'bg-[#141b19] border-[#2f3a35]' : 'bg-[#f7f8f3] border-[#C4D8B1]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-4 gap-3">
                    <h2 className={`text-2xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Collected Reviewed Batches</h2>
                    <button
                      onClick={handleCopyCollectedBatches}
                      className="px-4 py-2 bg-[#6A9266] text-white rounded-lg hover:bg-[#5d8259] transition-colors text-sm"
                      type="button"
                    >
                      Copy Report
                    </button>
                  </div>

                  {reviewedBatchReports.length === 0 ? (
                    <p className={isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}>
                      No submitted batches yet.
                    </p>
                  ) : (
                    <div className="space-y-3 max-h-[320px] overflow-auto pr-1">
                      {reviewedBatchReports.map((report) => (
                        <div
                          key={report.sessionKey}
                          className={`rounded-xl border px-4 py-3 ${
                            isDarkMode ? 'bg-[#1f2b25] border-[#2f3a35]' : 'bg-white border-[#C4D8B1]'
                          }`}
                        >
                          <p className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {report.batchName} ({report.language})
                          </p>
                          <p className={isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}>
                            Approved {report.approved} • Disapproved {report.disapproved} • Total {report.total}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {adminNotice && (
              <p className={`mt-5 text-sm ${isDarkMode ? 'text-[#93a19a]' : 'text-[#556052]'}`}>{adminNotice}</p>
            )}
            {dataLoadError && (
              <p className="mt-3 text-sm text-[#A81524]">{dataLoadError}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!activeLanguage) {
    return (
      <div className={`min-h-screen ${isDarkMode ? 'bg-[#111615]' : 'bg-gradient-to-br from-[#f6f8f1] to-[#C4D8B1]'}`}>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="flex justify-between items-center mb-6">
            <button
              onClick={handleEnterAdminMode}
              className={`px-4 py-2 rounded-lg shadow-md transition-colors ${
                isDarkMode
                  ? 'bg-[#1f2825] text-[#d5ddd8] hover:bg-[#27322e]'
                  : 'bg-white text-[#6A9266] hover:bg-[#f3f6ef]'
              }`}
            >
              Admin Mode
            </button>
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-3 rounded-lg shadow-md transition-colors ${
                isDarkMode
                  ? 'bg-[#1f2825] text-[#d5ddd8] hover:bg-[#27322e]'
                  : 'bg-white text-[#6A9266] hover:bg-[#f3f6ef]'
              }`}
              aria-label="Toggle dark mode"
            >
              {isDarkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
            </button>
          </div>

          <div className={`rounded-3xl border shadow-xl p-8 md:p-10 ${
            isDarkMode ? 'bg-[#1a2220] border-[#2f3a35]' : 'bg-white/95 border-[#C4D8B1]'
          }`}>
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center gap-3 mb-4 flex-wrap">
                <div className={`rounded-2xl p-3 ${isDarkMode ? 'bg-[#1f2b25]' : 'bg-[#C4D8B1]/60'}`}>
                  <Languages className={`w-8 h-8 ${isDarkMode ? 'text-[#8BA295]' : 'text-[#6A9266]'}`} />
                </div>
                <h1 className={`text-4xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Translation Review Access</h1>
                <div className={`rounded-2xl p-3 ${isDarkMode ? 'bg-[#222f2a]' : 'bg-[#C4D8B1]/70'}`}>
                  <LockKeyhole className={`w-8 h-8 ${isDarkMode ? 'text-[#8BA295]' : 'text-[#6A9266]'}`} />
                </div>
              </div>
              <p className={`text-lg ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#808080]'}`}>
                Select the language you are assigned to review, then enter its password to unlock the session.
              </p>
              {dataLoadError && (
                <p className="mt-3 text-sm text-[#A81524]">{dataLoadError}</p>
              )}
            </div>

            <form onSubmit={handleEnterReview} className="space-y-8">
              <div>
                <p className={`text-sm uppercase tracking-[0.2em] mb-4 ${isDarkMode ? 'text-[#93a19a]' : 'text-[#808080]'}`}>
                  Choose language
                </p>
                <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                  {SUPPORTED_LANGUAGES.map((language) => {
                    const isActive = selectedLanguage === language;
                    const isComplete = batchDefinitions.every((batch) => {
                      const sessionKey = getSessionKey(language, batch.name);
                      return submittedSessions[sessionKey];
                    });

                    return (
                      <button
                        key={language}
                        type="button"
                        onClick={() => handleLanguageSelection(language)}
                        className={`rounded-lg border p-4 text-center transition-all relative ${
                          isActive
                            ? isDarkMode
                              ? 'bg-[#22302a] border-[#6A9266] shadow-md'
                              : 'bg-[#C4D8B1]/50 border-[#6A9266] shadow-md'
                            : isDarkMode
                            ? 'bg-[#141b19] border-[#2f3a35] hover:border-[#6A9266]/60'
                            : 'bg-[#f7f8f3] border-[#C4D8B1] hover:border-[#8BA295]'
                        }`}
                      >
                        <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                          {language}
                        </p>
                        {isComplete && (
                          <span className="absolute top-2 right-2 bg-[#6A9266] text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {batchDefinitions.length > 0 && batchDefinitions.every((batch) => submittedSessions[getSessionKey(selectedLanguage, batch.name)]) && (
                <div className={`rounded-2xl border px-5 py-4 ${
                  isDarkMode ? 'bg-[#1a3d2e] border-[#6A9266]' : 'bg-[#e8f1e0] border-[#6A9266]'
                }`}>
                  <p className={`text-sm font-medium ${isDarkMode ? 'text-[#8FD99E]' : 'text-[#4a7c4e]'}`}>
                    ✓ All batches completed for {selectedLanguage}
                  </p>
                </div>
              )}

              {!isBatchesLoading && batchDefinitions.length === 0 && (
                <div className={`rounded-2xl border px-5 py-4 ${
                  isDarkMode ? 'bg-[#1a3d2e] border-[#6A9266]' : 'bg-[#e8f1e0] border-[#6A9266]'
                }`}>
                  <p className={`text-sm font-medium ${isDarkMode ? 'text-[#8FD99E]' : 'text-[#4a7c4e]'}`}>
                    No new batches to review for {selectedLanguage}. You can still make changes to previous reviews.
                  </p>
                </div>
              )}

              <div className="max-w-xl">
                <label
                  htmlFor="language-password"
                  className={`block text-sm mb-2 ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}`}
                >
                  Password for {selectedLanguage}
                </label>
                <input
                  id="language-password"
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (passwordError) {
                      setPasswordError('');
                    }
                  }}
                  className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#6A9266] ${
                    isDarkMode
                        ? 'bg-[#121917] border-[#3a4742] text-white placeholder-[#74827b]'
                      : 'bg-white border-[#8BA295] text-gray-900 placeholder-[#808080]'
                  }`}
                  placeholder="Enter the access password"
                />
                {passwordError && (
                  <p className="mt-2 text-sm text-[#A81524]">{passwordError}</p>
                )}
              </div>

              <div className={`rounded-2xl border px-5 py-4 ${
                isDarkMode ? 'bg-[#141b19] border-[#2f3a35] text-[#b7c2bb]' : 'bg-[#f7f8f3] border-[#C4D8B1] text-[#556052]'
              }`}>
                <p className="text-sm">
                  Password format: <span className="font-mono font-semibold">{'{language}-review'}</span> — e.g. <span className="font-mono font-semibold">french-review</span>, <span className="font-mono font-semibold">german-review</span>
                </p>
              </div>

              <button
                type="submit"
                className="w-full px-6 py-4 bg-[#6A9266] text-white rounded-xl shadow-md hover:bg-[#5d8259] transition-colors text-lg"
              >
                Start Reviewing
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (!activeBatchId) {
    return (
      <div className={`min-h-screen ${isDarkMode ? 'bg-[#111615]' : 'bg-gradient-to-br from-[#f6f8f1] to-[#C4D8B1]'}`}>
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="flex justify-end items-center mb-6 gap-4">
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-3 rounded-lg shadow-md transition-colors ${
                isDarkMode
                  ? 'bg-[#1f2825] text-[#d5ddd8] hover:bg-[#27322e]'
                  : 'bg-white text-[#6A9266] hover:bg-[#f3f6ef]'
              }`}
              aria-label="Toggle dark mode"
            >
              {isDarkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
            </button>
          </div>

          <div className={`rounded-3xl border shadow-xl p-8 md:p-10 ${
            isDarkMode ? 'bg-[#1a2220] border-[#2f3a35]' : 'bg-white/95 border-[#C4D8B1]'
          }`}>
            <div className="mb-8">
              <p className={`text-sm uppercase tracking-[0.2em] mb-3 ${isDarkMode ? 'text-[#93a19a]' : 'text-[#808080]'}`}>
                {activeLanguage} reviewer workspace
              </p>
              <h1 className={`text-4xl mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Choose a Batch</h1>
              <p className={`text-lg ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#808080]'}`}>
                Open the next translation batch. Completed batches are marked so reviewers can avoid repeating work.
              </p>
            </div>

            {allBatchesSubmitted && (
              <div className={`mb-6 rounded-2xl border px-5 py-4 ${
                isDarkMode
                  ? 'bg-[#1f2b25] border-[#6A9266]/50 text-[#b7c2bb]'
                  : 'bg-[#C4D8B1]/35 border-[#8BA295] text-[#335033]'
              }`}>
                <p className="text-base font-medium">
                  All batches for {activeLanguage} are done. Every batch has been submitted.
                </p>
                <p className="text-sm mt-2">
                  You can still open any batch and update its submission if needed.
                </p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              {batchDefinitions.map((batch) => {
                const sessionKey = getSessionKey(activeLanguage, batch.name);
                const sessionTranslations = reviewSessions[sessionKey];
                const reviewed = isBatchReviewed(sessionTranslations);
                const reviewedCount = sessionTranslations?.filter((translation) => translation.status !== null).length ?? 0;
                const totalCount = sessionTranslations?.length ?? createTranslations(activeLanguage, batch.name).length;
                const isSelected = selectedBatchId === batch.name;

                return (
                  <button
                    key={batch.name}
                    type="button"
                    onClick={() => handleSelectBatch(batch.name)}
                    className={`rounded-2xl border p-5 text-left transition-all ${
                      reviewed
                        ? isDarkMode
                          ? 'bg-[#22302a] border-[#6A9266]/65'
                          : 'bg-[#C4D8B1]/40 border-[#8BA295]'
                        : isSelected
                        ? isDarkMode
                          ? 'bg-[#22302a] border-[#6A9266]/70'
                          : 'bg-[#C4D8B1]/30 border-[#6A9266]'
                        : isDarkMode
                        ? 'bg-[#141b19] border-[#2f3a35] hover:border-[#6A9266]/60'
                        : 'bg-[#f7f8f3] border-[#C4D8B1] hover:border-[#8BA295]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className={`text-xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{batch.name}</p>
                        <p className={`text-sm mt-1 ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#808080]'}`}>
                          Imported {formatImportedAt(batch.importedAt)}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        reviewed
                          ? 'bg-[#6A9266] text-white'
                          : isDarkMode
                          ? 'bg-[#27322e] text-[#d5ddd8]'
                          : 'bg-white text-[#808080]'
                      }`}>
                        {reviewed ? 'Reviewed' : 'Open'}
                      </span>
                    </div>
                    <p className={`text-sm ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}`}>
                      {reviewedCount} of {totalCount} reviewed
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Upload Modal */}
        {isUploading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/50" />
            <div className={`relative rounded-lg shadow-xl p-8 flex flex-col items-center gap-4 ${
              isDarkMode ? 'bg-[#1a2220]' : 'bg-white'
            }`}>
              <div className="w-10 h-10 rounded-full border-4 border-[#6A9266] border-t-transparent animate-spin" />
              <p className={`text-sm font-medium ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}`}>
                Uploading batch…
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-[#111615]' : 'bg-gradient-to-br from-[#f6f8f1] to-[#C4D8B1]'}`}>
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Dark Mode Toggle */}
        <div className="flex justify-end mb-6">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-3 rounded-lg shadow-md transition-colors ${
              isDarkMode 
                ? 'bg-[#1f2825] text-[#d5ddd8] hover:bg-[#27322e]' 
                : 'bg-white text-[#6A9266] hover:bg-[#f3f6ef]'
            }`}
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
          </button>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-start mb-6">
            <button
              onClick={handleBackToBatchSelection}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg shadow-md transition-colors ${
                isDarkMode
                  ? 'bg-[#1f2825] text-[#d5ddd8] hover:bg-[#27322e]'
                  : 'bg-white text-[#6A9266] hover:bg-[#f3f6ef]'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Change Batch</span>
            </button>
          </div>
          <div className="flex items-center justify-center gap-3 mb-4">
            <Languages className={`w-10 h-10 ${isDarkMode ? 'text-[#8BA295]' : 'text-[#6A9266]'}`} />
            <h1 className={`text-4xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Translation Review</h1>
          </div>
          <p className={`text-lg ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#808080]'}`}>
            Help us improve translations by approving or disapproving each one
          </p>
          <p className={`text-sm mt-3 ${isDarkMode ? 'text-[#93a19a]' : 'text-[#6A9266]'}`}>
            Reviewing {activeLanguage} · {batchDefinitions.find((batch) => batch.name === activeBatchId)?.name}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-6">
          <ProgressBar
            current={currentIndex + 1}
            total={translations.length}
            approved={approved}
            disapproved={disapproved}
            isDarkMode={isDarkMode}
          />
        </div>

        {/* Current Translation Card */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <span className={`text-sm ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#808080]'}`}>
              {hasTranslations
                ? `Translation ${currentIndex + 1} of ${translations.length}`
                : 'No translation texts available in this batch yet'}
            </span>
            {hasTranslations && unreviewedCount > 0 && (
              <button
                onClick={handleGoToUnreviewed}
                className="px-4 py-2 bg-[#4e5a55] text-white rounded-lg shadow-md hover:bg-[#5f6d67] transition-colors text-sm"
              >
                Skip to Unreviewed ({unreviewedCount})
              </button>
            )}
          </div>
          {hasTranslations ? (
            <TranslationCard
              id={currentTranslation.id}
              englishText={currentTranslation.englishText}
              translatedText={currentTranslation.translatedText}
              language={currentTranslation.language}
              onApprove={handleApprove}
              onDisapprove={handleDisapprove}
              onClearStatus={handleClearStatus}
              status={currentTranslation.status}
              correction={currentTranslation.correction}
              isDarkMode={isDarkMode}
            />
          ) : (
            <div className={`rounded-lg border p-6 ${isDarkMode ? 'bg-[#1a2220] border-[#2f3a35] text-[#b7c2bb]' : 'bg-white border-[#C4D8B1] text-[#556052]'}`}>
              This batch was added but has no translation entries yet.
            </div>
          )}
        </div>

        {/* Navigation Buttons */}
        <div className="flex gap-4">
          <button
            onClick={handlePrevious}
            disabled={!hasTranslations || currentIndex === 0}
            className={`flex-1 px-6 py-3 rounded-lg shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
              isDarkMode
                ? 'bg-[#1f2825] text-[#d5ddd8] hover:bg-[#27322e]'
                : 'bg-white text-[#6A9266] hover:bg-[#f3f6ef]'
            }`}
          >
            Previous
          </button>
          <button
            onClick={handleNext}
            disabled={!hasTranslations || currentIndex === translations.length - 1}
            className="flex-1 px-6 py-3 bg-[#6A9266] text-white rounded-lg shadow-md hover:bg-[#5d8259] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>

        {/* Submit Button */}
        <div className="mt-6">
          <div className="relative group">
            <button
              onClick={handleSubmit}
              disabled={!allReviewed || !hasTranslations}
              className="w-full px-6 py-4 bg-[#6A9266] text-white rounded-lg shadow-md hover:bg-[#5d8259] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-lg disabled:bg-[#4e5a55]"
            >
              {hasSubmittedCurrentBatch ? 'Update Submission' : 'Submit All Reviews'}
            </button>
            {(!allReviewed || !hasTranslations) && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-[#1f2825] text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                {hasTranslations ? 'Review all translations before submitting' : 'No translations in this batch yet'}
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-[#1f2825]" />
              </div>
            )}
          </div>
        </div>

        {/* Completion Message */}
        {hasTranslations && approved + disapproved === translations.length && !hasSubmittedCurrentBatch && (
          <div className={`mt-6 rounded-lg p-6 text-center border ${
            isDarkMode 
                ? 'bg-[#1f2b25] border-[#6A9266]/55 text-[#b7c2bb]' 
              : 'bg-[#C4D8B1]/35 border-[#8BA295] text-[#335033]'
          }`}>
            <p className="text-lg">
              All translations reviewed! You can now submit your feedback.
            </p>
          </div>
        )}

        {hasTranslations && approved + disapproved === translations.length && hasSubmittedCurrentBatch && (
          <div className={`mt-6 rounded-lg p-6 text-center border ${
            isDarkMode
                ? 'bg-[#1b2522] border-[#3f4e48] text-[#b7c2bb]'
              : 'bg-[#f3f6ef] border-[#8BA295] text-[#335033]'
          }`}>
            <p className="text-lg">
              This batch was already submitted. You can update the submission if you make changes.
            </p>
          </div>
        )}

        {/* Loading Modal */}
        {isBatchesLoading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/50" />
            <div className={`relative rounded-lg shadow-xl p-8 flex flex-col items-center gap-4 ${
              isDarkMode ? 'bg-[#1a2220]' : 'bg-white'
            }`}>
              <div className="w-10 h-10 rounded-full border-4 border-[#6A9266] border-t-transparent animate-spin" />
              <p className={`text-sm font-medium ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}`}>
                Loading batches…
              </p>
            </div>
          </div>
        )}

        {/* Submit Dialog */}
        <SubmitDialog
          isOpen={showDialog}
          onClose={handleCloseDialog}
          isSuccess={allReviewed}
          unreviewedCount={unreviewedCount}
          isDarkMode={isDarkMode}
        />
      </div>
    </div>
  );
}