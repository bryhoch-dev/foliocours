import JSZip from 'jszip';

export interface ExtractedTextPage {
  pageNumber: number;
  text: string;
}

export interface OdtSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  href?: string;
}

export type OdtBlock =
  | {type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; spans: OdtSpan[]}
  | {
      type: 'paragraph';
      spans: OdtSpan[];
      align?: 'left' | 'center' | 'right' | 'justify';
    }
  | {type: 'list'; ordered: boolean; items: OdtBlock[][]}
  | {type: 'table'; rows: OdtBlock[][][]}
  | {type: 'image'; objectUrl: string; alt: string};

export interface ParsedOdtDocument {
  blocks: OdtBlock[];
  objectUrls: string[];
}

interface OdtTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  parent?: string;
}

const VIRTUAL_PAGE_CHARS = 2200;

function splitTextIntoVirtualPages(fullText: string): ExtractedTextPage[] {
  const cleaned = fullText.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return [{pageNumber: 1, text: ''}];
  }

  const pages: ExtractedTextPage[] = [];
  let cursor = 0;
  let pageNum = 1;

  while (cursor < cleaned.length) {
    let end = Math.min(cleaned.length, cursor + VIRTUAL_PAGE_CHARS);
    if (end < cleaned.length) {
      const lastSpace = cleaned.lastIndexOf(' ', end);
      if (lastSpace > cursor + VIRTUAL_PAGE_CHARS * 0.6) {
        end = lastSpace;
      }
    }
    const slice = cleaned.slice(cursor, end).trim();
    if (slice) {
      pages.push({pageNumber: pageNum++, text: slice});
    }
    cursor = end;
    while (cursor < cleaned.length && cleaned[cursor] === ' ') {
      cursor++;
    }
  }

  return pages.length > 0 ? pages : [{pageNumber: 1, text: ''}];
}

function getLocalName(node: Node): string {
  return (node as Element).localName || node.nodeName.split(':').pop() || '';
}

function getAttr(el: Element, localAttrName: string): string {
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const local = attr.localName || attr.name.split(':').pop();
    if (local === localAttrName) return attr.value;
  }
  return '';
}

function sanitizeSafeExternalUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // ignore relative or malformed links
  }
  return undefined;
}

function collectDocxTextFromXml(xmlDoc: Document): string {
  const chunks: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const name = getLocalName(el);
      if (name === 't' || name === 'delText') {
        if (el.textContent) chunks.push(el.textContent);
        return;
      }
      if (name === 'tab' || name === 'br' || name === 'cr') {
        chunks.push(' ');
        return;
      }
      for (let i = 0; i < el.childNodes.length; i++) {
        walk(el.childNodes[i]);
      }
      if (name === 'p' || name === 'tr' || name === 'tc') {
        chunks.push(' ');
      }
    }
  };

  if (xmlDoc.documentElement) {
    walk(xmlDoc.documentElement);
  }
  return chunks.join('');
}

export async function extractDocxTextLowRam(
  input: File | Uint8Array
): Promise<{pageCount: number; pages: ExtractedTextPage[]}> {
  const buffer = input instanceof Uint8Array ? input : await input.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const parts: string[] = [];

  const mainEntry = zip.file('word/document.xml');
  if (mainEntry) {
    const xmlStr = await mainEntry.async('string');
    const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
    parts.push(collectDocxTextFromXml(doc));
  }

  for (const extraPath of ['word/footnotes.xml', 'word/endnotes.xml']) {
    const extra = zip.file(extraPath);
    if (extra) {
      const xmlStr = await extra.async('string');
      const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
      parts.push(collectDocxTextFromXml(doc));
    }
  }

  const pages = splitTextIntoVirtualPages(parts.join(' '));
  return {pageCount: pages.length, pages};
}

function collectOdtPlainText(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    if (node.nodeValue) out.push(node.nodeValue);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const name = getLocalName(el);

  if (name === 's') {
    const count = parseInt(getAttr(el, 'c') || '1', 10);
    out.push(' '.repeat(Number.isNaN(count) ? 1 : Math.min(20, Math.max(1, count))));
    return;
  }
  if (name === 'tab' || name === 'line-break') {
    out.push(' ');
    return;
  }

  for (let i = 0; i < el.childNodes.length; i++) {
    collectOdtPlainText(el.childNodes[i], out);
  }

  if (name === 'p' || name === 'h' || name === 'list-item' || name === 'table-cell') {
    out.push(' ');
  }
}

