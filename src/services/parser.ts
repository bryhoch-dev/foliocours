import type {
  ImportQueueItem,
  SortRule,
  TitleFormatSettings,
} from '../types/course';
import {
  getCourseFileFormat,
  isSupportedCourseFile,
  stripSupportedExtension,
} from './fileFormats';

const RULES_STORAGE_KEY = 'foliocours_rules';
const TITLE_FORMAT_STORAGE_KEY = 'foliocours_title_format';

const LEGACY_SEED_RULE_IDS = new Set([
  'rule-page-genetique',
  'rule-ue4-genetique',
  'rule-ue1-biochimie',
  'rule-ue2-histologie',
  'rule-ue3-biophysique',
  'rule-ue5-anatomie',
]);

export const DEFAULT_TITLE_FORMAT_SETTINGS: TitleFormatSettings = {
  inputTemplate: '{Matière} - {Prof} - {Titre}',
  outputTemplate: '{Titre}',
  renameOnDisk: false,
};

export const DEFAULT_SORT_RULES: SortRule[] = [];

export function loadSortRules(): SortRule[] {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cleaned = parsed.filter(
      (r: SortRule) => r && typeof r.id === 'string' && !LEGACY_SEED_RULE_IDS.has(r.id)
    );
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(cleaned));
    }
    return cleaned;
  } catch {
    return [];
  }
}

export function saveSortRules(rules: SortRule[]): void {
  localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
}

