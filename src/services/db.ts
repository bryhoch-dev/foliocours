import type {
  CloudSearchIndexDocument,
  CloudSearchIndexPayload,
  CourseDocument,
  SearchResult,
  StoredDocumentMeta,
  StoredPageText,
} from '../types/course';

const DB_NAME = 'foliocours-db';
const DB_VERSION = 2;

const STORE_HANDLES = 'handles';
const STORE_DOCUMENTS = 'documents';
const STORE_PAGES = 'pages';
const STORE_CLOUD_FILES = 'cloud_files';

const CLOUD_INDEX_KEY = 'cloud_search_index';
const CLOUD_LIBRARY_KEY = 'cloud_library_tree';

export interface CachedCloudFile {
  driveFileId: string;
  relativePath: string;
  name: string;
  modifiedTime: string;
  blob: Blob;
  cachedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
      if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
        db.createObjectStore(STORE_DOCUMENTS, {keyPath: 'relativePath'});
      }
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        const pageStore = db.createObjectStore(STORE_PAGES, {keyPath: 'id'});
        pageStore.createIndex('by_docPath', 'docPath', {unique: false});
      }
      if (!db.objectStoreNames.contains(STORE_CLOUD_FILES)) {
        db.createObjectStore(STORE_CLOUD_FILES, {keyPath: 'driveFileId'});
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function saveRootDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readwrite');
    tx.objectStore(STORE_HANDLES).put(handle, 'root');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getRootDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readonly');
    const req = tx.objectStore(STORE_HANDLES).get('root');
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearRootDirectoryHandle(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readwrite');
    tx.objectStore(STORE_HANDLES).delete('root');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveCloudSearchIndex(payload: CloudSearchIndexPayload): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readwrite');
    tx.objectStore(STORE_HANDLES).put(payload, CLOUD_INDEX_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCloudSearchIndex(): Promise<CloudSearchIndexPayload | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readonly');
    const req = tx.objectStore(STORE_HANDLES).get(CLOUD_INDEX_KEY);
    req.onsuccess = () => resolve((req.result as CloudSearchIndexPayload) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearCloudSearchIndex(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readwrite');
    tx.objectStore(STORE_HANDLES).delete(CLOUD_INDEX_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveCloudDocumentsCache(docs: CourseDocument[]): Promise<void> {
  const db = await openDatabase();
  const serializable = docs.map(({handle: _handle, ...rest}) => rest);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readwrite');
    tx.objectStore(STORE_HANDLES).put(serializable, CLOUD_LIBRARY_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCloudDocumentsCache(): Promise<CourseDocument[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readonly');
    const req = tx.objectStore(STORE_HANDLES).get(CLOUD_LIBRARY_KEY);
    req.onsuccess = () =>
      resolve(Array.isArray(req.result) ? (req.result as CourseDocument[]) : []);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedCloudFile(
  driveFileId: string
): Promise<CachedCloudFile | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CLOUD_FILES, 'readonly');
    const req = tx.objectStore(STORE_CLOUD_FILES).get(driveFileId);
    req.onsuccess = () => resolve((req.result as CachedCloudFile) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCachedCloudFile(record: CachedCloudFile): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CLOUD_FILES, 'readwrite');
    tx.objectStore(STORE_CLOUD_FILES).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCloudCacheStats(): Promise<{
  cachedFileCount: number;
  cachedBytes: number;
  indexDocCount: number;
}> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CLOUD_FILES, STORE_HANDLES], 'readonly');
    const filesReq = tx.objectStore(STORE_CLOUD_FILES).openCursor();
    const indexReq = tx.objectStore(STORE_HANDLES).get(CLOUD_INDEX_KEY);

    let cachedFileCount = 0;
    let cachedBytes = 0;
    let indexDocCount = 0;

    filesReq.onsuccess = () => {
      const cursor = filesReq.result;
      if (cursor) {
        const val = cursor.value as CachedCloudFile;
        cachedFileCount++;
        cachedBytes += val.blob?.size ?? 0;
        cursor.continue();
      }
    };

    indexReq.onsuccess = () => {
      const idx = indexReq.result as CloudSearchIndexPayload | undefined;
      indexDocCount = idx?.documents?.length ?? 0;
    };

    tx.oncomplete = () => resolve({cachedFileCount, cachedBytes, indexDocCount});
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllOfflineCloudCache(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CLOUD_FILES, STORE_HANDLES], 'readwrite');
    tx.objectStore(STORE_CLOUD_FILES).clear();
    tx.objectStore(STORE_HANDLES).delete(CLOUD_INDEX_KEY);
    tx.objectStore(STORE_HANDLES).delete(CLOUD_LIBRARY_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllIndexedDocuments(): Promise<Map<string, StoredDocumentMeta>> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCUMENTS, 'readonly');
    const req = tx.objectStore(STORE_DOCUMENTS).getAll();
    req.onsuccess = () => {
      const map = new Map<string, StoredDocumentMeta>();
      for (const item of (req.result as StoredDocumentMeta[]) || []) {
        map.set(item.relativePath, item);
      }
      resolve(map);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveDocumentWithPages(
  meta: StoredDocumentMeta,
  pages: Array<{pageNumber: number; text: string}>
): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_DOCUMENTS, STORE_PAGES], 'readwrite');
    const docStore = tx.objectStore(STORE_DOCUMENTS);
    const pageStore = tx.objectStore(STORE_PAGES);

    const index = pageStore.index('by_docPath');
    const range = IDBKeyRange.only(meta.relativePath);
    const cursorReq = index.openCursor(range);

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        docStore.put(meta);
        for (const page of pages) {
          const record: StoredPageText = {
            id: `${meta.relativePath}::${page.pageNumber}`,
            docPath: meta.relativePath,
            pageNumber: page.pageNumber,
            text: page.text,
          };
          pageStore.put(record);
        }
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function pruneMissingDocuments(existingPaths: Set<string>): Promise<void> {
  const db = await openDatabase();
  const docs = await getAllIndexedDocuments();
  const missing: string[] = [];
  for (const path of docs.keys()) {
    if (!existingPaths.has(path)) {
      missing.push(path);
    }
  }
  if (missing.length === 0) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_DOCUMENTS, STORE_PAGES], 'readwrite');
    const docStore = tx.objectStore(STORE_DOCUMENTS);
    const pageIndex = tx.objectStore(STORE_PAGES).index('by_docPath');

    for (const path of missing) {
      docStore.delete(path);
      const req = pageIndex.openCursor(IDBKeyRange.only(path));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearSearchIndex(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_DOCUMENTS, STORE_PAGES], 'readwrite');
    tx.objectStore(STORE_DOCUMENTS).clear();
    tx.objectStore(STORE_PAGES).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getIndexStats(): Promise<{documentCount: number; pageCount: number}> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_DOCUMENTS, STORE_PAGES], 'readonly');
    const docCountReq = tx.objectStore(STORE_DOCUMENTS).count();
    const pageCountReq = tx.objectStore(STORE_PAGES).count();
    let documentCount = 0;
    let pageCount = 0;

    docCountReq.onsuccess = () => {
      documentCount = docCountReq.result;
    };
    pageCountReq.onsuccess = () => {
      pageCount = pageCountReq.result;
    };
    tx.oncomplete = () => resolve({documentCount, pageCount});
    tx.onerror = () => reject(tx.error);
  });
}

