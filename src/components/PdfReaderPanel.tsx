import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {PDFDocumentProxy, RenderTask} from 'pdfjs-dist';
import {renderAsync as renderDocxAsync} from 'docx-preview';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileSearch,
  FolderOpen,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  CourseDocument,
  CourseFileFormat,
  SortRule,
  TitleFormatSettings,
} from '../types/course';
import {
  DEFAULT_TITLE_FORMAT_SETTINGS,
  formatCourseDisplayTitle,
} from '../services/parser';
import {
  DOCX_MIME,
  getCourseFileFormat,
  ODT_MIME,
  PDF_MIME,
} from '../services/fileFormats';
import {
  destroyPdfDocument,
  loadPdfDocumentFromBytes,
  loadPdfDocumentFromFile,
} from '../services/pdfEngine';
import {
  extractDocxTextLowRam,
  parseOdtToDocument,
  type OdtBlock,
  type OdtSpan,
  type ParsedOdtDocument,
} from '../services/officeEngine';
import {
  authenticateGoogleDrive,
  fetchCloudPdfBytes,
  getMemoryAccessToken,
  getSavedDriveClientId,
} from '../services/googleDrive';
import {FileFormatBadge} from './FileFormatBadge';

interface PdfReaderPanelProps {
  document: CourseDocument | null;
  targetPage: number;
  jumpKey?: number;
  highlightQuery: string;
  titleFormat?: TitleFormatSettings;
  rules?: SortRule[];
  onPageChange: (page: number) => void;
  onCloseMobile?: () => void;
  onNotify?: (text: string, tone?: 'info' | 'error') => void;
}

interface PageDimension {
  width: number;
  height: number;
}

type PendingZoomAnchor =
  | {
      type: 'pointer';
      clientX: number;
      clientY: number;
      oldScale: number;
      newScale: number;
    }
  | {
      type: 'page';
      pageNumber: number;
      offsetRatio: number;
    }
  | {
      type: 'ratio';
      scrollRatio: number;
    };

interface PdfPageSlotProps {
  pageNumber: number;
  unscaledWidth: number;
  unscaledHeight: number;
  scale: number;
  shouldRender: boolean;
  pdf: PDFDocumentProxy | null;
  registerSlot: (pageNumber: number, el: HTMLDivElement | null) => void;
}

const PdfPageSlot: React.FC<PdfPageSlotProps> = React.memo(
  ({
    pageNumber,
    unscaledWidth,
    unscaledHeight,
    scale,
    shouldRender,
    pdf,
    registerSlot,
  }) => {
    const slotRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const renderTaskRef = useRef<RenderTask | null>(null);
    const renderedScaleRef = useRef<number | null>(null);
    const [hasDrawn, setHasDrawn] = useState(false);

    const setRefs = useCallback(
      (el: HTMLDivElement | null) => {
        slotRef.current = el;
        registerSlot(pageNumber, el);
      },
      [pageNumber, registerSlot]
    );

    useLayoutEffect(() => {
      const slot = slotRef.current;
      if (!slot) return;
      slot.style.width = `${Math.max(1, Math.floor(unscaledWidth * scale))}px`;
      slot.style.height = `${Math.max(1, Math.floor(unscaledHeight * scale))}px`;
    }, [unscaledWidth, unscaledHeight, scale]);

    useEffect(() => {
      let cancelled = false;
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      const clearCanvasBuffer = () => {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // ignore
          }
          renderTaskRef.current = null;
        }
        if (canvasRef.current) {
          canvasRef.current.width = 0;
          canvasRef.current.height = 0;
        }
        renderedScaleRef.current = null;
        setHasDrawn(false);
      };

      if (!shouldRender || !pdf) {
        clearCanvasBuffer();
        return;
      }

      const executeRender = async () => {
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // ignore
          }
          renderTaskRef.current = null;
        }

        const page = await pdf.getPage(pageNumber);
        if (cancelled) {
          page.cleanup();
          return;
        }

        const isRezoom =
          renderedScaleRef.current !== null && renderedScaleRef.current !== scale;
        let offscreen: HTMLCanvasElement | null = null;

        try {
          const viewport = page.getViewport({scale});
          const outputScale = Math.min(window.devicePixelRatio || 1, 2);
          const targetWidth = Math.max(1, Math.floor(viewport.width * outputScale));
          const targetHeight = Math.max(1, Math.floor(viewport.height * outputScale));

          const targetCanvas = isRezoom ? window.document.createElement('canvas') : canvas;
          if (isRezoom) {
            offscreen = targetCanvas;
          }

          targetCanvas.width = targetWidth;
          targetCanvas.height = targetHeight;

          const ctx = targetCanvas.getContext('2d');
          if (!ctx) return;

          const transform =
            outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

          const task = page.render({
            canvas: targetCanvas,
            canvasContext: ctx,
            transform,
            viewport,
          });
          renderTaskRef.current = task;
          await task.promise;

          if (cancelled) return;

          if (isRezoom && offscreen && canvasRef.current) {
            const visibleCtx = canvasRef.current.getContext('2d');
            if (visibleCtx) {
              canvasRef.current.width = targetWidth;
              canvasRef.current.height = targetHeight;
              visibleCtx.drawImage(offscreen, 0, 0);
            }
          }

          renderedScaleRef.current = scale;
          setHasDrawn(true);
        } catch (err: unknown) {
          const name = (err as {name?: string})?.name;
          if (name !== 'RenderingCancelledException' && !cancelled) {
            console.error(`Erreur rendu page ${pageNumber}:`, err);
          }
        } finally {
          if (offscreen) {
            offscreen.width = 0;
            offscreen.height = 0;
          }
          page.cleanup();
        }
      };

      const delay =
        renderedScaleRef.current !== null && renderedScaleRef.current !== scale ? 70 : 0;
      if (delay > 0) {
        debounceTimer = setTimeout(() => {
          void executeRender();
        }, delay);
      } else {
        void executeRender();
      }

      return () => {
        cancelled = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // ignore
          }
          renderTaskRef.current = null;
        }
      };
    }, [shouldRender, pdf, pageNumber, scale]);

    useEffect(() => {
      return () => {
        if (canvasRef.current) {
          canvasRef.current.width = 0;
          canvasRef.current.height = 0;
        }
      };
    }, []);

    return (
      <div
        ref={setRefs}
        data-page={pageNumber}
        className="relative mx-auto shrink-0 rounded-sm shadow-2xl border border-slate-800/90 bg-white overflow-hidden select-none"
      >
        {shouldRender ? (
          <canvas ref={canvasRef} className="block w-full h-full" />
        ) : null}
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-400 font-mono text-xs pointer-events-none">
            Page {pageNumber}
          </div>
        )}
      </div>
    );
  }
);