export async function extractOdtTextLowRam(
  input: File | Uint8Array
): Promise<{pageCount: number; pages: ExtractedTextPage[]}> {
  const buffer = input instanceof Uint8Array ? input : await input.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const contentEntry = zip.file('content.xml');
  if (!contentEntry) {
    return {pageCount: 1, pages: [{pageNumber: 1, text: ''}]};
  }

  const xmlStr = await contentEntry.async('string');
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const chunks: string[] = [];

  if (doc.documentElement) {
    collectOdtPlainText(doc.documentElement, chunks);
  }

  const pages = splitTextIntoVirtualPages(chunks.join(''));
  return {pageCount: pages.length, pages};
}

function extractStyleMapFromXml(
  xmlDoc: Document,
  targetMap: Map<string, OdtTextStyle>
): void {
  const styleElements = xmlDoc.getElementsByTagName('*');
  for (let i = 0; i < styleElements.length; i++) {
    const el = styleElements[i];
    if (getLocalName(el) !== 'style') continue;
    const styleName = getAttr(el, 'name');
    if (!styleName) continue;

    const entry: OdtTextStyle = {
      parent: getAttr(el, 'parent-style-name') || undefined,
    };

    for (let j = 0; j < el.children.length; j++) {
      const child = el.children[j];
      const childName = getLocalName(child);
      if (childName === 'text-properties') {
        const fw = getAttr(child, 'font-weight');
        const fs = getAttr(child, 'font-style');
        const ul = getAttr(child, 'text-underline-style');
        if (fw === 'bold' || fw === '700') entry.bold = true;
        if (fw === 'normal') entry.bold = false;
        if (fs === 'italic' || fs === 'oblique') entry.italic = true;
        if (fs === 'normal') entry.italic = false;
        if (ul && ul !== 'none') entry.underline = true;
        if (ul === 'none') entry.underline = false;
      } else if (childName === 'paragraph-properties') {
        const ta = getAttr(child, 'text-align');
        if (ta === 'center' || ta === 'right' || ta === 'end' || ta === 'justify' || ta === 'left' || ta === 'start') {
          entry.align =
            ta === 'end' ? 'right' : ta === 'start' ? 'left' : (ta as OdtTextStyle['align']);
        }
      }
    }

    targetMap.set(styleName, entry);
  }
}

function resolveOdtStyle(
  styleName: string,
  styleMap: Map<string, OdtTextStyle>,
  depth = 0
): OdtTextStyle {
  if (!styleName || depth > 8) return {};
  const own = styleMap.get(styleName);
  if (!own) return {};
  const base = own.parent ? resolveOdtStyle(own.parent, styleMap, depth + 1) : {};
  return {
    bold: own.bold ?? base.bold,
    italic: own.italic ?? base.italic,
    underline: own.underline ?? base.underline,
    align: own.align ?? base.align,
  };
}

function guessImageMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

