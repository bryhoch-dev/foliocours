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
  inputTemplate: '{Matière}_{Prof}_{Titre}',
  outputTemplate: '{Titre}',
  renameOnDisk: false,
  replaceUnderscoresWithSpaces: true,
  hideExtension: true,
};

export const DEFAULT_SORT_RULES: SortRule[] = [];

export function normalizeTitleFormatSettings(
  raw?: Partial<TitleFormatSettings> | null
): TitleFormatSettings {
  if (!raw || typeof raw !== 'object') {
    return {...DEFAULT_TITLE_FORMAT_SETTINGS};
  }
  return {
    inputTemplate:
      typeof raw.inputTemplate === 'string' && raw.inputTemplate.trim()
        ? raw.inputTemplate
        : DEFAULT_TITLE_FORMAT_SETTINGS.inputTemplate,
    outputTemplate:
      typeof raw.outputTemplate === 'string' && raw.outputTemplate.trim()
        ? raw.outputTemplate
        : DEFAULT_TITLE_FORMAT_SETTINGS.outputTemplate,
    renameOnDisk: Boolean(raw.renameOnDisk),
    replaceUnderscoresWithSpaces: raw.replaceUnderscoresWithSpaces !== false,
    hideExtension: raw.hideExtension !== false,
  };
}

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
      return {...DEFAULT_TITLE_FORMAT_SETTINGS};
    }
    const parsed = JSON.parse(raw) as Partial<TitleFormatSettings>;
    return normalizeTitleFormatSettings(parsed);
  } catch {
    return {...DEFAULT_TITLE_FORMAT_SETTINGS};
  }
}

export function saveTitleFormatSettings(settings: TitleFormatSettings): void {
  localStorage.setItem(
    TITLE_FORMAT_STORAGE_KEY,
    JSON.stringify(normalizeTitleFormatSettings(settings))
  );
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

function templateHasBothProfAndTitle(template: string): boolean {
  let hasProf = false;
  let hasTitle = false;
  for (const token of tokenizeTemplate(template)) {
    if (token.kind === 'tag') {
      if (token.tag === 'professor') hasProf = true;
      if (token.tag === 'title') hasTitle = true;
    }
  }
  return hasProf && hasTitle;
}

export function swapProfAndTitleInTemplate(template: string): string {
  return template.replace(/\{([^}]+)\}/g, (fullMatch, rawTag: string) => {
    const canonical = canonicalizeTagName(rawTag);
    if (canonical === 'professor') return '{Titre}';
    if (canonical === 'title') return '{Prof}';
    return fullMatch;
  });
}