PdfPageSlot.displayName = 'PdfPageSlot';

function renderOdtSpans(spans: OdtSpan[]): React.ReactNode {
  return spans.map((span, idx) => {
    const classNames = [
      span.bold ? 'font-bold' : '',
      span.italic ? 'italic' : '',
      span.underline ? 'underline underline-offset-2' : '',
    ]
      .filter(Boolean)
      .join(' ');

    if (span.href) {
      return (
        <a
          key={idx}
          href={span.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-sky-700 hover:text-sky-900 ${classNames}`}
        >
          {span.text}
        </a>
      );
    }

    if (span.text === '\n') {
      return <br key={idx} />;
    }

    return classNames ? (
      <span key={idx} className={classNames}>
        {span.text}
      </span>
    ) : (
      <React.Fragment key={idx}>{span.text}</React.Fragment>
    );
  });
}

function renderOdtBlock(block: OdtBlock, key: React.Key): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      const sizeClasses: Record<number, string> = {
        1: 'text-2xl font-bold text-slate-900 mt-5 mb-2.5 pb-1 border-b border-slate-200',
        2: 'text-xl font-bold text-slate-900 mt-4 mb-2',
        3: 'text-lg font-semibold text-slate-800 mt-3.5 mb-1.5',
        4: 'text-base font-semibold text-slate-800 mt-3 mb-1',
        5: 'text-sm font-semibold text-slate-800 mt-2.5 mb-1',
        6: 'text-xs font-semibold uppercase tracking-wide text-slate-700 mt-2 mb-1',
      };
      return (
        <div key={key} role="heading" aria-level={block.level} className={sizeClasses[block.level]}>
          {renderOdtSpans(block.spans)}
        </div>
      );
    }
    case 'paragraph': {
      const alignClass =
        block.align === 'center'
          ? 'text-center'
          : block.align === 'right'
          ? 'text-right'
          : block.align === 'justify'
          ? 'text-justify'
          : 'text-left';
      return (
        <p key={key} className={`text-[14.5px] leading-relaxed text-slate-800 mb-2.5 min-h-[1em] ${alignClass}`}>
          {renderOdtSpans(block.spans)}
        </p>
      );
    }
    case 'list':
      return (
        <ul key={key} className="list-disc pl-6 mb-3 space-y-1 text-[14.5px] text-slate-800">
          {block.items.map((itemBlocks, idx) => (
            <li key={idx}>
              {itemBlocks.map((child, childIdx) => renderOdtBlock(child, childIdx))}
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div key={key} className="my-4 overflow-x-auto">
          <table className="w-full border-collapse border border-slate-300 text-xs text-slate-800">
            <tbody>
              {block.rows.map((row, rIdx) => (
                <tr key={rIdx} className={rIdx === 0 ? 'bg-slate-100 font-medium' : ''}>
                  {row.map((cellBlocks, cIdx) => (
                    <td key={cIdx} className="border border-slate-300 px-2.5 py-1.5 align-top">
                      {cellBlocks.map((child, childIdx) => renderOdtBlock(child, childIdx))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'image':
      return (
        <div key={key} className="my-3 flex justify-center">
          <img
            src={block.objectUrl}
            alt={block.alt}
            className="max-w-full h-auto rounded border border-slate-200"
          />
        </div>
      );
  }
}

export const PdfReaderPanel: React.FC<PdfReaderPanelProps> = ({
  document: courseDoc,
  targetPage,
  jumpKey,
  highlightQuery,
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
  rules = [],
  onPageChange,
  onCloseMobile,
  onNotify,
}) => {
  const readerRootRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfInstanceRef = useRef<PDFDocumentProxy | null>(null);
  const pageSlotRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const visibleMetricsRef = useRef<Map<number, number>>(new Map());

  // Office reader refs (.docx / .odt zoom + cleanup)
  const officeSpacerRef = useRef<HTMLDivElement>(null);
  const officeInnerRef = useRef<HTMLDivElement>(null);
  const docxBodyRef = useRef<HTMLDivElement>(null);
  const docxStyleRef = useRef<HTMLDivElement>(null);
  const odtObjectUrlsRef = useRef<string[]>([]);
  const officeNaturalWidthRef = useRef<number>(794);

  // Smooth zoom & scroll synchronization refs
  const [scale, setScale] = useState(1.0);
  const scaleRef = useRef(1.0);
  const pendingZoomAnchorRef = useRef<PendingZoomAnchor | null>(null);
  const lastScrollReportedPageRef = useRef<number>(targetPage);
  const suppressObserverUntilRef = useRef<number>(0);
  const lastHandledJumpRef = useRef<{docPath: string; jumpKey: number} | null>(null);

  // Fullscreen & copy feedback state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const usedNativeFullscreenRef = useRef(false);
  const [copiedPath, setCopiedPath] = useState(false);

  // Touch gesture tracking (pinch zoom + double-tap)
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);
  const lastTapRef = useRef<number>(0);

  // Document & format state
  const docFormat: CourseFileFormat = courseDoc
    ? courseDoc.format ?? getCourseFileFormat(courseDoc.name) ?? 'pdf'
    : 'pdf';

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageDimensions, setPageDimensions] = useState<PageDimension[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [renderRange, setRenderRange] = useState<[number, number]>([1, 2]);
  const [pageInput, setPageInput] = useState(String(targetPage));

  const [docxBuffer, setDocxBuffer] = useState<ArrayBuffer | null>(null);
  const [docxFallbackText, setDocxFallbackText] = useState<string | null>(null);
  const [docxReady, setDocxReady] = useState(false);
  const [odtDoc, setOdtDoc] = useState<ParsedOdtDocument | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registerSlot = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    if (el) {
      pageSlotRefs.current.set(pageNum, el);
    } else {
      pageSlotRefs.current.delete(pageNum);
    }
  }, []);

  const hasLoadedContent =
    docFormat === 'pdf' ? numPages > 0 : docFormat === 'docx' ? docxReady : !!odtDoc;

  // Scroll cleanly to a specific page (PDF) or proportional position (DOCX/ODT)
  const scrollToPage = useCallback(
    (page: number, behavior: ScrollBehavior = 'smooth') => {
      if (docFormat !== 'pdf' || numPages <= 0) return;
      const clamped = Math.max(1, Math.min(numPages, page));
      const container = containerRef.current;
      const slotEl = pageSlotRefs.current.get(clamped);

      suppressObserverUntilRef.current =
        Date.now() + (behavior === 'smooth' ? 450 : 140);
      setCurrentPage(clamped);
      setPageInput(String(clamped));
      lastScrollReportedPageRef.current = clamped;
      onPageChange(clamped);
      setRenderRange([
        Math.max(1, clamped - 1),
        Math.min(numPages, clamped + 1),
      ]);

      if (container && slotEl) {
        const top = Math.max(0, slotEl.offsetTop - 16);
        container.scrollTo({top, behavior});
      }
    },
    [docFormat, numPages, onPageChange]
  );

  // Sync office zoom spacer & transform smoothly without JSX inline styles
  const updateOfficeScaleLayout = useCallback(() => {
    const spacer = officeSpacerRef.current;
    const inner = officeInnerRef.current;
    if (!spacer || !inner) return;
    const natW = Math.max(320, inner.scrollWidth || 794);
    const natH = Math.max(320, inner.scrollHeight || 1123);
    officeNaturalWidthRef.current = natW;
    const s = scaleRef.current;
    spacer.style.width = `${Math.ceil(natW * s)}px`;
    spacer.style.height = `${Math.ceil(natH * s)}px`;
    inner.style.transform = `scale(${s})`;
  }, []);

  // Apply zoom while capturing anchor so scrolling stays anchored to cursor or active page
  const applyZoom = useCallback(
    (nextScaleRaw: number, pointer?: {clientX: number; clientY: number}) => {
      const nextScale = Number(Math.max(0.4, Math.min(3.0, nextScaleRaw)).toFixed(2));
      const oldScale = scaleRef.current;
      if (nextScale === oldScale) return;

      const container = containerRef.current;
      if (container) {
        if (pointer) {
          pendingZoomAnchorRef.current = {
            type: 'pointer',
            clientX: pointer.clientX,
            clientY: pointer.clientY,
            oldScale,
            newScale: nextScale,
          };
        } else if (docFormat === 'pdf') {
          const slotEl = pageSlotRefs.current.get(currentPage);
          const offsetRatio = slotEl
            ? (container.scrollTop - slotEl.offsetTop) /
              Math.max(1, slotEl.offsetHeight)
            : 0;
          pendingZoomAnchorRef.current = {
            type: 'page',
            pageNumber: currentPage,
            offsetRatio,
          };
        } else {
          const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
          pendingZoomAnchorRef.current = {
            type: 'ratio',
            scrollRatio: container.scrollTop / maxScroll,
          };
        }
      }

      scaleRef.current = nextScale;
      setScale(nextScale);
    },
    [currentPage, docFormat]
  );

  // Restore scroll anchor synchronously right after page/office sizes update on zoom
  useLayoutEffect(() => {
    if (docFormat !== 'pdf') {
      updateOfficeScaleLayout();
    }

    const anchor = pendingZoomAnchorRef.current;
    const container = containerRef.current;
    if (!anchor || !container) return;
    pendingZoomAnchorRef.current = null;

    if (anchor.type === 'pointer') {
      const rect = container.getBoundingClientRect();
      const relX = anchor.clientX - rect.left;
      const relY = anchor.clientY - rect.top;
      const ratio = anchor.newScale / anchor.oldScale;
      const contentX = container.scrollLeft + relX;
      const contentY = container.scrollTop + relY;
      container.scrollLeft = Math.max(0, contentX * ratio - relX);
      container.scrollTop = Math.max(0, contentY * ratio - relY);
    } else if (anchor.type === 'page') {
      const slotEl = pageSlotRefs.current.get(anchor.pageNumber);
      if (slotEl) {
        container.scrollTop = Math.max(
          0,
          slotEl.offsetTop + anchor.offsetRatio * slotEl.offsetHeight
        );
      }
    } else if (anchor.type === 'ratio') {
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = Math.max(0, anchor.scrollRatio * maxScroll);
    }
  }, [scale, docFormat, docxReady, odtDoc, updateOfficeScaleLayout]);

  // Observe natural DOCX/ODT size changes (e.g. images finishing decode)
  useEffect(() => {
    if (docFormat === 'pdf' || !hasLoadedContent) return;
    const inner = officeInnerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      updateOfficeScaleLayout();
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [docFormat, hasLoadedContent, updateOfficeScaleLayout]);

  // Helper to obtain raw bytes/File for any document (local handle or Drive API)
  const fetchCourseDocumentBytes = useCallback(
    async (doc: CourseDocument, signal: AbortSignal): Promise<{bytes: Uint8Array; file?: File}> => {
      if (doc.source === 'cloud' && doc.driveFileId) {
        let token = getMemoryAccessToken();
        if (!token) {
          token = await authenticateGoogleDrive(getSavedDriveClientId());
        }
        try {
          const bytes = await fetchCloudPdfBytes(token, doc.driveFileId, signal);
          return {bytes};
        } catch (fetchErr) {
          if (
            !signal.aborted &&
            !getMemoryAccessToken() &&
            fetchErr instanceof Error &&
            fetchErr.message.includes('Session Google expirée')
          ) {
            token = await authenticateGoogleDrive(getSavedDriveClientId());
            const bytes = await fetchCloudPdfBytes(token, doc.driveFileId, signal);
            return {bytes};
          }
          throw fetchErr;
        }
      }
      if (doc.handle) {
        const file = await doc.handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        return {bytes, file};
      }
      throw new Error('Source du document introuvable.');
    },
    []
  );

  // Load document on demand (PDF / DOCX / ODT) and release RAM immediately on close
  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    const cleanupPrevious = async () => {
      if (pdfInstanceRef.current) {
        await destroyPdfDocument(pdfInstanceRef.current);
        pdfInstanceRef.current = null;
      }
      for (const url of odtObjectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      odtObjectUrlsRef.current = [];
      if (docxBodyRef.current) docxBodyRef.current.innerHTML = '';
      if (docxStyleRef.current) docxStyleRef.current.innerHTML = '';
    };

    async function load() {
      await cleanupPrevious();

      visibleMetricsRef.current.clear();
      setPdfDoc(null);
      setNumPages(0);
      setPageDimensions([]);
      setDocxBuffer(null);
      setDocxFallbackText(null);
      setDocxReady(false);
      setOdtDoc(null);
      setError(null);
      setCopiedPath(false);
      lastHandledJumpRef.current = null;

      if (!courseDoc) return;

      const format = courseDoc.format ?? getCourseFileFormat(courseDoc.name) ?? 'pdf';
      setIsLoading(true);

      try {
        if (format === 'pdf') {
          let pdf: PDFDocumentProxy;
          if (courseDoc.source === 'cloud' && courseDoc.driveFileId) {
            const {bytes} = await fetchCourseDocumentBytes(courseDoc, abortController.signal);
            if (cancelled) return;
            pdf = await loadPdfDocumentFromBytes(bytes);
          } else if (courseDoc.handle) {
            const file = await courseDoc.handle.getFile();
            if (cancelled) return;
            pdf = await loadPdfDocumentFromFile(file);
          } else {
            throw new Error('Source PDF introuvable.');
          }

          if (cancelled) {
            await destroyPdfDocument(pdf);
            return;
          }

          const page1 = await pdf.getPage(1);
          const vp1 = page1.getViewport({scale: 1});
          page1.cleanup();

          if (cancelled) {
            await destroyPdfDocument(pdf);
            return;
          }

          const container = containerRef.current;
          const padding = window.innerWidth < 768 ? 20 : 48;
          const available = Math.max(260, (container?.clientWidth || 720) - padding);
          const initialScale = Number(
            Math.min(1.4, Math.max(0.45, available / vp1.width)).toFixed(2)
          );

          const initialDims: PageDimension[] = Array.from(
            {length: pdf.numPages},
            () => ({width: vp1.width, height: vp1.height})
          );

          const startPage = Math.max(1, Math.min(pdf.numPages, targetPage));

          pdfInstanceRef.current = pdf;
          scaleRef.current = initialScale;
          lastScrollReportedPageRef.current = startPage;
          setScale(initialScale);
          setPageDimensions(initialDims);
          setPdfDoc(pdf);
          setNumPages(pdf.numPages);
          setCurrentPage(startPage);
          setPageInput(String(startPage));
          setRenderRange([
            Math.max(1, startPage - 1),
            Math.min(pdf.numPages, startPage + 1),
          ]);

          if (pdf.numPages > 1) {
            void (async () => {
              const updates = new Map<number, PageDimension>();
              for (let p = 2; p <= pdf.numPages; p++) {
                if (cancelled) return;
                try {
                  const pg = await pdf.getPage(p);
                  const vp = pg.getViewport({scale: 1});
                  pg.cleanup();
                  if (
                    Math.abs(vp.width - vp1.width) > 1 ||
                    Math.abs(vp.height - vp1.height) > 1
                  ) {
                    updates.set(p - 1, {width: vp.width, height: vp.height});
                  }
                } catch {
                  // ignore individual page metadata error
                }
                if (p % 25 === 0) {
                  await new Promise((r) => setTimeout(r, 0));
                }
              }
              if (!cancelled && updates.size > 0) {
                setPageDimensions((prev) => {
                  if (prev.length !== pdf.numPages) return prev;
                  const next = [...prev];
                  updates.forEach((dim, idx) => {
                    next[idx] = dim;
                  });
                  return next;
                });
              }
            })();
          }
        } else if (format === 'docx') {
          let arrayBuffer: ArrayBuffer;
          if (courseDoc.source === 'cloud' && courseDoc.driveFileId) {
            const {bytes} = await fetchCourseDocumentBytes(courseDoc, abortController.signal);
            if (cancelled) return;
            arrayBuffer = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength
            ) as ArrayBuffer;
          } else if (courseDoc.handle) {
            const file = await courseDoc.handle.getFile();
            if (cancelled) return;
            arrayBuffer = await file.arrayBuffer();
          } else {
            throw new Error('Source DOCX introuvable.');
          }
          if (cancelled) return;

          const container = containerRef.current;
          const padding = window.innerWidth < 768 ? 20 : 48;
          const available = Math.max(260, (container?.clientWidth || 720) - padding);
          const initialScale = Number(
            Math.min(1.15, Math.max(0.4, available / 820)).toFixed(2)
          );
          scaleRef.current = initialScale;
          setScale(initialScale);
          setDocxFallbackText(null);
          setDocxBuffer(arrayBuffer);
        } else if (format === 'odt') {
          const {bytes} = await fetchCourseDocumentBytes(courseDoc, abortController.signal);
          if (cancelled) return;

          const parsed = await parseOdtToDocument(bytes);
          if (cancelled) {
            for (const url of parsed.objectUrls) URL.revokeObjectURL(url);
            return;
          }

          odtObjectUrlsRef.current = parsed.objectUrls;

          const container = containerRef.current;
          const padding = window.innerWidth < 768 ? 20 : 48;
          const available = Math.max(260, (container?.clientWidth || 720) - padding);
          const initialScale = Number(
            Math.min(1.15, Math.max(0.4, available / 794)).toFixed(2)
          );
          scaleRef.current = initialScale;
          setScale(initialScale);
          setOdtDoc(parsed);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(
            err instanceof Error
              ? err.message
              : 'Impossible de charger ce document.'
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      abortController.abort();
      void cleanupPrevious();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseDoc]);

  // Render DOCX only after loading ends and the DOM container refs are guaranteed mounted
  useEffect(() => {
    if (docFormat !== 'docx' || !docxBuffer || isLoading || error) return;

    let cancelled = false;
    let rafId = 0;

    const runRender = async () => {
      const bodyEl = docxBodyRef.current;
      const styleEl = docxStyleRef.current;
      if (!bodyEl || !styleEl || cancelled) return;

      bodyEl.innerHTML = '';
      styleEl.innerHTML = '';

      try {
        await renderDocxAsync(docxBuffer, bodyEl, styleEl, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
        });
        if (cancelled) return;

        const hasVisibleContent =
          bodyEl.children.length > 0 || (bodyEl.textContent?.trim().length ?? 0) > 0;
        if (!hasVisibleContent) {
          throw new Error('Contenu DOCX rendu vide.');
        }

        setDocxFallbackText(null);
        setDocxReady(true);
        requestAnimationFrame(() => {
          if (!cancelled) updateOfficeScaleLayout();
        });
      } catch (docxErr) {
        console.warn('docx-preview a échoué, bascule en texte brut:', docxErr);
        if (cancelled) return;
        try {
          const extracted = await extractDocxTextLowRam(new Uint8Array(docxBuffer));
          if (cancelled) return;
          const plain = extracted.pages.map((p) => p.text).join('\n\n').trim();
          setDocxFallbackText(
            plain || 'Ce document .docx ne contient aucun texte lisible.'
          );
          setDocxReady(true);
        } catch {
          if (cancelled) return;
          setDocxFallbackText(
            'Impossible d’afficher la mise en page de ce fichier .docx. Utilisez « Ouvrir dans l’appli par défaut ».'
          );
          setDocxReady(true);
        }
      }
    };

    rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      if (!docxBodyRef.current || !docxStyleRef.current) {
        rafId = requestAnimationFrame(() => {
          if (!cancelled) void runRender();
        });
        return;
      }
      void runRender();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [docFormat, docxBuffer, isLoading, error, updateOfficeScaleLayout]);

  // Handle initial page placement and subsequent search jumps cleanly for PDFs
  useEffect(() => {
    if (!courseDoc || docFormat !== 'pdf' || !pdfDoc || numPages === 0 || pageDimensions.length === 0) {
      return;
    }

    const currentDocPath = courseDoc.relativePath;
    const currentJump = jumpKey ?? 0;
    const prev = lastHandledJumpRef.current;

    if (!prev || prev.docPath !== currentDocPath) {
      lastHandledJumpRef.current = {docPath: currentDocPath, jumpKey: currentJump};
      const clamped = Math.max(1, Math.min(numPages, targetPage));
      const raf = requestAnimationFrame(() => {
        const container = containerRef.current;
        const slotEl = pageSlotRefs.current.get(clamped);
        if (container && slotEl) {
          suppressObserverUntilRef.current = Date.now() + 180;
          container.scrollTop = Math.max(0, slotEl.offsetTop - 16);
        }
      });
      return () => cancelAnimationFrame(raf);
    }

    if (prev.jumpKey !== currentJump) {
      lastHandledJumpRef.current = {docPath: currentDocPath, jumpKey: currentJump};
      scrollToPage(targetPage, 'smooth');
      return;
    }

    if (targetPage !== lastScrollReportedPageRef.current) {
      scrollToPage(targetPage, 'smooth');
    }
  }, [courseDoc, docFormat, pdfDoc, numPages, pageDimensions.length, targetPage, jumpKey, scrollToPage]);

  // IntersectionObserver for PDF continuous scroll & RAM-saving 1-page buffer
  useEffect(() => {
    const container = containerRef.current;
    if (!container || docFormat !== 'pdf' || numPages === 0) return;

    visibleMetricsRef.current.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageAttr = entry.target.getAttribute('data-page');
          if (!pageAttr) continue;
          const pageNum = parseInt(pageAttr, 10);
          if (Number.isNaN(pageNum)) continue;

          if (entry.isIntersecting && entry.intersectionRect.height > 0) {
            visibleMetricsRef.current.set(pageNum, entry.intersectionRect.height);
          } else {
            visibleMetricsRef.current.delete(pageNum);
          }
        }

        if (visibleMetricsRef.current.size === 0) return;

        let minVisible = numPages;
        let maxVisible = 1;
        let dominantPage = 1;
        let maxVisibleHeight = -1;

        visibleMetricsRef.current.forEach((visHeight, pageNum) => {
          if (pageNum < minVisible) minVisible = pageNum;
          if (pageNum > maxVisible) maxVisible = pageNum;
          if (visHeight > maxVisibleHeight) {
            maxVisibleHeight = visHeight;
            dominantPage = pageNum;
          }
        });

        const nextStart = Math.max(1, minVisible - 1);
        const nextEnd = Math.min(numPages, maxVisible + 1);
        setRenderRange((prev) =>
          prev[0] === nextStart && prev[1] === nextEnd ? prev : [nextStart, nextEnd]
        );

        if (Date.now() >= suppressObserverUntilRef.current) {
          setCurrentPage((prev) => (prev === dominantPage ? prev : dominantPage));
          setPageInput(String(dominantPage));
          if (lastScrollReportedPageRef.current !== dominantPage) {
            lastScrollReportedPageRef.current = dominantPage;
            onPageChange(dominantPage);
          }
        }
      },
      {
        root: container,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    for (let p = 1; p <= numPages; p++) {
      const el = pageSlotRefs.current.get(p);
      if (el) observer.observe(el);
    }

    return () => {
      observer.disconnect();
    };
  }, [docFormat, numPages, onPageChange]);

  // Ctrl + wheel zoom across PDF, DOCX, and ODT
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasLoadedContent) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const clampedDelta = Math.max(-160, Math.min(160, e.deltaY));
      const factor = Math.exp(-clampedDelta * 0.0028);
      applyZoom(scaleRef.current * factor, {
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };

    container.addEventListener('wheel', handleWheel, {passive: false});
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [hasLoadedContent, applyZoom]);

  // Fullscreen lifecycle: native requestFullscreen + Escape fallback
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!window.document.fullscreenElement && usedNativeFullscreenRef.current) {
        usedNativeFullscreenRef.current = false;
        setIsFullscreen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen && !window.document.fullscreenElement) {
        e.preventDefault();
        setIsFullscreen(false);
      }
    };

    window.document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!courseDoc && isFullscreen) {
      if (window.document.fullscreenElement === readerRootRef.current) {
        void window.document.exitFullscreen?.().catch(() => {});
      }
      usedNativeFullscreenRef.current = false;
      setIsFullscreen(false);
    }
  }, [courseDoc, isFullscreen]);

  const handleToggleFullscreen = async () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      const el = readerRootRef.current;
      if (el?.requestFullscreen) {
        try {
          await el.requestFullscreen();
          usedNativeFullscreenRef.current = true;
        } catch {
          usedNativeFullscreenRef.current = false;
        }
      }
    } else {
      if (window.document.fullscreenElement === readerRootRef.current) {
        try {
          await window.document.exitFullscreen();
        } catch {
          // ignore
        }
      }
      usedNativeFullscreenRef.current = false;
      setIsFullscreen(false);
    }
  };

  const handleFitWidth = () => {
    const container = containerRef.current;
    if (!container) return;
    const padding = window.innerWidth < 768 ? 20 : 48;
    const available = Math.max(260, container.clientWidth - padding);

    if (docFormat === 'pdf') {
      const dim = pageDimensions[currentPage - 1] || pageDimensions[0];
      if (!dim) return;
      applyZoom(available / dim.width);
    } else {
      const natW = officeNaturalWidthRef.current || 794;
      applyZoom(available / natW);
    }
  };

  // Mode PC Local: open/download file with explicit official MIME type & exact file.name, then revoke RAM
  const handleOpenInDefaultApp = async () => {
    if (!courseDoc || !courseDoc.handle) return;
    try {
      const file = await courseDoc.handle.getFile();
      const lowerName = file.name.toLowerCase();
      const forcedMime = lowerName.endsWith('.docx')
        ? DOCX_MIME
        : lowerName.endsWith('.odt')
        ? ODT_MIME
        : lowerName.endsWith('.pdf')
        ? PDF_MIME
        : docFormat === 'docx'
        ? DOCX_MIME
        : docFormat === 'odt'
        ? ODT_MIME
        : PDF_MIME;

      const buffer = await file.arrayBuffer();
      const blob = new Blob([buffer], {type: forcedMime});
      const blobUrl = URL.createObjectURL(blob);

      const link = window.document.createElement('a');
      link.href = blobUrl;
      link.download = file.name;
      link.style.display = 'none';
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);

      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 250);
    } catch (err) {
      console.error('Ouverture externe impossible:', err);
      onNotify?.('Impossible d’ouvrir le fichier local.', 'error');
    }
  };

  const handleCopyRelativePath = async () => {
    if (!courseDoc) return;
    try {
      await navigator.clipboard.writeText(courseDoc.relativePath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
      onNotify?.(`Chemin copié : ${courseDoc.relativePath}`);
    } catch {
      onNotify?.('Impossible de copier le chemin dans le presse-papiers.', 'error');
    }
  };

  const commitPageInput = () => {
    const parsed = parseInt(pageInput, 10);
    if (!Number.isNaN(parsed) && numPages > 0) {
      scrollToPage(parsed, 'smooth');
    } else {
      setPageInput(String(currentPage));
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartScaleRef.current = scaleRef.current;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapRef.current < 260) {
        if (scaleRef.current > 1.25) {
          handleFitWidth();
        } else {
          applyZoom(1.6, {
            clientX: e.touches[0].clientX,
            clientY: e.touches[0].clientY,
          });
        }
      }
      lastTapRef.current = now;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchStartDistRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchStartDistRef.current;
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      applyZoom(pinchStartScaleRef.current * ratio, {
        clientX: centerX,
        clientY: centerY,
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) {
      pinchStartDistRef.current = null;
    }
  };

  const driveFolderUrl = (() => {
    const id = courseDoc?.driveParentFolderId?.trim();
    if (id && /^[A-Za-z0-9_-]+$/.test(id)) {
      return `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
    }
    return 'https://drive.google.com/drive/my-drive';
  })();

  if (!courseDoc) {
    return (
      <main className="flex-1 bg-[#070B14] flex items-center justify-center p-8 min-w-0">
        <div className="max-w-md text-center space-y-4">
          <div className="w-12 h-12 rounded-xl border border-slate-800 bg-[#0F172A] flex items-center justify-center mx-auto">
            <FileSearch className="w-6 h-6 text-amber-400" />
          </div>
          <h1 className="font-display text-lg font-semibold text-slate-100">
            Lecteur de cours intégré
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Sélectionnez un fichier (<span className="text-slate-200 font-mono">.pdf</span>,{' '}
            <span className="text-slate-200 font-mono">.docx</span> ou{' '}
            <span className="text-slate-200 font-mono">.odt</span>) ou lancez une recherche plein texte avec{' '}
            <kbd className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-slate-200">
              Ctrl + K
            </kbd>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      ref={readerRootRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 bg-[#070B14] flex flex-col min-w-0 min-h-0'
          : 'flex-1 bg-[#070B14] flex flex-col min-w-0 min-h-0'
      }
    >
      {/* Reader Toolbar */}
      <div className="min-h-12 shrink-0 border-b border-slate-800/90 bg-[#0F172A] px-2.5 md:px-4 py-1.5 flex items-center justify-between gap-2 md:gap-3 pt-safe">
        <div className="min-w-0 flex items-center gap-2 text-xs">
          {onCloseMobile && !isFullscreen && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Retour"
              className="md:hidden min-h-[40px] min-w-[40px] -ml-1 inline-flex items-center justify-center rounded-lg text-amber-400 hover:bg-slate-800 shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <FileFormatBadge fileName={courseDoc.name} format={docFormat} />
          <div className="min-w-0">
            <span
              className="font-semibold text-slate-100 truncate block max-w-[130px] sm:max-w-xs lg:max-w-sm"
              title={courseDoc.name}
            >
              {formatCourseDisplayTitle(courseDoc.name, titleFormat, rules, {
                subject: courseDoc.subject,
                professor: courseDoc.professor,
              })}
            </span>
            <span className="text-slate-400 truncate hidden lg:inline text-[11px]">
              {courseDoc.subject} / {courseDoc.professor}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 shrink-0 flex-wrap justify-end">
          {/* Page navigation (for PDF) */}
          {docFormat === 'pdf' && (
            <div className="flex items-center gap-0.5 md:gap-1 rounded-md border border-slate-800 bg-[#0B1120] px-1 py-0.5">
              <button
                type="button"
                onClick={() => scrollToPage(currentPage - 1, 'smooth')}
                disabled={currentPage <= 1 || numPages === 0}
                aria-label="Page précédente"
                className="min-h-[34px] min-w-[28px] flex items-center justify-center text-slate-400 hover:text-slate-100 disabled:opacity-35 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={commitPageInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitPageInput();
                    e.currentTarget.blur();
                  }
                }}
                aria-label="Numéro de page"
                className="w-8 md:w-10 bg-transparent text-center font-mono tabular-nums text-xs text-slate-100 focus:outline-none"
              />
              <span className="font-mono tabular-nums text-[11px] text-slate-500 pr-1">
                /{numPages || '—'}
              </span>
              <button
                type="button"
                onClick={() => scrollToPage(currentPage + 1, 'smooth')}
                disabled={currentPage >= numPages || numPages === 0}
                aria-label="Page suivante"
                className="min-h-[34px] min-w-[28px] flex items-center justify-center text-slate-400 hover:text-slate-100 disabled:opacity-35 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Zoom controls (- / % / + / Ajuster à la largeur) */}
          <div className="flex items-center gap-0.5 rounded-md border border-slate-800 bg-[#0B1120] px-1 py-0.5">
            <button
              type="button"
              onClick={() => applyZoom(scaleRef.current - 0.15)}
              title="Zoom arrière"
              aria-label="Zoom arrière"
              className="min-h-[34px] min-w-[28px] flex items-center justify-center text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="hidden sm:inline font-mono tabular-nums text-xs text-slate-300 w-10 text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => applyZoom(scaleRef.current + 0.15)}
              title="Zoom avant"
              aria-label="Zoom avant"
              className="min-h-[34px] min-w-[28px] flex items-center justify-center text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleFitWidth}
              disabled={!hasLoadedContent}
              title="Ajuster à la largeur"
              aria-label="Ajuster à la largeur"
              className="min-h-[34px] inline-flex items-center gap-1 px-1.5 text-slate-400 hover:text-amber-300 disabled:opacity-35 cursor-pointer"
            >
              <MoveHorizontal className="w-3.5 h-3.5" />
              <span className="hidden xl:inline text-[11px] font-medium">Largeur</span>
            </button>
          </div>

          {/* Fullscreen toggle */}
          <button
            type="button"
            onClick={() => void handleToggleFullscreen()}
            title={isFullscreen ? 'Quitter le plein écran (Échap)' : 'Plein écran'}
            aria-label={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
            className={`min-h-[36px] min-w-[36px] inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors shrink-0 cursor-pointer ${
              isFullscreen
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:border-amber-500/50 hover:text-amber-300'
            }`}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
            <span className="hidden 2xl:inline">
              {isFullscreen ? 'Réduire' : 'Plein écran'}
            </span>
          </button>

          {/* Cloud Mode: Open Parent Folder on Google Drive */}
          {courseDoc.source === 'cloud' ? (
            <a
              href={driveFolderUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Ouvrir le dossier parent sur Google Drive"
              className="min-h-[36px] inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-300 transition-colors whitespace-nowrap shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">Ouvrir le dossier Drive</span>
            </a>
          ) : (
            /* Local Mode: Open in default app + Copy relative path */
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleOpenInDefaultApp}
                disabled={isLoading || !!error}
                title="Ouvrir dans l'application par défaut (Word, LibreOffice, lecteur système)"
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="hidden sm:inline">Ouvrir dans l’appli par défaut</span>
              </button>

              <button
                type="button"
                onClick={() => void handleCopyRelativePath()}
                title={`Copier le chemin relatif : ${courseDoc.relativePath}`}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-1 text-xs text-slate-300 hover:border-amber-500/50 hover:text-amber-200 transition-colors shrink-0 cursor-pointer"
              >
                {copiedPath ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <span className="hidden 2xl:inline font-mono text-[11px] max-w-[180px] truncate">
                  {copiedPath ? 'Chemin copié' : courseDoc.relativePath}
                </span>
                <span className="2xl:hidden hidden md:inline text-[11px]">
                  {copiedPath ? 'Copié' : 'Copier le chemin'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Highlight reminder bar when opened from full-text search */}
      {highlightQuery.trim() && (
        <div className="px-4 py-1.5 border-b border-amber-500/20 bg-amber-500/10 text-xs text-amber-200 flex items-center justify-between">
          <span>
            Résultat pour « <strong className="font-semibold">{highlightQuery}</strong> »
            {docFormat === 'pdf' ? ` · Page ${targetPage}` : ''}
          </span>
        </div>
      )}

      {/* Viewport */}
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`relative flex-1 overflow-auto p-3 md:p-6 flex flex-col gap-4 touch-pan-x touch-pan-y ${
          docFormat === 'pdf' ? '' : 'bg-[#DCE1E8]'
        }`}
      >
        {isLoading ? (
          <div className="my-auto text-center space-y-2 px-4">
            <p
              className={`text-xs ${
                docFormat === 'pdf' ? 'text-slate-300' : 'text-slate-700 font-medium'
              }`}
            >
              {courseDoc.source === 'cloud'
                ? 'Récupération à la demande depuis Google Drive…'
                : 'Chargement du document…'}
            </p>
            <p
              className={`text-[11px] ${
                docFormat === 'pdf' ? 'text-slate-500' : 'text-slate-600'
              }`}
            >
              Aucun stockage permanent utilisé sur l’appareil.
            </p>
          </div>
        ) : error ? (
          <div className="my-auto mx-auto max-w-md rounded-lg border border-rose-500/40 bg-rose-950/90 p-4 text-xs text-rose-200">
            {error}
          </div>
        ) : docFormat === 'pdf' ? (
          pageDimensions.map((dim, idx) => {
            const pageNum = idx + 1;
            const shouldRender =
              pageNum >= renderRange[0] && pageNum <= renderRange[1];
            return (
              <PdfPageSlot
                key={`${courseDoc.relativePath}-${pageNum}`}
                pageNumber={pageNum}
                unscaledWidth={dim.width}
                unscaledHeight={dim.height}
                scale={scale}
                shouldRender={shouldRender}
                pdf={pdfDoc}
                registerSlot={registerSlot}
              />
            );
          })
        ) : (
          /* A4 Light-Gray Paper Viewport for .docx and .odt */
          <div ref={officeSpacerRef} className="relative mx-auto shrink-0">
            <div ref={officeInnerRef} className="origin-top-left inline-block">
              {docFormat === 'docx' ? (
                docxFallbackText !== null ? (
                  <article className="w-[794px] min-h-[1123px] bg-white text-slate-900 px-12 py-12 md:px-14 md:py-14 shadow-2xl border border-slate-300/90 space-y-4">
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Affichage simplifié en texte brut (la mise en page Word complète n’a pas pu être rendue).
                    </div>
                    {docxFallbackText.split(/\n{2,}/).map((para, idx) => (
                      <p key={idx} className="text-[14.5px] leading-relaxed text-slate-800 whitespace-pre-wrap">
                        {para}
                      </p>
                    ))}
                  </article>
                ) : (
                  <div className="docx-reader-host">
                    <div ref={docxStyleRef} />
                    <div ref={docxBodyRef} />
                  </div>
                )
              ) : odtDoc ? (
                <article className="w-[794px] min-h-[1123px] bg-white text-slate-900 px-12 py-12 md:px-14 md:py-14 shadow-2xl border border-slate-300/90">
                  {odtDoc.blocks.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">
                      Document texte vide.
                    </p>
                  ) : (
                    odtDoc.blocks.map((block, i) => renderOdtBlock(block, i))
                  )}
                </article>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </main>
  );
};