export async function parseOdtToDocument(
  bytes: Uint8Array
): Promise<ParsedOdtDocument> {
  const zip = await JSZip.loadAsync(bytes);
  const contentEntry = zip.file('content.xml');
  if (!contentEntry) {
    throw new Error('Fichier ODT invalide : content.xml introuvable.');
  }

  const styleMap = new Map<string, OdtTextStyle>();
  const stylesEntry = zip.file('styles.xml');
  if (stylesEntry) {
    const stylesXml = await stylesEntry.async('string');
    const stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml');
    extractStyleMapFromXml(stylesDoc, styleMap);
  }

  const contentXml = await contentEntry.async('string');
  const contentDoc = new DOMParser().parseFromString(contentXml, 'application/xml');
  extractStyleMapFromXml(contentDoc, styleMap);

  const objectUrls: string[] = [];
  const imageCache = new Map<string, string>();

  const loadZipImageUrl = async (rawHref: string): Promise<string | null> => {
    const normalized = rawHref.replace(/^\.?\//, '');
    if (!normalized || normalized.includes('..')) return null;
    if (imageCache.has(normalized)) return imageCache.get(normalized)!;

    const entry = zip.file(normalized);
    if (!entry) return null;

    const imgBytes = await entry.async('uint8array');
    const copy = new Uint8Array(imgBytes.byteLength);
    copy.set(imgBytes);
    const url = URL.createObjectURL(
      new Blob([copy], {type: guessImageMime(normalized)})
    );
    objectUrls.push(url);
    imageCache.set(normalized, url);
    return url;
  };

  // Pre-collect embedded image URLs referenced in content.xml so rendering stays synchronous
  const imageElements = contentDoc.getElementsByTagNameNS('*', 'image');
  for (let i = 0; i < imageElements.length; i++) {
    const href = getAttr(imageElements[i], 'href');
    if (href && !href.startsWith('http:') && !href.startsWith('https:')) {
      await loadZipImageUrl(href);
    }
  }

  // Imperatively query ODT structural elements across XML namespaces via getElementsByTagNameNS('*', ...)
  const headingElements = Array.from(contentDoc.getElementsByTagNameNS('*', 'h'));
  const paragraphElements = Array.from(contentDoc.getElementsByTagNameNS('*', 'p'));
  const listElements = Array.from(contentDoc.getElementsByTagNameNS('*', 'list'));
  const tableElements = Array.from(contentDoc.getElementsByTagNameNS('*', 'table'));

  const headingSet = new Set<Element>(headingElements);
  const paraSet = new Set<Element>(paragraphElements);
  const listSet = new Set<Element>(listElements);
  const tableSet = new Set<Element>(tableElements);

  const collectSpansAndImages = (
    node: Node,
    inherited: OdtTextStyle,
    spans: OdtSpan[],
    extraImages: OdtBlock[]
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue) {
        spans.push({
          text: node.nodeValue,
          bold: inherited.bold,
          italic: inherited.italic,
          underline: inherited.underline,
        });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const name = getLocalName(el);

    if (name === 's') {
      const count = parseInt(getAttr(el, 'c') || '1', 10);
      spans.push({
        text: ' '.repeat(Number.isNaN(count) ? 1 : Math.min(20, Math.max(1, count))),
      });
      return;
    }
    if (name === 'tab') {
      spans.push({text: '\u00A0\u00A0\u00A0\u00A0'});
      return;
    }
    if (name === 'line-break') {
      spans.push({text: '\n'});
      return;
    }
    if (name === 'image') {
      const href = getAttr(el, 'href').replace(/^\.?\//, '');
      const url = imageCache.get(href);
      if (url) {
        extraImages.push({
          type: 'image',
          objectUrl: url,
          alt: href.split('/').pop() || 'Image',
        });
      }
      return;
    }

    let nextStyle = inherited;
    const styleName = getAttr(el, 'style-name');
    if (styleName) {
      const resolved = resolveOdtStyle(styleName, styleMap);
      nextStyle = {
        bold: resolved.bold ?? inherited.bold,
        italic: resolved.italic ?? inherited.italic,
        underline: resolved.underline ?? inherited.underline,
      };
    }

    if (name === 'a') {
      const safeHref = sanitizeSafeExternalUrl(getAttr(el, 'href'));
      const linkSpans: OdtSpan[] = [];
      for (let i = 0; i < el.childNodes.length; i++) {
        collectSpansAndImages(el.childNodes[i], nextStyle, linkSpans, extraImages);
      }
      for (const s of linkSpans) {
        spans.push({...s, underline: true, href: safeHref});
      }
      return;
    }

    for (let i = 0; i < el.childNodes.length; i++) {
      collectSpansAndImages(el.childNodes[i], nextStyle, spans, extraImages);
    }
  };

  const parseHeadingEl = (el: Element): OdtBlock[] => {
    const rawLvl = parseInt(getAttr(el, 'outline-level') || '1', 10);
    const level = Math.min(6, Math.max(1, Number.isNaN(rawLvl) ? 1 : rawLvl)) as
      | 1
      | 2
      | 3
      | 4
      | 5
      | 6;
    const styleName = getAttr(el, 'style-name');
    const resolved = resolveOdtStyle(styleName, styleMap);
    const spans: OdtSpan[] = [];
    const imgs: OdtBlock[] = [];
    for (let c = 0; c < el.childNodes.length; c++) {
      collectSpansAndImages(el.childNodes[c], resolved, spans, imgs);
    }
    const out: OdtBlock[] = [];
    if (spans.length > 0) out.push({type: 'heading', level, spans});
    out.push(...imgs);
    return out;
  };

  const parseParagraphEl = (el: Element): OdtBlock[] => {
    const styleName = getAttr(el, 'style-name');
    const resolved = resolveOdtStyle(styleName, styleMap);
    const spans: OdtSpan[] = [];
    const imgs: OdtBlock[] = [];
    for (let c = 0; c < el.childNodes.length; c++) {
      collectSpansAndImages(el.childNodes[c], resolved, spans, imgs);
    }
    const out: OdtBlock[] = [];
    if (spans.length > 0 || imgs.length === 0) {
      out.push({type: 'paragraph', spans, align: resolved.align});
    }
    out.push(...imgs);
    return out;
  };

  const collectTableRows = (container: Element, targetRows: Element[]) => {
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];
      const name = getLocalName(child);
      if (name === 'table-row') {
        targetRows.push(child);
      } else if (
        name === 'table-header-rows' ||
        name === 'table-rows' ||
        name === 'table-row-group'
      ) {
        collectTableRows(child, targetRows);
      }
    }
  };

  const parseBlockContainer = (container: Element): OdtBlock[] => {
    const blocks: OdtBlock[] = [];

    for (let i = 0; i < container.children.length; i++) {
      const el = container.children[i];
      const name = getLocalName(el);

      if (headingSet.has(el) || name === 'h') {
        blocks.push(...parseHeadingEl(el));
      } else if (paraSet.has(el) || name === 'p') {
        blocks.push(...parseParagraphEl(el));
      } else if (listSet.has(el) || name === 'list') {
        const items: OdtBlock[][] = [];
        for (let c = 0; c < el.children.length; c++) {
          const itemEl = el.children[c];
          const itemName = getLocalName(itemEl);
          if (itemName === 'list-item' || itemName === 'list-header') {
            items.push(parseBlockContainer(itemEl));
          }
        }
        if (items.length > 0) {
          blocks.push({type: 'list', ordered: false, items});
        }
      } else if (tableSet.has(el) || name === 'table') {
        const rowEls: Element[] = [];
        collectTableRows(el, rowEls);
        const rows: OdtBlock[][][] = [];
        for (const rowEl of rowEls) {
          const cells: OdtBlock[][] = [];
          for (let c = 0; c < rowEl.children.length; c++) {
            const cellEl = rowEl.children[c];
            if (getLocalName(cellEl) === 'table-cell') {
              cells.push(parseBlockContainer(cellEl));
            }
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length > 0) {
          blocks.push({type: 'table', rows});
        }
      } else if (name === 'image') {
        const href = getAttr(el, 'href').replace(/^\.?\//, '');
        const url = imageCache.get(href);
        if (url) {
          blocks.push({
            type: 'image',
            objectUrl: url,
            alt: href.split('/').pop() || 'Image',
          });
        }
      } else if (name !== 'sequence-decls' && name !== 'user-field-decls' && name !== 'tracked-changes') {
        blocks.push(...parseBlockContainer(el));
      }
    }

    return blocks;
  };

  const bodyTextEl =
    contentDoc.getElementsByTagNameNS('*', 'text')[0] ||
    contentDoc.getElementsByTagNameNS('*', 'body')[0] ||
    contentDoc.documentElement;

  let blocks = bodyTextEl ? parseBlockContainer(bodyTextEl) : [];

  // Fallback directly over NS collections if structured body traversal produced no blocks
  if (blocks.length === 0) {
    const fallbackBlocks: OdtBlock[] = [];
    for (const hEl of headingElements) {
      fallbackBlocks.push(...parseHeadingEl(hEl));
    }
    for (const pEl of paragraphElements) {
      fallbackBlocks.push(...parseParagraphEl(pEl));
    }
    blocks = fallbackBlocks;
  }

  return {blocks, objectUrls};
}
