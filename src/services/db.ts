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

  const normalized = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

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

function extractSnippet(text: string, matchIndex: number, matchLength: number): string {
  const radius = 85;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + matchLength + radius);
  let slice = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) slice = `…${slice}`;
  if (end < text.length) slice = `${slice}…`;
  return slice;
}

/**
 * Streaming cursor-based search across local IndexedDB.
 * Keeps RAM footprint O(1) per page regardless of total PDF corpus size.
 */
export async function searchIndexedLibrary(
  query: string,
  maxResults = 80
): Promise<SearchResult[]> {
  const regex = buildAccentInsensitiveRegex(query);
  if (!regex) return [];

  const db = await openDatabase();
  const docsMap = await getAllIndexedDocuments();
  const results: SearchResult[] = [];

  for (const doc of docsMap.values()) {
    const composite = `${doc.name} ${doc.subject} ${doc.professor}`;
    if (regex.test(composite)) {
      results.push({
        docPath: doc.relativePath,
        fileName: doc.name,
        subject: doc.subject,
        professor: doc.professor,
        pageNumber: 1,
        snippet: `Correspondance dans le nom ou classement (${doc.subject} / ${doc.professor})`,
        matchType: 'filename',
      });
      if (results.length >= maxResults) return results;
    }
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, 'readonly');
    const store = tx.objectStore(STORE_PAGES);
    const req = store.openCursor();

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || results.length >= maxResults) {
        resolve(results);
        return;
      }

      const record = cursor.value as StoredPageText;
      const match = regex.exec(record.text);
      if (match) {
        const doc = docsMap.get(record.docPath);
        if (doc) {
          results.push({
            docPath: doc.relativePath,
            fileName: doc.name,
            subject: doc.subject,
            professor: doc.professor,
            pageNumber: record.pageNumber,
            snippet: extractSnippet(record.text, match.index, match[0].length),
            matchType: 'content',
          });
        }
      }

      cursor.continue();
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Instant search across the lightweight `search_index.json` cached from Google Drive.
 */
export function searchCloudIndexPayload(
  payload: CloudSearchIndexPayload | null,
  query: string,
  fallbackDocs: Array<{relativePath: string; name: string; subject: string; professor: string}>,
  maxResults = 80
): SearchResult[] {
  const regex = buildAccentInsensitiveRegex(query);
  if (!regex) return [];

  const results: SearchResult[] = [];
  const docList = payload?.documents ?? [];

  // 1. Filename / classification matches (uses live Drive tree even if search_index.json is missing)
  const metaSource = docList.length > 0 ? docList : fallbackDocs;
  for (const doc of metaSource) {
    const composite = `${doc.name} ${doc.subject} ${doc.professor}`;
    if (regex.test(composite)) {
      results.push({
        docPath: doc.relativePath,
        fileName: doc.name,
        subject: doc.subject,
        professor: doc.professor,
        pageNumber: 1,
        snippet: `Correspondance dans le nom ou classement (${doc.subject} / ${doc.professor})`,
        matchType: 'filename',
      });
      if (results.length >= maxResults) return results;
    }
  }

  // 2. Full-text page matches inside cached search_index.json
  for (const doc of docList) {
    for (const page of doc.pages) {
      const match = regex.exec(page.t);
      if (match) {
        results.push({
          docPath: doc.relativePath,
          fileName: doc.name,
          subject: doc.subject,
          professor: doc.professor,
          pageNumber: page.p,
          snippet: extractSnippet(page.t, match.index, match[0].length),
          matchType: 'content',
        });
        if (results.length >= maxResults) return results;
      }
    }
  }

  return results;
}