export async function getIndexedPagesByDocPaths(
  docPaths: string[]
): Promise<Map<string, Array<{pageNumber: number; text: string}>>> {
  const result = new Map<string, Array<{pageNumber: number; text: string}>>();
  if (docPaths.length === 0) return result;

  const db = await openDatabase();
  const uniquePaths = Array.from(new Set(docPaths));

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, 'readonly');
    const pageIndex = tx.objectStore(STORE_PAGES).index('by_docPath');

    for (const path of uniquePaths) {
      const req = pageIndex.getAll(IDBKeyRange.only(path));
      req.onsuccess = () => {
        const rows = ((req.result as StoredPageText[]) ?? [])
          .filter((r) => !!r.text)
          .sort((a, b) => a.pageNumber - b.pageNumber)
          .map((r) => ({pageNumber: r.pageNumber, text: r.text}));
        if (rows.length > 0) {
          result.set(path, rows);
        }
      };
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Exports all indexed documents and page text from IndexedDB via cursor
 * into a compact JSON payload suitable for uploading as `search_index.json` on Drive.
 */
export async function exportSearchIndexForCloud(): Promise<CloudSearchIndexPayload> {
  const db = await openDatabase();
  const docsMap = await getAllIndexedDocuments();
  const grouped = new Map<string, CloudSearchIndexDocument>();

  for (const meta of docsMap.values()) {
    grouped.set(meta.relativePath, {
      relativePath: meta.relativePath,
      name: meta.name,
      subject: meta.subject,
      professor: meta.professor,
      pageCount: meta.pageCount,
      pages: [],
    });
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, 'readonly');
    const req = tx.objectStore(STORE_PAGES).openCursor();

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const record = cursor.value as StoredPageText;
      const entry = grouped.get(record.docPath);
      if (entry && record.text) {
        entry.pages.push({p: record.pageNumber, t: record.text});
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  const documents = Array.from(grouped.values()).map((doc) => ({
    ...doc,
    pages: doc.pages.sort((a, b) => a.p - b.p),
  }));

  return {
    version: 1,
    generatedAt: Date.now(),
    documents,
  };
}

export function normaliserTexte(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface QuerySearchMatchers {
  qNorm: string;
  regexMotExact: RegExp;
  regexDebutMot: RegExp;
  regexPartiel: RegExp;
}

function buildQuerySearchMatchers(rawQuery: string): QuerySearchMatchers | null {
  const qNorm = normaliserTexte(rawQuery).replace(/\s+/g, ' ').trim();
  if (!qNorm) return null;

  const qPattern = escapeRegExp(qNorm).replace(/ /g, '\\s+');
  const startsWithWord = /^\w/.test(qNorm);
  const endsWithWord = /\w$/.test(qNorm);

  const startBoundary = startsWithWord ? '\\b' : '';
  const exactEndBoundary = endsWithWord ? '(s|es|x)?\\b' : '';

  try {
    return {
      qNorm,
      regexMotExact: new RegExp(`${startBoundary}${qPattern}${exactEndBoundary}`, 'g'),
      regexDebutMot: new RegExp(`${startBoundary}${qPattern}`, 'g'),
      regexPartiel: new RegExp(qPattern, 'g'),
    };
  } catch {
    return null;
  }
}

interface NormalizedTextMap {
  normalized: string;
  rawStart: number[];
  rawEnd: number[];
}

function buildNormalizedTextMap(rawText: string): NormalizedTextMap {
  let normalized = '';
  const rawStart: number[] = [];
  const rawEnd: number[] = [];

  let i = 0;
  while (i < rawText.length) {
    const code = rawText.charCodeAt(i);
    const step =
      code >= 0xd800 && code <= 0xdbff && i + 1 < rawText.length ? 2 : 1;
    const rawChar = rawText.slice(i, i + step);
    const normPart = rawChar
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (normPart.length === 0) {
      if (rawEnd.length > 0) {
        rawEnd[rawEnd.length - 1] = i + step;
      }
    } else {
      for (let k = 0; k < normPart.length; k++) {
        normalized += normPart[k];
        rawStart.push(i);
        rawEnd.push(i + step);
      }
    }
    i += step;
  }

  return {normalized, rawStart, rawEnd};
}

function collectRegexMatches(regex: RegExp, text: string): Array<{index: number; length: number}> {
  const re = new RegExp(regex.source, 'g');
  const matches: Array<{index: number; length: number}> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) break;
    matches.push({index: m.index, length: m[0].length});
  }
  return matches;
}

function findFirstRegexMatch(
  regex: RegExp,
  text: string
): {index: number; length: number} | null {
  const re = new RegExp(regex.source, 'g');
  const m = re.exec(text);
  if (!m || m[0].length === 0) return null;
  return {index: m.index, length: m[0].length};
}

const DIACRITIC_MAP: Record<string, string> = {
  a: '[aàâäáã]',
  e: '[eéèêë]',
  i: '[iîïí]',
  o: '[oôöóõ]',
  u: '[uùûüú]',
  c: '[cç]',
  n: '[nñ]',
  y: '[yÿ]',
};

export function buildAccentInsensitiveRegex(rawQuery: string): RegExp | null {
  const trimmed = rawQuery.trim();
  if (!trimmed) return null;

  const normalized = normaliserTexte(trimmed);

  let pattern = '';
  for (const ch of normalized) {
    if (DIACRITIC_MAP[ch]) {
      pattern += DIACRITIC_MAP[ch];
    } else if (/\s/.test(ch)) {
      pattern += '\\s+';
    } else {
      pattern += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

/**
 * Returns raw character ranges in `text` to highlight, prioritizing exact whole words
 * first, then word-prefix matches, then partial matches so snippets highlight the right word.
 */
export function findHighlightRanges(
  text: string,
  query: string
): Array<{start: number; end: number}> {
  const matchers = buildQuerySearchMatchers(query);
  if (!matchers || !text) return [];

  const {normalized, rawStart, rawEnd} = buildNormalizedTextMap(text);
  if (!normalized) return [];

  let chosen = collectRegexMatches(matchers.regexMotExact, normalized);
  if (chosen.length === 0) {
    chosen = collectRegexMatches(matchers.regexDebutMot, normalized);
  }
  if (chosen.length === 0) {
    chosen = collectRegexMatches(matchers.regexPartiel, normalized);
  }

  const ranges: Array<{start: number; end: number}> = [];
  for (const hit of chosen) {
    const endNormIdx = hit.index + hit.length - 1;
    if (hit.index < rawStart.length && endNormIdx < rawEnd.length) {
      ranges.push({
        start: rawStart[hit.index],
        end: rawEnd[endNormIdx],
      });
    }
  }
  return ranges;
}

function extractSnippet(text: string, matchIndex: number, matchLength: number): string {
  const radius = 85;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + matchLength + radius);
  let slice = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) slice = `…${slice}`;
  if (end < text.length) slice = `${slice}…`;
  return slice;
}

interface EvaluatedPageMatch {
  score: number;
  matchLevel: 2 | 3 | 4;
  exactCount: number;
  snippet: string;
}

function evaluateTitleMatch(
  doc: {name: string; subject: string; professor: string},
  matchers: QuerySearchMatchers
): {score: number; matchLevel: 1 | 3 | 4} | null {
  const titleNormalized = normaliserTexte(
    `${doc.name} ${doc.subject} ${doc.professor}`
  ).replace(/[_-]+/g, ' ');

  if (findFirstRegexMatch(matchers.regexMotExact, titleNormalized)) {
    return {score: 1000, matchLevel: 1};
  }
  if (findFirstRegexMatch(matchers.regexDebutMot, titleNormalized)) {
    return {score: 100, matchLevel: 3};
  }
  if (
    titleNormalized.includes(matchers.qNorm) ||
    findFirstRegexMatch(matchers.regexPartiel, titleNormalized)
  ) {
    return {score: 1, matchLevel: 4};
  }
  return null;
}

function evaluatePageTextMatch(
  rawText: string,
  matchers: QuerySearchMatchers
): EvaluatedPageMatch | null {
  if (!rawText) return null;
  const normText = normaliserTexte(rawText);

  // Fast pre-check before running regexes
  const hasQuickSubstring = normText.includes(matchers.qNorm);
  const partialFallback = hasQuickSubstring
    ? null
    : findFirstRegexMatch(matchers.regexPartiel, normText);
  if (!hasQuickSubstring && !partialFallback) {
    return null;
  }

  const exactMatches = collectRegexMatches(matchers.regexMotExact, normText);
  let matchLevel: 2 | 3 | 4;
  let score: number;
  let anchor: {index: number; length: number} | null = null;

  if (exactMatches.length > 0) {
    matchLevel = 2;
    score = 500 + Math.min(200, exactMatches.length * 10);
    anchor = exactMatches[0];
  } else {
    const prefixMatch = findFirstRegexMatch(matchers.regexDebutMot, normText);
    if (prefixMatch) {
      matchLevel = 3;
      score = 50;
      anchor = prefixMatch;
    } else {
      matchLevel = 4;
      score = 1;
      const idx = normText.indexOf(matchers.qNorm);
      anchor =
        idx >= 0
          ? {index: idx, length: matchers.qNorm.length}
          : partialFallback;
    }
  }

  let rawMatchStart = 0;
  let rawMatchLen = 0;
  if (anchor) {
    const {rawStart, rawEnd} = buildNormalizedTextMap(rawText);
    const endIdx = anchor.index + anchor.length - 1;
    if (anchor.index < rawStart.length && endIdx < rawEnd.length) {
      rawMatchStart = rawStart[anchor.index];
      rawMatchLen = rawEnd[endIdx] - rawMatchStart;
    }
  }

  return {
    score,
    matchLevel,
    exactCount: exactMatches.length,
    snippet: extractSnippet(rawText, rawMatchStart, rawMatchLen),
  };
}

interface ScoredSearchEntry {
  result: SearchResult;
  exactCount: number;
}

function sortAndSliceScoredResults(
  entries: ScoredSearchEntry[],
  maxResults: number,
  wholeWordOnly: boolean
): SearchResult[] {
  const filtered = wholeWordOnly
    ? entries.filter((e) => e.result.matchLevel !== 4)
    : entries;

  filtered.sort((a, b) => {
    const scoreDiff = (b.result.score ?? 0) - (a.result.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const levelDiff = (a.result.matchLevel ?? 4) - (b.result.matchLevel ?? 4);
    if (levelDiff !== 0) return levelDiff;
    const exactDiff = b.exactCount - a.exactCount;
    if (exactDiff !== 0) return exactDiff;
    if (a.result.matchType !== b.result.matchType) {
      return a.result.matchType === 'filename' ? -1 : 1;
    }
    return a.result.pageNumber - b.result.pageNumber;
  });

  return filtered.slice(0, maxResults).map((e) => e.result);
}

/**
 * Streaming cursor-based search across local IndexedDB with 4-tier relevance scoring.
 * Keeps RAM footprint O(1) per page while evaluating all pages so high-relevance hits
 * always surface first.
 */
export async function searchIndexedLibrary(
  query: string,
  maxResults = 80,
  options?: {wholeWordOnly?: boolean}
): Promise<SearchResult[]> {
  const matchers = buildQuerySearchMatchers(query);
  if (!matchers) return [];
  const wholeWordOnly = !!options?.wholeWordOnly;

  const db = await openDatabase();
  const docsMap = await getAllIndexedDocuments();
  const scoredEntries: ScoredSearchEntry[] = [];

  for (const doc of docsMap.values()) {
    const titleHit = evaluateTitleMatch(doc, matchers);
    if (titleHit) {
      scoredEntries.push({
        exactCount: titleHit.matchLevel === 1 ? 1 : 0,
        result: {
          docPath: doc.relativePath,
          fileName: doc.name,
          subject: doc.subject,
          professor: doc.professor,
          pageNumber: 1,
          snippet: `Correspondance dans le nom ou classement (${doc.subject} / ${doc.professor})`,
          matchType: 'filename',
          score: titleHit.score,
          matchLevel: titleHit.matchLevel,
        },
      });
    }
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, 'readonly');
    const store = tx.objectStore(STORE_PAGES);
    const req = store.openCursor();

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }

      const record = cursor.value as StoredPageText;
      const evaluated = evaluatePageTextMatch(record.text, matchers);
      if (evaluated) {
        const doc = docsMap.get(record.docPath);
        if (doc) {
          scoredEntries.push({
            exactCount: evaluated.exactCount,
            result: {
              docPath: doc.relativePath,
              fileName: doc.name,
              subject: doc.subject,
              professor: doc.professor,
              pageNumber: record.pageNumber,
              snippet: evaluated.snippet,
              matchType: 'content',
              score: evaluated.score,
              matchLevel: evaluated.matchLevel,
            },
          });
        }
      }

      cursor.continue();
    };

    req.onerror = () => reject(req.error);
  });

  return sortAndSliceScoredResults(scoredEntries, maxResults, wholeWordOnly);
}

