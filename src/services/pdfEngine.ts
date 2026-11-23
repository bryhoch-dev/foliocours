import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {CourseDocument, IndexingProgress} from '../types/course';
import {getAllIndexedDocuments, saveDocumentWithPages} from './db';
import {getCourseFileFormat} from './fileFormats';
import {extractDocxTextLowRam, extractOdtTextLowRam} from './officeEngine';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export {pdfjsLib};

export async function loadPdfDocumentFromBytes(bytes: Uint8Array) {
  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    disableAutoFetch: true,
    disableStream: true,
  });
  return loadingTask.promise;
}

export async function loadPdfDocumentFromFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return loadPdfDocumentFromBytes(bytes);
}

export async function destroyPdfDocument(
  pdf: pdfjsLib.PDFDocumentProxy | null | undefined
): Promise<void> {
  if (!pdf) return;
  try {
    await pdf.cleanup(false);
  } catch {
    // ignore cleanup error
  }
  try {
    await pdf.loadingTask.destroy();
  } catch {
    // ignore destroy error
  }
}

async function extractPagesFromPdfProxy(
  pdf: pdfjsLib.PDFDocumentProxy
): Promise<{pageCount: number; pages: Array<{pageNumber: number; text: string}>}> {
  const pages: Array<{pageNumber: number; text: string}> = [];

  try {
    const pageCount = pdf.numPages;
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      try {
        const textContent = await page.getTextContent();
        const parts: string[] = [];
        for (const item of textContent.items) {
          if ('str' in item && typeof item.str === 'string') {
            parts.push(item.str);
          }
        }
        const normalized = parts.join(' ').replace(/\s+/g, ' ').trim();
        pages.push({pageNumber: pageNum, text: normalized});
      } finally {
        page.cleanup();
      }
    }
    return {pageCount, pages};
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * Extracts text from a PDF page-by-page using a Uint8Array transfer to the worker
 * and aggressively releases each page and document handle to keep RAM minimal.
 */
export async function extractPdfPagesLowRam(
  file: File
): Promise<{pageCount: number; pages: Array<{pageNumber: number; text: string}>}> {
  const pdf = await loadPdfDocumentFromFile(file);
  return extractPagesFromPdfProxy(pdf);
}

export async function extractPdfPagesFromBytesLowRam(
  bytes: Uint8Array
): Promise<{pageCount: number; pages: Array<{pageNumber: number; text: string}>}> {
  const pdf = await loadPdfDocumentFromBytes(bytes);
  return extractPagesFromPdfProxy(pdf);
}

/**
 * Sequentially indexes only new or modified documents into IndexedDB.
 * Processes one document at a time so RAM usage stays bounded.
 */
export async function indexDocumentsQueue(
  documents: CourseDocument[],
  options: {
    forceReindex?: boolean;
    onProgress?: (progress: IndexingProgress) => void;
    onDocumentIndexed?: (relativePath: string, pageCount: number, indexedAt: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<number> {
  const {forceReindex = false, onProgress, onDocumentIndexed, signal} = options;
  const existingMap = await getAllIndexedDocuments();

  const queue = documents.filter((doc) => {
    if (!doc.handle) return false;
    if (forceReindex) return true;
    const cached = existingMap.get(doc.relativePath);
    if (!cached) return true;
    return cached.lastModified !== doc.lastModified || cached.size !== doc.size;
  });

  if (queue.length === 0) {
    onProgress?.({active: false, current: 0, total: 0, currentFileName: ''});
    return 0;
  }

  let indexedCount = 0;

  for (let i = 0; i < queue.length; i++) {
    if (signal?.aborted) break;
    const doc = queue[i];
    if (!doc.handle) continue;

    onProgress?.({
      active: true,
      current: i + 1,
      total: queue.length,
      currentFileName: doc.name,
    });

    try {
      const file = await doc.handle.getFile();
      const format = doc.format ?? getCourseFileFormat(doc.name, file.type) ?? 'pdf';
      const {pageCount, pages} =
        format === 'docx'
          ? await extractDocxTextLowRam(file)
          : format === 'odt'
          ? await extractOdtTextLowRam(file)
          : await extractPdfPagesLowRam(file);
      const indexedAt = Date.now();

      await saveDocumentWithPages(
        {
          relativePath: doc.relativePath,
          name: doc.name,
          subject: doc.subject,
          professor: doc.professor,
          size: file.size,
          lastModified: file.lastModified,
          pageCount,
          indexedAt,
        },
        pages
      );

      indexedCount++;
      onDocumentIndexed?.(doc.relativePath, pageCount, indexedAt);
    } catch (err) {
      console.warn(`Indexation ignorée pour ${doc.relativePath}:`, err);
    }

    // Yield briefly to keep UI responsive between files
    await new Promise((r) => setTimeout(r, 15));
  }

  onProgress?.({
    active: false,
    current: queue.length,
    total: queue.length,
    currentFileName: '',
  });

  return indexedCount;
}