export function loadTitleFormatSettings(): TitleFormatSettings {
  try {
    const raw = localStorage.getItem(TITLE_FORMAT_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(
        TITLE_FORMAT_STORAGE_KEY,
        JSON.stringify(DEFAULT_TITLE_FORMAT_SETTINGS)
      );
      return DEFAULT_TITLE_FORMAT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<TitleFormatSettings>;
    return {
      inputTemplate:
        typeof parsed.inputTemplate === 'string' && parsed.inputTemplate.trim()
          ? parsed.inputTemplate
          : DEFAULT_TITLE_FORMAT_SETTINGS.inputTemplate,
      outputTemplate:
        typeof parsed.outputTemplate === 'string' && parsed.outputTemplate.trim()
          ? parsed.outputTemplate
          : DEFAULT_TITLE_FORMAT_SETTINGS.outputTemplate,
      renameOnDisk: Boolean(parsed.renameOnDisk),
    };
  } catch {
    return DEFAULT_TITLE_FORMAT_SETTINGS;
  }
}

export function saveTitleFormatSettings(settings: TitleFormatSettings): void {
  localStorage.setItem(TITLE_FORMAT_STORAGE_KEY, JSON.stringify(settings));
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function cleanSegment(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type CanonicalTag =
  | 'subject'
  | 'professor'
  | 'title'
  | 'ignore'
  | 'type'
  | 'number'
  | 'original';

function canonicalizeTagName(rawTag: string): CanonicalTag | null {
  const norm = normalizeForMatch(rawTag);
  if (norm === 'matiere' || norm === 'ue' || norm === 'subject') return 'subject';
  if (norm === 'prof' || norm === 'professeur' || norm === 'professor') return 'professor';
  if (norm === 'titre' || norm === 'title') return 'title';
  if (norm === 'ignorer' || norm === 'ignore') return 'ignore';
  if (norm === 'type') return 'type';
  if (norm === 'numero' || norm === 'num' || norm === 'n') return 'number';
  if (norm === 'nomoriginal' || norm === 'original') return 'original';
  return null;
}

type TemplateToken =
  | {kind: 'literal'; value: string}
  | {kind: 'tag'; tag: CanonicalTag};

function tokenizeTemplate(template: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  const tagPattern = /\{([^}]+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({kind: 'literal', value: template.slice(lastIndex, match.index)});
    }
    const canonical = canonicalizeTagName(match[1]);
    if (canonical) {
      tokens.push({kind: 'tag', tag: canonical});
    } else {
      tokens.push({kind: 'literal', value: match[0]});
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < template.length) {
    tokens.push({kind: 'literal', value: template.slice(lastIndex)});
  }

  return tokens;
}

/**
 * Dynamically compiles the user-editable input template (e.g. "{Matière} - {Prof} - {Titre}"
 * or "{Matière}_{Prof}_{Titre}" or "{Ignorer}_{Matière}_{Prof}_{Titre}") into a RegExp.
 * - Escapes all separator literals precisely.
 * - Allows {Titre} (and the final tag) to capture extra separators inside the title.
 */
export function compileInputTemplateRegex(inputTemplate: string): {
  regex: RegExp | null;
  tags: CanonicalTag[];
} {
  const trimmed = inputTemplate.trim();
  if (!trimmed) return {regex: null, tags: []};

  const tokens = tokenizeTemplate(trimmed);
  const tagIndices = tokens
    .map((t, idx) => (t.kind === 'tag' ? idx : -1))
    .filter((idx) => idx >= 0);

  if (tagIndices.length === 0) return {regex: null, tags: []};

  const lastTagIdx = tagIndices[tagIndices.length - 1];
  const tags: CanonicalTag[] = [];
  let pattern = '^';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === 'literal') {
      const escaped = escapeRegExp(token.value).replace(/\s+/g, '\\s+');
      pattern += escaped;
    } else {
      tags.push(token.tag);
      const isGreedy = i === lastTagIdx || token.tag === 'title';
      pattern += isGreedy ? '(.+)' : '(.+?)';
    }
  }

  pattern += '$';

  try {
    return {regex: new RegExp(pattern, 'i'), tags};
  } catch {
    return {regex: null, tags: []};
  }
}

function renderOutputTemplate(
  outputTemplate: string,
  values: {
    subject: string;
    professor: string;
    rawTitle: string;
    originalWithoutExt: string;
  }
): string {
  const tpl = outputTemplate.trim() || '{Titre}';

  const rendered = tpl.replace(/\{([^}]+)\}/g, (fullMatch, rawTag: string) => {
    const tag = canonicalizeTagName(rawTag);
    switch (tag) {
      case 'subject':
        return values.subject;
      case 'professor':
        return values.professor;
      case 'title':
        return values.rawTitle || values.originalWithoutExt;
      case 'original':
        return values.originalWithoutExt;
      case 'type':
      case 'number':
      case 'ignore':
        return '';
      default:
        return fullMatch;
    }
  });

  const cleaned = rendered
    .replace(/\s+[-–—:]\s*$/g, '')
    .replace(/^\s*[-–—:]\s+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned || values.originalWithoutExt;
}

/**
 * Parses a course filename (.pdf, .docx, .odt) exclusively using the dynamic regex
 * generated from the user's editable TitleFormatSettings (no fixed/hardcoded rules).
 */
export function parseCourseFilename(
  fileName: string,
  titleFormat: TitleFormatSettings = DEFAULT_TITLE_FORMAT_SETTINGS,
  mimeType?: string
): {
  ueCode: string;
  subject: string;
  professor: string;
  rawTitle: string;
  displayTitle: string;
  targetName: string;
  matchedTemplate: boolean;
} {
  const detectedExt = getCourseFileFormat(fileName, mimeType) ?? 'pdf';
  const withoutExt = stripSupportedExtension(fileName);
  const hasKnownExt = /\.(pdf|docx|odt)$/i.test(fileName.trim());
  const cleanFileName = hasKnownExt ? fileName.trim() : `${withoutExt}.${detectedExt}`;

  const {regex, tags} = compileInputTemplateRegex(titleFormat.inputTemplate);
  const match = regex ? withoutExt.trim().match(regex) : null;

  let subject = '';
  let professor = '';
  let rawTitle = '';

  if (match) {
    for (let i = 0; i < tags.length; i++) {
      const captured = cleanSegment(match[i + 1] ?? '');
      const tag = tags[i];
      if (tag === 'subject' && !subject) {
        subject = captured;
      } else if (tag === 'professor' && !professor) {
        professor = captured;
      } else if (tag === 'title') {
        rawTitle = rawTitle ? `${rawTitle} ${captured}` : captured;
      }
      // 'ignore' is intentionally discarded
    }
  }

  const resolvedSubject = subject || 'Non classé';
  const resolvedProfessor = professor || 'Professeur non précisé';
  const resolvedTitle = rawTitle || cleanSegment(withoutExt);

  const displayTitle = renderOutputTemplate(titleFormat.outputTemplate, {
    subject: resolvedSubject,
    professor: resolvedProfessor,
    rawTitle: resolvedTitle,
    originalWithoutExt: withoutExt,
  });

  const sanitizedDiskBase = displayTitle
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');

  const targetName =
    titleFormat.renameOnDisk && sanitizedDiskBase
      ? `${sanitizedDiskBase}.${detectedExt}`
      : cleanFileName;

  return {
    ueCode: '',
    subject: resolvedSubject,
    professor: resolvedProfessor,
    rawTitle: resolvedTitle,
    displayTitle,
    targetName,
    matchedTemplate: Boolean(match),
  };
}

/**
 * Formats a course title synchronously for UI display (library list, tree, reader header)
 * without touching the filename on disk.
 */
export function formatCourseDisplayTitle(
  fileName: string,
  titleFormat: TitleFormatSettings,
  overrides?: {subject?: string; professor?: string; mimeType?: string}
): string {
  const parsed = parseCourseFilename(fileName, titleFormat, overrides?.mimeType);
  const withoutExt = stripSupportedExtension(fileName);

  const subject =
    overrides?.subject &&
    overrides.subject !== 'à organiser' &&
    overrides.subject !== 'Non classé'
      ? overrides.subject
      : parsed.subject;

  const professor =
    overrides?.professor &&
    overrides.professor !== 'Général' &&
    overrides.professor !== 'Racine'
      ? overrides.professor
      : parsed.professor;

  return renderOutputTemplate(titleFormat.outputTemplate, {
    subject,
    professor,
    rawTitle: parsed.rawTitle,
    originalWithoutExt: withoutExt,
  });
}

export function buildImportQueueItems(
  files: File[],
  titleFormat: TitleFormatSettings = DEFAULT_TITLE_FORMAT_SETTINGS
): ImportQueueItem[] {
  return files
    .filter((f) => isSupportedCourseFile(f))
    .map((file, index) => {
      const parsed = parseCourseFilename(file.name, titleFormat, file.type);
      return {
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        size: file.size,
        originalName: file.name,
        targetName: parsed.targetName,
        displayTitle: parsed.displayTitle,
        ueCode: '',
        subject: parsed.subject,
        professor: parsed.professor,
        status: 'pending',
      };
    });
}