export function swapProfAndTitleInSettings(
  settings: TitleFormatSettings
): TitleFormatSettings {
  const normalized = normalizeTitleFormatSettings(settings);
  if (templateHasBothProfAndTitle(normalized.outputTemplate)) {
    return {
      ...normalized,
      outputTemplate: swapProfAndTitleInTemplate(normalized.outputTemplate),
    };
  }
  if (templateHasBothProfAndTitle(normalized.inputTemplate)) {
    return {
      ...normalized,
      inputTemplate: swapProfAndTitleInTemplate(normalized.inputTemplate),
    };
  }
  return {
    ...normalized,
    inputTemplate: swapProfAndTitleInTemplate(normalized.inputTemplate),
    outputTemplate: swapProfAndTitleInTemplate(normalized.outputTemplate),
  };
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

function extractTypeAndNumber(source: string): {
  courseType: string;
  courseNumber: string;
} {
  const normalizedInput = source.replace(/_/g, ' ');
  const typeMatch = normalizedInput.match(
    /\b(CM|TD|TP|ED|Cours|Ron[eé]o|Fiche|Annale|S[eé]ance|Chapitre|Partiel|Examen|Colle|Tutorat)\b(?:\s*(?:n[°o.]?|#)?\s*(\d{1,3}[a-z]?))?/i
  );

  if (typeMatch) {
    const rawType = typeMatch[1];
    const upper = rawType.toUpperCase();
    const courseType =
      upper === 'CM' || upper === 'TD' || upper === 'TP' || upper === 'ED'
        ? upper
        : rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
    let courseNumber = typeMatch[2] ?? '';
    if (!courseNumber) {
      const explicitNum = normalizedInput.match(/\bn[°o.]\s*(\d{1,3}[a-z]?)\b/i);
      courseNumber = explicitNum?.[1] ?? '';
    }
    return {courseType, courseNumber};
  }

  const standaloneNum = normalizedInput.match(/\bn[°o.]\s*(\d{1,3}[a-z]?)\b/i);
  return {
    courseType: '',
    courseNumber: standaloneNum?.[1] ?? '',
  };
}

function applyDisplayFormatting(
  text: string,
  ext: string,
  options: {
    replaceUnderscoresWithSpaces?: boolean;
    hideExtension?: boolean;
    preserveExtensionBehavior?: boolean;
  }
): string {
  const replaceUnderscores = options.replaceUnderscoresWithSpaces !== false;
  const hideExtension = options.hideExtension !== false;

  let out = text.trim();
  if (replaceUnderscores) {
    out = out.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  if (options.preserveExtensionBehavior) {
    if (hideExtension) {
      out = stripSupportedExtension(out);
    } else if (ext && !new RegExp(`\\.${escapeRegExp(ext)}$`, 'i').test(out)) {
      out = `${out}.${ext}`;
    }
  }

  return out;
}

function renderOutputTemplate(
  outputTemplate: string,
  values: {
    subject: string;
    professor: string;
    rawTitle: string;
    originalWithoutExt: string;
    courseType?: string;
    courseNumber?: string;
    ext?: string;
    replaceUnderscoresWithSpaces?: boolean;
    hideExtension?: boolean;
  }
): string {
  const tpl = outputTemplate.trim() || '{Titre}';
  const replaceUnderscores = values.replaceUnderscoresWithSpaces !== false;
  const formatPart = (part: string) =>
    replaceUnderscores ? part.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim() : part;

  const rendered = tpl.replace(/\{([^}]+)\}/g, (fullMatch, rawTag: string) => {
    const tag = canonicalizeTagName(rawTag);
    switch (tag) {
      case 'subject':
        return formatPart(values.subject);
      case 'professor':
        return formatPart(values.professor);
      case 'title':
        return formatPart(values.rawTitle || values.originalWithoutExt);
      case 'original':
        return formatPart(values.originalWithoutExt);
      case 'type':
        return formatPart(values.courseType ?? '');
      case 'number':
        return formatPart(values.courseNumber ?? '');
      case 'ignore':
        return '';
      default:
        return fullMatch;
    }
  });

  const cleaned = rendered
    .replace(/[-–—:]\s*[-–—:]\s*/g, ' - ')
    .replace(/\s+[-–—:]\s*$/g, '')
    .replace(/^\s*[-–—:]\s+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const fallback = formatPart(values.originalWithoutExt);
  const baseResult = cleaned || fallback;

  return applyDisplayFormatting(baseResult, values.ext ?? '', {
    replaceUnderscoresWithSpaces: replaceUnderscores,
    hideExtension: values.hideExtension,
    preserveExtensionBehavior: true,
  });
}

function hasTokenMatch(haystackNorm: string, needleNorm: string): boolean {
  if (!haystackNorm || !needleNorm) return false;
  if (haystackNorm === needleNorm) return true;
  const escaped = escapeRegExp(needleNorm);
  const tokenRegex = new RegExp(
    `(?:^|[\\s._\\-/()\\[\\]])${escaped}(?:$|[\\s._\\-/()\\[\\]])`,
    'i'
  );
  return tokenRegex.test(haystackNorm);
}

/**
 * Synchronizes sort/alias rules in localStorage when a folder (subject or professor)
 * is physically renamed from oldName -> newName:
 * 1. If an existing rule already mapped to oldName, updates its destination to newName.
 * 2. Otherwise creates a new alias rule mapping oldName -> newName.
 */
export function syncRulesOnFolderRename(params: {
  targetType: 'subject' | 'professor';
  oldName: string;
  newName: string;
  existingRules?: SortRule[];
}): {
  rules: SortRule[];
  action: 'updated' | 'created' | 'noop';
  updatedCount: number;
  affectedRule: SortRule | null;
} {
  const oldClean = cleanSegment(params.oldName);
  const newClean = cleanSegment(params.newName);
  const current = params.existingRules ? [...params.existingRules] : loadSortRules();

  if (!oldClean || !newClean || oldClean === newClean) {
    return {rules: current, action: 'noop', updatedCount: 0, affectedRule: null};
  }

  const oldNorm = normalizeForMatch(oldClean);
  let updatedCount = 0;
  let firstAffected: SortRule | null = null;

  const updatedRules = current.map((rule) => {
    if (
      params.targetType === 'subject' &&
      (rule.matchTarget === 'subject' ||
        rule.matchTarget === 'ue' ||
        rule.matchTarget === 'any' ||
        rule.matchTarget === 'filename') &&
      rule.subject.trim() &&
      normalizeForMatch(rule.subject) === oldNorm
    ) {
      updatedCount++;
      const updated: SortRule = {...rule, subject: newClean};
      if (!firstAffected) firstAffected = updated;
      return updated;
    }

    if (
      params.targetType === 'professor' &&
      (rule.matchTarget === 'professor' ||
        rule.matchTarget === 'any' ||
        rule.matchTarget === 'filename') &&
      rule.professor.trim() &&
      normalizeForMatch(rule.professor) === oldNorm
    ) {
      updatedCount++;
      const updated: SortRule = {...rule, professor: newClean};
      if (!firstAffected) firstAffected = updated;
      return updated;
    }

    return rule;
  });

  if (updatedCount > 0) {
    saveSortRules(updatedRules);
    return {
      rules: updatedRules,
      action: 'updated',
      updatedCount,
      affectedRule: firstAffected,
    };
  }

  // No rule targeted oldName yet: check if an identical alias rule already exists
  const alreadyExists = current.find(
    (r) =>
      r.matchTarget === params.targetType &&
      normalizeForMatch(r.pattern) === oldNorm &&
      normalizeForMatch(
        params.targetType === 'subject' ? r.subject : r.professor
      ) === normalizeForMatch(newClean)
  );
  if (alreadyExists) {
    return {
      rules: current,
      action: 'noop',
      updatedCount: 0,
      affectedRule: alreadyExists,
    };
  }

  const createdRule: SortRule = {
    id: `alias-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    pattern: oldClean,
    matchTarget: params.targetType,
    subject: params.targetType === 'subject' ? newClean : '',
    professor: params.targetType === 'professor' ? newClean : '',
    enabled: true,
  };

  const nextRules = [...current, createdRule];
  saveSortRules(nextRules);
  return {
    rules: nextRules,
    action: 'created',
    updatedCount: 0,
    affectedRule: createdRule,
  };
}

/**
 * Parses a course filename (.pdf, .docx, .odt) using the dynamic regex
 * generated from the user's editable TitleFormatSettings, then applies any
 * user-defined or auto-created folder rename alias rules from localStorage.
 */
export function parseCourseFilename(
  fileName: string,
  titleFormat: TitleFormatSettings = DEFAULT_TITLE_FORMAT_SETTINGS,
  mimeType?: string,
  rules?: SortRule[]
): {
  ueCode: string;
  subject: string;
  professor: string;
  courseType: string;
  courseNumber: string;
  rawTitle: string;
  displayTitle: string;
  targetName: string;
  matchedTemplate: boolean;
} {
  const normalizedFormat = normalizeTitleFormatSettings(titleFormat);
  const detectedExt = getCourseFileFormat(fileName, mimeType) ?? 'pdf';
  const withoutExt = stripSupportedExtension(fileName);
  const hasKnownExt = /\.(pdf|docx|odt)$/i.test(fileName.trim());
  const cleanFileName = hasKnownExt ? fileName.trim() : `${withoutExt}.${detectedExt}`;

  const {regex, tags} = compileInputTemplateRegex(normalizedFormat.inputTemplate);
  const match = regex ? withoutExt.trim().match(regex) : null;

  let subject = '';
  let professor = '';
  let rawTitle = '';
  let capturedType = '';
  let capturedNumber = '';

  if (match) {
    for (let i = 0; i < tags.length; i++) {
      const captured = cleanSegment(match[i + 1] ?? '');
      const tag = tags[i];
      if (tag === 'subject' && !subject) {
        subject = captured;
      } else if (tag === 'professor' && !professor) {
        professor = captured;
      } else if (tag === 'type' && !capturedType) {
        capturedType = captured;
      } else if (tag === 'number' && !capturedNumber) {
        capturedNumber = captured;
      } else if (tag === 'title') {
        rawTitle = rawTitle ? `${rawTitle} ${captured}` : captured;
      }
      // 'ignore' is intentionally discarded
    }
  }

  let resolvedSubject = subject || 'Non classé';
  let resolvedProfessor = professor || 'Professeur non précisé';
  // Never fall back to parent professor folder; use full filename without extension if {Titre} wasn't captured
  const resolvedTitle = rawTitle || cleanSegment(withoutExt);

  const detectedMeta = extractTypeAndNumber(rawTitle || withoutExt);
  const courseType = capturedType || detectedMeta.courseType;
  const courseNumber = capturedNumber || detectedMeta.courseNumber;

  const activeRules = rules ?? loadSortRules();
  if (activeRules.length > 0) {
    const normSubject = normalizeForMatch(resolvedSubject);
    const normProfessor = normalizeForMatch(resolvedProfessor);
    const normBase = normalizeForMatch(withoutExt);

    let subjectApplied = false;
    let professorApplied = false;

    for (const rule of activeRules) {
      if (!rule.enabled) continue;
      const patternNorm = normalizeForMatch(rule.pattern);
      if (!patternNorm) continue;

      let matches = false;
      if (rule.matchTarget === 'subject' || rule.matchTarget === 'ue') {
        matches =
          normSubject === patternNorm ||
          (resolvedSubject === 'Non classé' && hasTokenMatch(normBase, patternNorm));
      } else if (rule.matchTarget === 'professor') {
        matches =
          normProfessor === patternNorm ||
          (resolvedProfessor === 'Professeur non précisé' &&
            hasTokenMatch(normBase, patternNorm));
      } else {
        // 'any' | 'filename'
        matches =
          normSubject === patternNorm ||
          normProfessor === patternNorm ||
          hasTokenMatch(normBase, patternNorm);
      }

      if (!matches) continue;

      if (!subjectApplied && rule.subject.trim()) {
        resolvedSubject = cleanSegment(rule.subject);
        subjectApplied = true;
      }
      if (!professorApplied && rule.professor.trim()) {
        resolvedProfessor = cleanSegment(rule.professor);
        professorApplied = true;
      }

      if (subjectApplied && professorApplied) break;
    }
  }

  const displayTitle = renderOutputTemplate(normalizedFormat.outputTemplate, {
    subject: resolvedSubject,
    professor: resolvedProfessor,
    rawTitle: resolvedTitle,
    originalWithoutExt: withoutExt,
    courseType,
    courseNumber,
    ext: detectedExt,
    replaceUnderscoresWithSpaces: normalizedFormat.replaceUnderscoresWithSpaces,
    hideExtension: normalizedFormat.hideExtension,
  });

  const diskBaseCandidate = stripSupportedExtension(displayTitle);
  const sanitizedDiskBase = diskBaseCandidate
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');

  const targetName =
    normalizedFormat.renameOnDisk && sanitizedDiskBase
      ? `${sanitizedDiskBase}.${detectedExt}`
      : cleanFileName;

  return {
    ueCode: '',
    subject: resolvedSubject,
    professor: resolvedProfessor,
    courseType,
    courseNumber,
    rawTitle: resolvedTitle,
    displayTitle,
    targetName,
    matchedTemplate: Boolean(match),
  };
}

const IGNORED_PREFIX_VALUES = new Set([
  '',
  'a organiser',
  'non classe',
  'general',
  'racine',
  'professeur non precise',
]);

function normalizePrefixCompare(value: string): string {
  return normalizeForMatch(value.replace(/_/g, ' ')).replace(/\s+/g, ' ').trim();
}

function stripOneLeadingPrefix(
  source: string,
  candidates: Array<{kind: 'subject' | 'professor'; norm: string}>
): {rest: string; matchedKind: 'subject' | 'professor'} | null {
  const sepMatch = source.match(/^(.+?)(?:\s+[-–—:/]\s+|_+|\s*[-–—:]\s+)(.+)$/);
  if (!sepMatch) return null;

  const headNorm = normalizePrefixCompare(sepMatch[1]);
  const rest = cleanSegment(sepMatch[2]);
  if (!headNorm || !rest) return null;

  for (const candidate of candidates) {
    if (headNorm === candidate.norm) {
      return {rest, matchedKind: candidate.kind};
    }
  }
  return null;
}

function stripKnownSubjectAndProfessorPrefixes(
  withoutExt: string,
  subject?: string,
  professor?: string
): string {
  const rawClean = cleanSegment(withoutExt);
  if (!rawClean) return '';

  const candidates: Array<{kind: 'subject' | 'professor'; norm: string}> = [];
  if (subject) {
    const normSubj = normalizePrefixCompare(subject);
    if (!IGNORED_PREFIX_VALUES.has(normSubj)) {
      candidates.push({kind: 'subject', norm: normSubj});
    }
  }
  if (professor) {
    const normProf = normalizePrefixCompare(professor);
    if (!IGNORED_PREFIX_VALUES.has(normProf)) {
      candidates.push({kind: 'professor', norm: normProf});
    }
  }
  if (candidates.length === 0) return rawClean;

  let current = rawClean;
  const used = new Set<'subject' | 'professor'>();

  for (let step = 0; step < 2; step++) {
    const remainingCandidates = candidates.filter((c) => !used.has(c.kind));
    if (remainingCandidates.length === 0) break;
    const stripped = stripOneLeadingPrefix(current, remainingCandidates);
    if (!stripped) break;
    used.add(stripped.matchedKind);
    current = stripped.rest;
  }

  return current || rawClean;
}

/**
 * Formats a course title synchronously for UI display (library list, tree, reader header)
 * using the exact same parser on PC and Mobile/Cloud (never substituting parent folder name as title).
 */
export function formatCourseDisplayTitle(
  fileName: string,
  titleFormat: TitleFormatSettings,
  overrides?: {
    subject?: string;
    professor?: string;
    mimeType?: string;
    rules?: SortRule[];
  }
): string {
  const normalizedFormat = normalizeTitleFormatSettings(titleFormat);
  const detectedExt = getCourseFileFormat(fileName, overrides?.mimeType) ?? 'pdf';
  const parsed = parseCourseFilename(
    fileName,
    normalizedFormat,
    overrides?.mimeType,
    overrides?.rules
  );
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

  const resolvedTitle = parsed.matchedTemplate
    ? parsed.rawTitle || cleanSegment(withoutExt)
    : stripKnownSubjectAndProfessorPrefixes(withoutExt, subject, professor);

  const detectedMeta = extractTypeAndNumber(resolvedTitle || withoutExt);

  return renderOutputTemplate(normalizedFormat.outputTemplate, {
    subject,
    professor,
    rawTitle: resolvedTitle,
    originalWithoutExt: withoutExt,
    courseType: parsed.courseType || detectedMeta.courseType,
    courseNumber: parsed.courseNumber || detectedMeta.courseNumber,
    ext: detectedExt,
    replaceUnderscoresWithSpaces: normalizedFormat.replaceUnderscoresWithSpaces,
    hideExtension: normalizedFormat.hideExtension,
  });
}

export function buildImportQueueItems(
  files: File[],
  titleFormat: TitleFormatSettings = DEFAULT_TITLE_FORMAT_SETTINGS,
  rules?: SortRule[]
): ImportQueueItem[] {
  return files
    .filter((f) => isSupportedCourseFile(f))
    .map((file, index) => {
      const parsed = parseCourseFilename(file.name, titleFormat, file.type, rules);
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
