import type {
  AppMode,
  CloudSearchIndexPayload,
  CourseDocument,
} from '../types/course';
import {
  getCachedCloudFile,
  getIndexedPagesByDocPaths,
  saveCachedCloudFile,
} from './db';
import {
  DOCX_MIME,
  getCourseFileFormat,
  ODT_MIME,
  PDF_MIME,
} from './fileFormats';
import {
  authenticateGoogleDrive,
  fetchCloudPdfBytes,
  getMemoryAccessToken,
  getSavedDriveClientId,
} from './googleDrive';
import {extractDocxTextLowRam, extractOdtTextLowRam} from './officeEngine';
import {
  extractPdfPagesFromBytesLowRam,
  extractPdfPagesLowRam,
} from './pdfEngine';
import type {QuizCourseExcerpt} from './gemini';

export const QUIZ_MAX_TOTAL_CHARS = 45_000;

export interface QuizContentProgress {
  current: number;
  total: number;
  fileName: string;
  phase: 'index' | 'extract';
}

export interface QuizContentCollectionResult {
  excerpts: QuizCourseExcerpt[];
  usedIndexCount: number;
  extractedOnTheFlyCount: number;
  skippedEmptyFiles: string[];
  totalChars: number;
}

function joinPagesText(pages: Array<{pageNumber?: number; p?: number; text?: string; t?: string}>): string {
  const parts: string[] = [];
  for (const page of pages) {
    const t = (page.text ?? page.t ?? '').replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  }
  return parts.join('\n').trim();
}

function distributeCharacterBudget(
  rawEntries: Array<{fileName: string; fullText: string}>,
  maxTotalChars = QUIZ_MAX_TOTAL_CHARS
): QuizCourseExcerpt[] {
  if (rawEntries.length === 0) return [];

  // Two-pass water-filling budget so short files don't waste character quota
  // needed by longer files, while capping every file fairly.
  const remaining = new Map<number, number>();
  for (let i = 0; i < rawEntries.length; i++) {
    remaining.set(i, rawEntries[i].fullText.length);
  }

  const allocated = new Array<number>(rawEntries.length).fill(0);
  let pool = maxTotalChars;
  let activeIndices = rawEntries.map((_, idx) => idx);

  while (pool > 0 && activeIndices.length > 0) {
    const share = Math.floor(pool / activeIndices.length);
    if (share === 0) {
      for (const idx of activeIndices) {
        if (pool <= 0) break;
        const left = remaining.get(idx) ?? 0;
        if (left > 0) {
          allocated[idx] += 1;
          remaining.set(idx, left - 1);
          pool -= 1;
        }
      }
      break;
    }

    let consumedThisRound = 0;
    const nextActive: number[] = [];

    for (const idx of activeIndices) {
      const left = remaining.get(idx) ?? 0;
      const take = Math.min(left, share);
      allocated[idx] += take;
      remaining.set(idx, left - take);
      consumedThisRound += take;
      if (left - take > 0) {
        nextActive.push(idx);
      }
    }

    pool -= consumedThisRound;
    activeIndices = nextActive;
    if (consumedThisRound === 0) break;
  }

  return rawEntries.map((entry, idx) => {
    const limit = allocated[idx];
    if (entry.fullText.length <= limit) {
      return {fileName: entry.fileName, text: entry.fullText};
    }
    const truncated = entry.fullText.slice(0, Math.max(0, limit - 1)).trimEnd();
    return {fileName: entry.fileName, text: `${truncated}…`};
  });
}

