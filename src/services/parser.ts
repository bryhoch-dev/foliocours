import type {
  ImportQueueItem,
  RuleMatchTarget,
  SeparatorPreset,
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

export const DEFAULT_TITLE_FORMAT_SETTINGS: TitleFormatSettings = {
  inputTemplate: '{Matière}_{Prof}_{Titre}',
  separatorPreset: '_',
  customSeparator: '',
  outputTemplate: '{Titre}',
  renameOnDisk: false,
};

export const DEFAULT_SORT_RULES: SortRule[] = [
  {
    id: 'rule-page-genetique',
    pattern: 'Page',
    matchTarget: 'any',
    subject: 'Génétique',
    professor: 'Pr. Page',
    enabled: true,
  },
  {
    id: 'rule-ue4-genetique',
    pattern: 'UE4',
    matchTarget: 'ue',
    subject: 'Génétique',
    professor: '',
    enabled: true,
  },
  {
    id: 'rule-ue1-biochimie',
    pattern: 'UE1',
    matchTarget: 'ue',
    subject: 'Biochimie & Biologie Moléculaire',
    professor: '',
    enabled: true,
  },
  {
    id: 'rule-ue2-histologie',
    pattern: 'UE2',
    matchTarget: 'ue',
    subject: 'Biologie Cellulaire & Histologie',
    professor: '',
    enabled: true,
  },
  {
    id: 'rule-ue3-biophysique',
    pattern: 'UE3',
    matchTarget: 'ue',
    subject: 'Biophysique & Physiologie',
    professor: '',
    enabled: true,
  },
  {
    id: 'rule-ue5-anatomie',
    pattern: 'UE5',
    matchTarget: 'ue',
    subject: 'Anatomie',
    professor: '',
    enabled: true,
  },
];

export function loadSortRules(): SortRule[] {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(DEFAULT_SORT_RULES));
      return DEFAULT_SORT_RULES;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return DEFAULT_SORT_RULES;
  } catch {
    return DEFAULT_SORT_RULES;
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
    const validPreset: SeparatorPreset =
      parsed.separatorPreset === '_' ||
      parsed.separatorPreset === '-' ||
      parsed.separatorPreset === ' - ' ||
      parsed.separatorPreset === 'custom'
        ? parsed.separatorPreset
        : DEFAULT_TITLE_FORMAT_SETTINGS.separatorPreset;
    return {
      inputTemplate:
        typeof parsed.inputTemplate === 'string' && parsed.inputTemplate.trim()
          ? parsed.inputTemplate
          : DEFAULT_TITLE_FORMAT_SETTINGS.inputTemplate,
      separatorPreset: validPreset,
      customSeparator:
        typeof parsed.customSeparator === 'string' ? parsed.customSeparator : '',
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

export function getActiveSeparator(settings: TitleFormatSettings): string {
  if (settings.separatorPreset === 'custom') {
    return settings.customSeparator || '_';
  }
  return settings.separatorPreset;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function cleanSegment(value: string): string {
  return value.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type CanonicalTag = 'subject' | 'professor' | 'type' | 'number' | 'title' | 'original';

function canonicalizeTagName(rawTag: string): CanonicalTag | null {
  const norm = normalizeForMatch(rawTag);
  if (norm === 'matiere' || norm === 'ue' || norm === 'subject') return 'subject';
  if (norm === 'prof' || norm === 'professeur' || norm === 'professor') return 'professor';
  if (norm === 'type') return 'type';
  if (norm === 'numero' || norm === 'num' || norm === 'n') return 'number';
  if (norm === 'titre' || norm === 'title') return 'title';
  if (norm === 'nomoriginal' || norm === 'original') return 'original';
  return null;
}

function extractInputTemplateTags(inputTemplate: string): CanonicalTag[] {
  const matches = inputTemplate.match(/\{([^}]+)\}/g);
  if (!matches) return ['subject', 'professor', 'title'];
  const tags: CanonicalTag[] = [];
  for (const token of matches) {
    const inner = token.slice(1, -1);
    const canonical = canonicalizeTagName(inner);
    if (canonical && canonical !== 'original') {
      tags.push(canonical);
    }
  }
  return tags.length > 0 ? tags : ['subject', 'professor', 'title'];
}

function splitByConfiguredSeparator(
  withoutExt: string,
  settings: TitleFormatSettings
): string[] {
  const sep = getActiveSeparator(settings);

  const trySplit = (pattern: RegExp): string[] =>
    withoutExt
      .split(pattern)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

  if (sep === '_') {
    const byUnderscore = trySplit(/_+/);
    if (byUnderscore.length >= 2) return byUnderscore;
    const byDash = trySplit(/\s*[-–—]\s*/);
    if (byDash.length >= 2) return byDash;
    return byUnderscore;
  }

  if (sep === '-' || sep === ' - ') {
    const byDash = trySplit(sep === ' - ' ? /\s+[-–—]\s+/ : /\s*[-–—]\s*/);
    if (byDash.length >= 2) return byDash;
    const byAnyDash = trySplit(/\s*[-–—]\s*/);
    if (byAnyDash.length >= 2) return byAnyDash;
    const byUnderscore = trySplit(/_+/);
    if (byUnderscore.length >= 2) return byUnderscore;
    return byDash;
  }

  const customRegex = new RegExp(`\\s*${escapeRegExp(sep)}\\s*`);
  const byCustom = trySplit(customRegex);
  if (byCustom.length >= 2) return byCustom;

  const byDash = trySplit(/\s*[-–—]\s*/);
  if (byDash.length >= 2) return byDash;
  const byUnderscore = trySplit(/_+/);
  if (byUnderscore.length >= 2) return byUnderscore;
  return byCustom;
}

function extractTypeAndNumberFromSegment(rawTitle: string): {
  courseType: string;
  courseNumber: string;
  strippedTitle: string;
} {
  const cleaned = cleanSegment(rawTitle);
  if (!cleaned) {
    return {courseType: '', courseNumber: '', strippedTitle: ''};
  }

  // Match patterns like "CM 4 - Les Glucides", "Ronéo 3", "TD n°2 : Anatomie", "Cours 12"
  const typeNumRegex =
    /^(cm|td|tp|ed|ron[eé]o|cours|chapitre|chap\.?|s[eé]ance|fiche|partiel|annale|sujet)\s*(?:n°|no|num[eé]ro|#)?\s*(\d+[a-z]?)\b[\s:–—-]*(.*)$/i;
  const m = cleaned.match(typeNumRegex);
  if (m) {
    const rawType = m[1].replace(/\.$/, '');
    const normalizedType =
      rawType.length <= 3 ? rawType.toUpperCase() : rawType[0].toUpperCase() + rawType.slice(1);
    const num = m[2];
    const rest = cleanSegment(m[3] || '');
    return {
      courseType: normalizedType,
      courseNumber: num,
      strippedTitle: rest,
    };
  }

  // Match type only without explicit number, e.g. "Ronéo Introduction"
  const typeOnlyRegex =
    /^(cm|td|tp|ed|ron[eé]o|cours|chapitre|s[eé]ance|fiche|partiel|annale)\b[\s:–—-]+(.*)$/i;
  const m2 = cleaned.match(typeOnlyRegex);
  if (m2) {
    const rawType = m2[1];
    const normalizedType =
      rawType.length <= 3 ? rawType.toUpperCase() : rawType[0].toUpperCase() + rawType.slice(1);
    return {
      courseType: normalizedType,
      courseNumber: '',
      strippedTitle: cleanSegment(m2[2] || ''),
    };
  }

  // Match leading number only, e.g. "03 Les Lipides" or "3 - Les Lipides"
  const numOnlyRegex = /^(\d+[a-z]?)\b[\s:–—-]+(.+)$/i;
  const m3 = cleaned.match(numOnlyRegex);
  if (m3) {
    return {
      courseType: '',
      courseNumber: m3[1],
      strippedTitle: cleanSegment(m3[2]),
    };
  }

  return {courseType: '', courseNumber: '', strippedTitle: cleaned};
}

function renderOutputTemplate(
  outputTemplate: string,
  values: {
    subject: string;
    professor: string;
    courseType: string;
    courseNumber: string;
    rawTitle: string;
    strippedTitle: string;
    originalWithoutExt: string;
  }
): string {
  const tpl = outputTemplate.trim() || '{Titre}';
  const usesTypeOrNumber =
    /\{type\}|\{numero\}|\{num\}|\{n\}/i.test(
      tpl.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    );

  const titleValue = usesTypeOrNumber
    ? values.strippedTitle || values.rawTitle || values.originalWithoutExt
    : values.rawTitle || values.strippedTitle || values.originalWithoutExt;

  let rendered = tpl.replace(/\{([^}]+)\}/g, (fullMatch, rawTag: string) => {
    const tag = canonicalizeTagName(rawTag);
    switch (tag) {
      case 'subject':
        return values.subject;
      case 'professor':
        return values.professor;
      case 'type':
        return values.courseType;
      case 'number':
        return values.courseNumber;
      case 'title':
        return titleValue;
      case 'original':
        return values.originalWithoutExt;
      default:
        return fullMatch;
    }
  });

  // Clean orphaned separators when optional tags like {Type} or {Numéro} are empty
  rendered = rendered
    .replace(/\s+[-–—:]\s*$/g, '')
    .replace(/^\s*[-–—:]\s+/g, '')
    .replace(/\s*[-–—]\s*[-–—]\s*/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return rendered || values.originalWithoutExt;
}

function matchesRule(
  rule: SortRule,
  fullName: string,
  ueSegment: string,
  profSegment: string
): boolean {
  if (!rule.enabled || !rule.pattern.trim()) return false;
  const needle = normalizeForMatch(rule.pattern);

  const checkTarget = (target: RuleMatchTarget): boolean => {
    switch (target) {
      case 'ue':
        return normalizeForMatch(ueSegment).includes(needle);
      case 'professor':
        return normalizeForMatch(profSegment).includes(needle);
      case 'filename':
        return normalizeForMatch(fullName).includes(needle);
      case 'any':
      default:
        return (
          normalizeForMatch(fullName).includes(needle) ||
          normalizeForMatch(ueSegment).includes(needle) ||
          normalizeForMatch(profSegment).includes(needle)
        );
    }
  };

  return checkTarget(rule.matchTarget);
}

/**
 * Parses a course filename (.pdf, .docx, .odt) dynamically using the configured
 * TitleFormatSettings (input template + separator) and SortRules, and formats
 * the display title & optional disk target name.
 */
export function parseCourseFilename(
  fileName: string,
  rules: SortRule[],
  mimeType?: string,
  titleFormat: TitleFormatSettings = DEFAULT_TITLE_FORMAT_SETTINGS
): {
  ueCode: string;
  subject: string;
  professor: string;
  courseType: string;
  courseNumber: string;
  rawTitle: string;
  displayTitle: string;
  targetName: string;
  matchedRulePattern?: string;
} {
  const detectedExt = getCourseFileFormat(fileName, mimeType) ?? 'pdf';
  const withoutExt = stripSupportedExtension(fileName);
  const hasKnownExt = /\.(pdf|docx|odt)$/i.test(fileName.trim());
  const cleanFileName = hasKnownExt ? fileName.trim() : `${withoutExt}.${detectedExt}`;

  const parts = splitByConfiguredSeparator(withoutExt, titleFormat);
  const templateTags = extractInputTemplateTags(titleFormat.inputTemplate);

  let rawSubject = '';
  let rawProfessor = '';
  let capturedType = '';
  let capturedNumber = '';
  let capturedTitle = '';

  if (parts.length >= 2) {
    for (let i = 0; i < templateTags.length && i < parts.length; i++) {
      const tag = templateTags[i];
      const isLastTag = i === templateTags.length - 1;
      const value = isLastTag
        ? cleanSegment(parts.slice(i).join(' '))
        : cleanSegment(parts[i]);

      if (tag === 'subject' && !rawSubject) rawSubject = value;
      else if (tag === 'professor' && !rawProfessor) rawProfessor = value;
      else if (tag === 'type' && !capturedType) capturedType = value;
      else if (tag === 'number' && !capturedNumber) capturedNumber = value;
      else if (tag === 'title') {
        capturedTitle = capturedTitle ? `${capturedTitle} ${value}` : value;
      }
    }

    // If template had fewer tags than parts and last tag wasn't title, keep unused tail in title
    if (!capturedTitle && parts.length > templateTags.length) {
      capturedTitle = cleanSegment(parts.slice(templateTags.length).join(' '));
    }
  } else {
    // Single-segment heuristic fallback: check leading UE token
    const ueMatch = withoutExt.match(/^(UE\s*\d+[A-Za-z]?)\b[\s_-]*(.*)$/i);
    if (ueMatch) {
      rawSubject = cleanSegment(ueMatch[1]).toUpperCase();
      const remainder = cleanSegment(ueMatch[2]);
      const roneoSplit = remainder.split(/\b(?:ron[eé]o|cours|chapitre|cm|td|tp)\b/i);
      if (roneoSplit[0]?.trim()) {
        rawProfessor = cleanSegment(roneoSplit[0]);
      }
      capturedTitle = remainder;
    } else {
      capturedTitle = cleanSegment(withoutExt);
    }
  }

  let ueCode = '';
  if (/^ue\s*\d+[a-z0-9]*$/i.test(rawSubject)) {
    ueCode = rawSubject.replace(/\s+/g, '').toUpperCase();
    rawSubject = ueCode;
  } else {
    const inlineUe = withoutExt.match(/\b(UE\s*\d+[A-Za-z]?)\b/i);
    if (inlineUe) {
      ueCode = inlineUe[1].replace(/\s+/g, '').toUpperCase();
    }
  }

  let resolvedSubject = rawSubject || ueCode || 'Non classé';
  let resolvedProfessor = rawProfessor || 'Professeur non précisé';
  let matchedRulePattern: string | undefined;

  // Apply matching rules in priority order; merge subject/professor overrides cleanly
  for (const rule of rules) {
    if (matchesRule(rule, withoutExt, rawSubject || ueCode, rawProfessor)) {
      if (rule.subject.trim()) {
        resolvedSubject = rule.subject.trim();
      }
      if (rule.professor.trim()) {
        resolvedProfessor = rule.professor.trim();
      }
      matchedRulePattern = matchedRulePattern ?? rule.pattern;
    }
  }

  const rawTitleSegment =
    capturedTitle ||
    cleanSegment(
      parts.length >= 3 ? parts.slice(2).join(' ') : parts[parts.length - 1] || withoutExt
    ) ||
    cleanSegment(withoutExt);

  const detectedFromTitle = extractTypeAndNumberFromSegment(rawTitleSegment);
  const courseType = capturedType || detectedFromTitle.courseType;
  const courseNumber = capturedNumber || detectedFromTitle.courseNumber;
  const strippedTitle =
    capturedType || capturedNumber ? rawTitleSegment : detectedFromTitle.strippedTitle;

  const displayTitle = renderOutputTemplate(titleFormat.outputTemplate, {
    subject: resolvedSubject,
    professor: resolvedProfessor,
    courseType,
    courseNumber,
    rawTitle: rawTitleSegment,
    strippedTitle,
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
    ueCode,
    subject: resolvedSubject,
    professor: resolvedProfessor,
    courseType,
    courseNumber,
    rawTitle: rawTitleSegment,
    displayTitle,
    targetName,
    matchedRulePattern,
  };
}

/**
 * Formats a course title synchronously for UI display (library list, tree, reader header)
 * without touching the actual filename on disk.
 */
export function formatCourseDisplayTitle(
  fileName: string,
  titleFormat: TitleFormatSettings,
  rules: SortRule[],
  overrides?: {subject?: string; professor?: string; mimeType?: string}
): string {
  const parsed = parseCourseFilename(fileName, rules, overrides?.mimeType, titleFormat);
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

  const usesTypeOrNumber =
    /\{type\}|\{numero\}|\{num\}|\{n\}/i.test(
      (titleFormat.outputTemplate || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    );

  const detectedFromTitle = extractTypeAndNumberFromSegment(parsed.rawTitle);
  const strippedTitle =
    parsed.courseType && usesTypeOrNumber
      ? detectedFromTitle.strippedTitle || parsed.rawTitle
      : parsed.rawTitle;

  return renderOutputTemplate(titleFormat.outputTemplate, {
    subject,
    professor,
    courseType: parsed.courseType,
    courseNumber: parsed.courseNumber,
    rawTitle: parsed.rawTitle,
    strippedTitle,
    originalWithoutExt: withoutExt,
  });
}

export function buildImportQueueItems(
  files: File[],
  rules: SortRule[],
  titleFormat: TitleFormatSettings = DEFAULT_TITLE_FORMAT_SETTINGS
): ImportQueueItem[] {
  return files
    .filter((f) => isSupportedCourseFile(f))
    .map((file, index) => {
      const parsed = parseCourseFilename(file.name, rules, file.type, titleFormat);
      return {
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        size: file.size,
        originalName: file.name,
        targetName: parsed.targetName,
        displayTitle: parsed.displayTitle,
        courseType: parsed.courseType,
        courseNumber: parsed.courseNumber,
        ueCode: parsed.ueCode,
        subject: parsed.subject,
        professor: parsed.professor,
        matchedRulePattern: parsed.matchedRulePattern,
        status: 'pending',
      };
    });
}
