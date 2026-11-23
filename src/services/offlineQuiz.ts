import type {QuizFormatPreference, QuizQuestion} from '../types/course';
import type {QuizCourseExcerpt} from './gemini';
import {normaliserTexte} from './db';

interface DefinitionCandidate {
  term: string;
  relation: string;
  definition: string;
  fullSentence: string;
  fileName: string;
}

function cleanTextForSentenceSplit(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitIntoSentences(raw: string): string[] {
  const cleaned = cleanTextForSentenceSplit(raw);
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 28 && s.length <= 340);
}

function trimTerm(raw: string): string {
  return raw
    .replace(/^[-•*\d.)\s]+/, '')
    .replace(/^(le|la|les|l'|un|une|des|en|dans)\s+/i, (m) => m)
    .replace(/[,;:\s]+$/, '')
    .trim();
}

function trimDefinition(raw: string): string {
  return raw
    .replace(/^[:=\s]+/, '')
    .replace(/[.!?;:\s]+$/, '')
    .trim();
}

const RELATION_PATTERNS: Array<{regex: RegExp; relationLabel: string}> = [
  {
    regex: /^(.{3,75}?)\s+(est d[ée]fini(?:e)? comme|se d[ée]finit comme)\s+(.{12,240})$/i,
    relationLabel: 'est défini comme',
  },
  {
    regex: /^(.{3,75}?)\s+(correspond(?:ent)? [àa])\s+(.{12,240})$/i,
    relationLabel: 'correspond à',
  },
  {
    regex: /^(.{3,75}?)\s+(permet(?:tent)? de)\s+(.{12,240})$/i,
    relationLabel: 'permet de',
  },
  {
    regex: /^(.{3,75}?)\s+(signifie|d[ée]signe|repr[ée]sente|consiste [àa]|consiste en)\s+(.{12,240})$/i,
    relationLabel: 'désigne',
  },
  {
    regex: /^([^:=]{3,65}?)\s*:\s*(.{15,240})$/,
    relationLabel: ':',
  },
  {
    regex: /^([^:=]{2,55}?)\s*=\s*(.{6,180})$/,
    relationLabel: '=',
  },
];

function extractDefinitionCandidates(
  excerpts: QuizCourseExcerpt[]
): DefinitionCandidate[] {
  const candidates: DefinitionCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const excerpt of excerpts) {
    const sentences = splitIntoSentences(excerpt.text);
    for (const sentence of sentences) {
      for (const {regex, relationLabel} of RELATION_PATTERNS) {
        const match = regex.exec(sentence);
        if (!match) continue;

        let term = '';
        let relation = relationLabel;
        let definition = '';

        if (match.length === 4) {
          term = trimTerm(match[1]);
          relation = match[2].trim();
          definition = trimDefinition(match[3]);
        } else if (match.length === 3) {
          term = trimTerm(match[1]);
          definition = trimDefinition(match[2]);
        }

        if (
          term.length < 3 ||
          term.length > 75 ||
          definition.length < 8 ||
          term.split(/\s+/).length > 9
        ) {
          continue;
        }
        // Ignore generic boilerplate headers (page numbers, dates, etc.)
        if (/^(page|chapitre|figure|tableau|nb|remarque)\b/i.test(term)) {
          continue;
        }

        const dedupKey = normaliserTexte(`${term}::${definition.slice(0, 40)}`);
        if (seenKeys.has(dedupKey)) continue;
        seenKeys.add(dedupKey);

        candidates.push({
          term,
          relation,
          definition,
          fullSentence: sentence,
          fileName: excerpt.fileName,
        });
        break;
      }
    }
  }

  return candidates;
}