/**
 * Instant search across the lightweight `search_index.json` cached from Google Drive,
 * ranked by the same 4-tier relevance scoring algorithm.
 */
export function searchCloudIndexPayload(
  payload: CloudSearchIndexPayload | null,
  query: string,
  fallbackDocs: Array<{relativePath: string; name: string; subject: string; professor: string}>,
  maxResults = 80,
  options?: {wholeWordOnly?: boolean}
): SearchResult[] {
  const matchers = buildQuerySearchMatchers(query);
  if (!matchers) return [];
  const wholeWordOnly = !!options?.wholeWordOnly;

  const scoredEntries: ScoredSearchEntry[] = [];
  const docList = payload?.documents ?? [];
  const liveByPath = new Map(fallbackDocs.map((d) => [d.relativePath, d]));

  const resolveMeta = (doc: {
    relativePath: string;
    name: string;
    subject: string;
    professor: string;
  }) => {
    const live = liveByPath.get(doc.relativePath);
    return {
      relativePath: doc.relativePath,
      name: live?.name ?? doc.name,
      subject: live?.subject ?? doc.subject,
      professor: live?.professor ?? doc.professor,
    };
  };

  // 1. Filename / classification matches (uses live Drive tree even if search_index.json is missing)
  const metaSource = docList.length > 0 ? docList : fallbackDocs;
  for (const rawDoc of metaSource) {
    const doc = resolveMeta(rawDoc);
    const titleHit = evaluateTitleMatch(doc, matchers);
    if (titleHit) {
      scoredEntries.push({
        exactCount: titleHit.matchLevel === 1 ? 1 : 0,
        result: {
          docPath: doc.relativePath,
          fileName: doc.name,
          subject: doc.subject,
          professor: doc.professor,
          pageNumber: 1,
          snippet: `Correspondance dans le nom ou classement (${doc.subject} / ${doc.professor})`,
          matchType: 'filename',
          score: titleHit.score,
          matchLevel: titleHit.matchLevel,
        },
      });
    }
  }

  // 2. Full-text page matches inside cached search_index.json
  for (const rawDoc of docList) {
    const doc = resolveMeta(rawDoc);
    for (const page of rawDoc.pages) {
      const evaluated = evaluatePageTextMatch(page.t, matchers);
      if (evaluated) {
        scoredEntries.push({
          exactCount: evaluated.exactCount,
          result: {
            docPath: doc.relativePath,
            fileName: doc.name,
            subject: doc.subject,
            professor: doc.professor,
            pageNumber: page.p,
            snippet: evaluated.snippet,
            matchType: 'content',
            score: evaluated.score,
            matchLevel: evaluated.matchLevel,
          },
        });
      }
    }
  }

  return sortAndSliceScoredResults(scoredEntries, maxResults, wholeWordOnly);
}