export async function collectFolderContentForQuiz(
  selectedDocs: CourseDocument[],
  options: {
    mode: AppMode;
    cloudIndex: CloudSearchIndexPayload | null;
    onProgress?: (progress: QuizContentProgress) => void;
    signal?: AbortSignal;
  }
): Promise<QuizContentCollectionResult> {
  const {mode, cloudIndex, onProgress, signal} = options;
  if (selectedDocs.length === 0) {
    return {
      excerpts: [],
      usedIndexCount: 0,
      extractedOnTheFlyCount: 0,
      skippedEmptyFiles: [],
      totalChars: 0,
    };
  }

  const localPagesMap =
    mode === 'local'
      ? await getIndexedPagesByDocPaths(selectedDocs.map((d) => d.relativePath))
      : new Map<string, Array<{pageNumber: number; text: string}>>();

  const cloudDocByPath = new Map(
    (cloudIndex?.documents ?? []).map((d) => [d.relativePath, d])
  );

  const rawEntries: Array<{fileName: string; fullText: string}> = [];
  const skippedEmptyFiles: string[] = [];
  let usedIndexCount = 0;
  let extractedOnTheFlyCount = 0;
  let cachedDriveToken: string | null = null;

  const ensureDriveToken = async (): Promise<string> => {
    if (cachedDriveToken) return cachedDriveToken;
    const mem = getMemoryAccessToken();
    if (mem) {
      cachedDriveToken = mem;
      return mem;
    }
    const clientId = getSavedDriveClientId().trim();
    if (!clientId) {
      throw new Error('Client ID Google Drive requis pour télécharger les cours non indexés.');
    }
    cachedDriveToken = await authenticateGoogleDrive(clientId);
    return cachedDriveToken;
  };

  for (let i = 0; i < selectedDocs.length; i++) {
    if (signal?.aborted) {
      throw new DOMException('Opération annulée.', 'AbortError');
    }

    const doc = selectedDocs[i];
    let text = '';

    // 1. Check already-indexed text first (IndexedDB for Local, search_index.json for Cloud)
    if (mode === 'local') {
      const indexedPages = localPagesMap.get(doc.relativePath);
      if (indexedPages && indexedPages.length > 0) {
        text = joinPagesText(indexedPages);
      }
    } else {
      const cloudIndexed = cloudDocByPath.get(doc.relativePath);
      if (cloudIndexed && cloudIndexed.pages.length > 0) {
        text = joinPagesText(cloudIndexed.pages);
      }
    }

    if (text) {
      onProgress?.({
        current: i + 1,
        total: selectedDocs.length,
        fileName: doc.name,
        phase: 'index',
      });
      rawEntries.push({fileName: doc.name, fullText: text});
      usedIndexCount++;
      continue;
    }

    // 2. Fallback: extract text on-the-fly for files not yet indexed
    onProgress?.({
      current: i + 1,
      total: selectedDocs.length,
      fileName: doc.name,
      phase: 'extract',
    });

    try {
      const format = doc.format ?? getCourseFileFormat(doc.name) ?? 'pdf';
      if (doc.source === 'cloud' && doc.driveFileId) {
        let bytes: Uint8Array | null = null;
        const cached = await getCachedCloudFile(doc.driveFileId).catch(() => null);
        if (cached) {
          bytes = new Uint8Array(await cached.blob.arrayBuffer());
        } else {
          const token = await ensureDriveToken();
          bytes = await fetchCloudPdfBytes(token, doc.driveFileId, signal);
          const mimeType =
            format === 'docx' ? DOCX_MIME : format === 'odt' ? ODT_MIME : PDF_MIME;
          const cleanCopy = new Uint8Array(bytes.byteLength);
          cleanCopy.set(bytes);
          await saveCachedCloudFile({
            driveFileId: doc.driveFileId,
            relativePath: doc.relativePath,
            name: doc.name,
            modifiedTime: doc.driveModifiedTime || new Date().toISOString(),
            blob: new Blob([cleanCopy.buffer], {type: mimeType}),
            cachedAt: Date.now(),
          }).catch(() => {});
        }

        if (bytes) {
          const extracted =
            format === 'docx'
              ? await extractDocxTextLowRam(bytes)
              : format === 'odt'
              ? await extractOdtTextLowRam(bytes)
              : await extractPdfPagesFromBytesLowRam(bytes);
          text = joinPagesText(extracted.pages);
        }
      } else if (doc.handle) {
        const file = await doc.handle.getFile();
        const extracted =
          format === 'docx'
            ? await extractDocxTextLowRam(file)
            : format === 'odt'
            ? await extractOdtTextLowRam(file)
            : await extractPdfPagesLowRam(file);
        text = joinPagesText(extracted.pages);
      }

      if (text) {
        rawEntries.push({fileName: doc.name, fullText: text});
        extractedOnTheFlyCount++;
      } else {
        skippedEmptyFiles.push(doc.name);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      console.warn(`Extraction ignorée pour ${doc.relativePath}:`, err);
      skippedEmptyFiles.push(doc.name);
    }
  }

  const excerpts = distributeCharacterBudget(rawEntries, QUIZ_MAX_TOTAL_CHARS);
  const totalChars = excerpts.reduce((sum, e) => sum + e.text.length, 0);

  return {
    excerpts,
    usedIndexCount,
    extractedOnTheFlyCount,
    skippedEmptyFiles,
    totalChars,
  };
}