function extractFallbackClozeCandidates(
  excerpts: QuizCourseExcerpt[]
): DefinitionCandidate[] {
  const candidates: DefinitionCandidate[] = [];
  const seenTerms = new Set<string>();

  for (const excerpt of excerpts) {
    const sentences = splitIntoSentences(excerpt.text);
    for (const sentence of sentences) {
      const words = sentence.match(/[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9'-]{5,}/g) ?? [];
      const target =
        words.find((w, idx) => idx > 0 && /^[A-ZÉÈÊÀÂÎÔÙ]/.test(w)) ??
        words.sort((a, b) => b.length - a.length)[0];
      if (!target) continue;

      const norm = normaliserTexte(target);
      if (seenTerms.has(norm)) continue;
      seenTerms.add(norm);

      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const masked = sentence.replace(new RegExp(`\\b${escaped}\\b`), '_____');
      if (masked === sentence) continue;

      candidates.push({
        term: target,
        relation: 'à compléter',
        definition: masked,
        fullSentence: sentence,
        fileName: excerpt.fileName,
      });
    }
  }

  return candidates;
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function generateOfflineFolderQuiz(params: {
  excerpts: QuizCourseExcerpt[];
  questionCount: 5 | 10 | 15;
  format: QuizFormatPreference;
}): QuizQuestion[] {
  const {excerpts, questionCount, format} = params;
  if (excerpts.length === 0) {
    throw new Error('Aucun texte disponible pour générer un quiz hors-ligne.');
  }

  const defCandidates = extractDefinitionCandidates(excerpts);
  const clozeFallback =
    defCandidates.length < questionCount
      ? extractFallbackClozeCandidates(excerpts)
      : [];

  const combinedPool = shuffleArray([
    ...defCandidates,
    ...clozeFallback,
  ]);

  if (combinedPool.length === 0) {
    throw new Error(
      'Aucune phrase exploitable trouvée dans ces documents pour générer un quiz hors-ligne.'
    );
  }

  // Build distractor pools (terms & short definitions from the same folder)
  const termPool = Array.from(
    new Set(combinedPool.map((c) => c.term).filter((t) => t.length >= 3))
  );
  const defPool = Array.from(
    new Set(
      defCandidates
        .map((c) => c.definition)
        .filter((d) => d.length >= 10 && d.length <= 160)
    )
  );

  const selected = combinedPool.slice(0, Math.min(questionCount, combinedPool.length));
  const questions: QuizQuestion[] = [];

  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    const desiredType: QuizQuestion['type'] =
      format === 'qcm'
        ? 'qcm'
        : format === 'ouverte'
        ? 'ouverte'
        : i % 2 === 0
        ? 'qcm'
        : 'ouverte';

    const isClozeOnly = item.relation === 'à compléter';
    // Alternate between asking for the term (cloze) and asking for the definition (when available)
    const askForDefinition =
      !isClozeOnly &&
      item.relation !== 'permet de' &&
      item.definition.length <= 150 &&
      defPool.length >= 4 &&
      i % 3 === 1;

    let questionText: string;
    let correctAnswer: string;
    let distractorSourcePool: string[];

    if (isClozeOnly) {
      questionText = `Complétez cet extrait du cours :\n« ${item.definition} »`;
      correctAnswer = item.term;
      distractorSourcePool = termPool;
    } else if (askForDefinition) {
      questionText = `Dans ce cours, que désigne ou à quoi correspond « ${item.term} » ?`;
      correctAnswer = item.definition;
      distractorSourcePool = defPool;
    } else {
      const relationPhrase =
        item.relation === ':'
          ? 'correspond à :'
          : item.relation === '='
          ? 'équivaut à :'
          : `${item.relation}`;
      questionText = `Quel terme ou notion du cours ${relationPhrase}\n« ${item.definition} » ?`;
      correctAnswer = item.term;
      distractorSourcePool = termPool;
    }

    const normCorrect = normaliserTexte(correctAnswer);
    const distractors = shuffleArray(
      distractorSourcePool.filter((cand) => {
        const normCand = normaliserTexte(cand);
        return normCand !== normCorrect && normCand.length >= 3;
      })
    ).slice(0, 3);

    const canMakeQcm = desiredType === 'qcm' && distractors.length >= 2;

    if (canMakeQcm) {
      questions.push({
        question: questionText,
        type: 'qcm',
        options: shuffleArray([correctAnswer, ...distractors]),
        reponseCorrecte: correctAnswer,
        explication: `Extrait du cours : « ${item.fullSentence} »`,
        fichierSource: item.fileName,
      });
    } else {
      questions.push({
        question: questionText,
        type: 'ouverte',
        options: [],
        reponseCorrecte: correctAnswer,
        explication: `Extrait du cours : « ${item.fullSentence} »`,
        fichierSource: item.fileName,
      });
    }
  }

  return questions;
}
