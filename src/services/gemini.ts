import type {
  GeminiChatTurn,
  QuizFormatPreference,
  QuizQuestion,
} from '../types/course';

const GEMINI_API_KEY_STORAGE_KEY = 'foliocours_gemini_api_key';
const GEMINI_MODEL_STORAGE_KEY = 'foliocours_gemini_model';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const STATIC_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-pro',
];

const MODEL_DISCOVERY_TTL_MS = 5 * 60 * 1000;
let cachedModelsEntry: {apiKey: string; fetchedAt: number; models: string[]} | null =
  null;

export class GeminiMissingKeyError extends Error {
  constructor() {
    super(
      'Aucune clé API Google Gemini configurée. Renseignez-la dans Paramètres → Clé API Google Gemini.'
    );
    this.name = 'GeminiMissingKeyError';
  }
}

export class GeminiAllModelsUnavailableError extends Error {
  constructor(detail?: string) {
    super(
      detail ||
        'Tous les modèles Gemini disponibles sont actuellement saturés ou inaccessibles.'
    );
    this.name = 'GeminiAllModelsUnavailableError';
  }
}

export function isGeminiMissingKeyError(err: unknown): boolean {
  return err instanceof GeminiMissingKeyError;
}

export function isGeminiAllModelsUnavailableError(err: unknown): boolean {
  return err instanceof GeminiAllModelsUnavailableError;
}

export function getSavedGeminiApiKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveGeminiApiKey(apiKey: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = apiKey.trim();
  try {
    if (trimmed) {
      localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
  cachedModelsEntry = null;
}

export function getSavedGeminiModel(): string {
  if (typeof window === 'undefined') return DEFAULT_GEMINI_MODEL;
  try {
    const saved = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY)?.trim();
    return saved ? normalizeModelName(saved) : DEFAULT_GEMINI_MODEL;
  } catch {
    return DEFAULT_GEMINI_MODEL;
  }
}

export function saveGeminiModel(model: string): void {
  if (typeof window === 'undefined') return;
  const cleaned = normalizeModelName(model.trim());
  try {
    if (cleaned && cleaned !== DEFAULT_GEMINI_MODEL) {
      localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, cleaned);
    } else {
      localStorage.removeItem(GEMINI_MODEL_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function hasEnvFallbackGeminiKey(): boolean {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  return typeof envKey === 'string' && envKey.trim().length > 0;
}

export function getEffectiveGeminiApiKey(): string {
  const saved = getSavedGeminiApiKey().trim();
  if (saved) return saved;
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  return typeof envKey === 'string' ? envKey.trim() : '';
}

function normalizeModelName(raw: string): string {
  return raw.replace(/^models\//i, '').trim();
}

interface GeminiListedModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiModelsListResponse {
  models?: GeminiListedModel[];
}

function isEligibleTextGeminiModel(rawName: string, methods?: string[]): boolean {
  if (methods && !methods.includes('generateContent')) return false;
  const name = normalizeModelName(rawName).toLowerCase();
  if (!name.includes('gemini')) return false;
  if (!name.includes('flash') && !name.includes('pro')) return false;
  if (/(vision|embedding|image|tts)/i.test(name)) return false;
  return true;
}

function scoreDiscoveredModel(modelName: string): number {
  const lower = modelName.toLowerCase();
  let score = 0;
  if (lower.includes('flash')) score += 100;
  else if (lower.includes('pro')) score += 50;

  if (lower.includes('lite')) score += 5;
  if (lower.includes('latest')) score += 4;
  if (lower.includes('3.8')) score += 40;
  else if (lower.includes('3.')) score += 35;
  else if (lower.includes('2.5')) score += 30;
  else if (lower.includes('2.0')) score += 20;
  else if (lower.includes('1.5')) score += 10;

  if (lower.includes('exp') || lower.includes('preview')) score -= 3;
  return score;
}

async function discoverCompatibleModels(
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  if (
    cachedModelsEntry &&
    cachedModelsEntry.apiKey === apiKey &&
    Date.now() - cachedModelsEntry.fetchedAt < MODEL_DISCOVERY_TTL_MS
  ) {
    return cachedModelsEntry.models;
  }

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/models?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'GET',
        signal,
      }
    );
    if (!res.ok) {
      return [];
    }
    const json = (await res.json()) as GeminiModelsListResponse;
    const eligible = (json.models ?? [])
      .filter(
        (m) =>
          typeof m.name === 'string' &&
          isEligibleTextGeminiModel(m.name, m.supportedGenerationMethods)
      )
      .map((m) => normalizeModelName(m.name!))
      .sort((a, b) => scoreDiscoveredModel(b) - scoreDiscoveredModel(a));

    const unique = Array.from(new Set(eligible));
    cachedModelsEntry = {
      apiKey,
      fetchedAt: Date.now(),
      models: unique,
    };
    return unique;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return [];
  }
}

interface GeminiCandidatePart {
  text?: string;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiCandidatePart[];
    };
    finishReason?: string;
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

function isRetryableModelFailure(status: number, message: string): boolean {
  if (status === 429 || status === 500 || status === 503 || status === 404) {
    return true;
  }
  return /(high demand|overloaded|quota|no longer available|not found|resource exhausted|rate limit|unavailable)/i.test(
    message
  );
}

function isInvalidApiKeyFailure(status: number, message: string): boolean {
  if (status === 401) return true;
  if (
    (status === 400 || status === 403) &&
    /api key|api_key_invalid|expired|invalid.*key|permission_denied/i.test(message)
  ) {
    return true;
  }
  return false;
}

export interface GeminiCallOptions {
  contents?: Array<{role: 'user' | 'model'; parts: Array<{text: string}>}>;
  systemInstruction?: {parts: Array<{text: string}>};
  generationConfig?: Record<string, unknown>;
  preferredModel?: string;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}

export interface GeminiCallResult {
  text: string;
  modelUsed: string;
}

/**
 * Centralized Gemini caller with dynamic compatible-model discovery
 * and automatic fallback on saturation / unavailability (429, 500, 503, 404, etc.).
 */
export async function appelerGeminiAvecSecours(
  prompt: string,
  options: GeminiCallOptions = {}
): Promise<GeminiCallResult> {
  const apiKey = getEffectiveGeminiApiKey();
  if (!apiKey) {
    throw new GeminiMissingKeyError();
  }

  const preferred = normalizeModelName(
    options.preferredModel?.trim() || getSavedGeminiModel()
  );

  const discovered = await discoverCompatibleModels(apiKey, options.signal);
  const candidateModels = Array.from(
    new Set([
      ...(preferred ? [preferred] : []),
      ...discovered,
      ...STATIC_FALLBACK_MODELS,
    ])
  ).filter((name) => isEligibleTextGeminiModel(name) || name === preferred);

  const payload: Record<string, unknown> = {
    contents: options.contents ?? [
      {
        role: 'user',
        parts: [{text: prompt}],
      },
    ],
  };

  if (options.systemInstruction) {
    payload.systemInstruction = options.systemInstruction;
  }
  if (options.generationConfig) {
    payload.generationConfig = options.generationConfig;
  }

  let lastErrorMessage = '';

  for (let i = 0; i < candidateModels.length; i++) {
    if (options.signal?.aborted) {
      throw new DOMException('Requête annulée.', 'AbortError');
    }

    const model = candidateModels[i];

    try {
      const response = await fetch(
        `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: options.signal,
        }
      );

      let data: GeminiGenerateResponse | null = null;
      try {
        data = (await response.json()) as GeminiGenerateResponse;
      } catch {
        // non-JSON response
      }

      if (!response.ok) {
        const apiMessage = data?.error?.message?.trim() || `HTTP ${response.status}`;

        if (isInvalidApiKeyFailure(response.status, apiMessage)) {
          throw new Error(
            `Clé API Gemini invalide ou refusée (${apiMessage}). Vérifiez votre clé dans Paramètres.`
          );
        }

        if (isRetryableModelFailure(response.status, apiMessage)) {
          lastErrorMessage = `${model} : ${apiMessage}`;
          if (i < candidateModels.length - 1) {
            options.onStatus?.(
              'Modèle saturé, bascule automatique sur un modèle disponible...'
            );
          }
          continue;
        }

        throw new Error(apiMessage || `Erreur API Gemini (HTTP ${response.status}).`);
      }

      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('')
        .trim();

      if (!text) {
        lastErrorMessage = `${model} : réponse vide`;
        if (i < candidateModels.length - 1) {
          options.onStatus?.(
            'Modèle saturé, bascule automatique sur un modèle disponible...'
          );
          continue;
        }
        throw new GeminiAllModelsUnavailableError(
          'Gemini n’a renvoyé aucune réponse exploitable.'
        );
      }

      return {text, modelUsed: model};
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (
        err instanceof Error &&
        err.message.includes('Clé API Gemini invalide')
      ) {
        throw err;
      }

      if (err instanceof TypeError) {
        // Network offline or fetch failure
        throw new GeminiAllModelsUnavailableError(
          'Connexion réseau indisponible pour contacter les serveurs Google Gemini.'
        );
      }

      const msg = err instanceof Error ? err.message : String(err);
      if (isRetryableModelFailure(0, msg)) {
        lastErrorMessage = msg;
        if (i < candidateModels.length - 1) {
          options.onStatus?.(
            'Modèle saturé, bascule automatique sur un modèle disponible...'
          );
        }
        continue;
      }

      throw err;
    }
  }

  throw new GeminiAllModelsUnavailableError(
    lastErrorMessage
      ? `Tous les modèles Gemini sont actuellement saturés ou indisponibles (${lastErrorMessage}).`
      : undefined
  );
}

export interface QuizCourseExcerpt {
  fileName: string;
  text: string;
}

export async function generateFolderQuiz(params: {
  folderTitle: string;
  questionCount: 5 | 10 | 15;
  format: QuizFormatPreference;
  excerpts: QuizCourseExcerpt[];
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}): Promise<{questions: QuizQuestion[]; modelUsed: string}> {
  const {folderTitle, questionCount, format, excerpts, signal, onStatus} = params;
  if (excerpts.length === 0) {
    throw new Error('Aucun contenu textuel exploitable dans les fichiers sélectionnés.');
  }

  const formatInstruction =
    format === 'qcm'
      ? 'Toutes les questions doivent être de type "qcm" avec exactement 4 choix plausibles dans "options".'
      : format === 'ouverte'
      ? 'Toutes les questions doivent être de type "ouverte" (réponse courte attendue, "options" doit être un tableau vide []).'
      : 'Mélange équitablement des questions de type "qcm" (avec 4 choix dans "options") et des questions de type "ouverte" (avec "options": []).';

  const contextBlock = excerpts
    .map(
      (item, index) =>
        `=== DOCUMENT ${index + 1} : ${item.fileName} ===\n${item.text}`
    )
    .join('\n\n');

  const prompt = [
    `Tu es un professeur d'université exigeant et pédagogue. Génère exactement ${questionCount} questions de révision de niveau universitaire en français pour tester la maîtrise du dossier « ${folderTitle} ».`,
    `CONTRAINTE ABSOLUE : appuie-toi UNIQUEMENT sur les extraits de cours fournis ci-dessous. N'invente aucune notion extérieure absente des documents.`,
    formatInstruction,
    `Pour chaque question :`,
    `- "question" : énoncé précis, non ambigu, testant la compréhension ou la mémorisation fine du cours.`,
    `- "type" : "qcm" ou "ouverte".`,
    `- "options" : tableau de 4 propositions distinctes pour un QCM (dont une seule est correcte), ou [] pour une question ouverte.`,
    `- "reponseCorrecte" : pour un QCM, recopie EXACTEMENT la chaîne de la bonne option ; pour une question ouverte, donne la réponse attendue synthétique et précise.`,
    `- "explication" : justification pédagogique détaillée s'appuyant sur le cours (2 à 4 phrases).`,
    `- "fichierSource" : le nom exact du document source tel qu'indiqué après "DOCUMENT X : ".`,
    `Répartis autant que possible les questions sur l'ensemble des documents fournis.`,
    ``,
    contextBlock,
  ].join('\n');

  const {text: rawJson, modelUsed} = await appelerGeminiAvecSecours(prompt, {
    signal,
    onStatus,
    generationConfig: {
      temperature: 0.35,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          questions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                question: {type: 'STRING'},
                type: {type: 'STRING', enum: ['qcm', 'ouverte']},
                options: {
                  type: 'ARRAY',
                  items: {type: 'STRING'},
                },
                reponseCorrecte: {type: 'STRING'},
                explication: {type: 'STRING'},
                fichierSource: {type: 'STRING'},
              },
              required: [
                'question',
                'type',
                'options',
                'reponseCorrecte',
                'explication',
                'fichierSource',
              ],
            },
          },
        },
        required: ['questions'],
      },
    },
  });

  let parsed: {questions?: unknown};
  try {
    parsed = JSON.parse(rawJson) as {questions?: unknown};
  } catch {
    throw new Error('Réponse JSON du quiz invalide retournée par Gemini.');
  }

  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error('Gemini n’a généré aucune question pour ce dossier.');
  }

  const fallbackSource = excerpts[0].fileName;
  const sanitized: QuizQuestion[] = [];

  for (const raw of parsed.questions) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const reponseCorrecte =
      typeof item.reponseCorrecte === 'string' ? item.reponseCorrecte.trim() : '';
    const explication =
      typeof item.explication === 'string' ? item.explication.trim() : '';
    const fichierSource =
      typeof item.fichierSource === 'string' && item.fichierSource.trim()
        ? item.fichierSource.trim()
        : fallbackSource;

    if (!question || !reponseCorrecte) continue;

    let type: QuizQuestion['type'] =
      item.type === 'ouverte' || item.type === 'qcm'
        ? item.type
        : format === 'ouverte'
        ? 'ouverte'
        : 'qcm';

    let options = Array.isArray(item.options)
      ? item.options
          .filter((opt): opt is string => typeof opt === 'string' && opt.trim().length > 0)
          .map((opt) => opt.trim())
      : [];

    if (type === 'qcm') {
      if (options.length < 2) {
        type = 'ouverte';
        options = [];
      } else if (!options.some((opt) => opt === reponseCorrecte)) {
        const lowerTarget = reponseCorrecte.toLowerCase();
        const fuzzy = options.find((opt) => opt.toLowerCase() === lowerTarget);
        if (fuzzy) {
          options = options.map((opt) => (opt === fuzzy ? reponseCorrecte : opt));
        } else {
          options = [reponseCorrecte, ...options.slice(0, 3)];
        }
      }
    } else {
      options = [];
    }

    sanitized.push({
      question,
      type,
      options,
      reponseCorrecte,
      explication: explication || 'Consultez le document source pour plus de détails.',
      fichierSource,
    });
  }

  if (sanitized.length === 0) {
    throw new Error('Aucune question valide n’a pu être extraite de la réponse Gemini.');
  }

  return {questions: sanitized, modelUsed};
}

export async function askGeminiSelectionExplain(params: {
  selectedText: string;
  courseContext: {
    displayTitle: string;
    fileName: string;
    subject: string;
    professor: string;
  };
  history: GeminiChatTurn[];
  followUpQuestion?: string;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}): Promise<GeminiCallResult> {
  const {
    selectedText,
    courseContext,
    history,
    followUpQuestion,
    signal,
    onStatus,
  } = params;

  const systemText = [
    `Tu es un assistant pédagogique universitaire rigoureux et synthétique qui répond en français.`,
    `L'étudiant lit actuellement le cours suivant :`,
    `- Titre : ${courseContext.displayTitle} (fichier : ${courseContext.fileName})`,
    `- Matière : ${courseContext.subject}`,
    `- Professeur / Dossier : ${courseContext.professor}`,
    `Extrait sélectionné dans le document :`,
    `« ${selectedText} »`,
    `Consignes :`,
    `- Donne des explications claires, structurées et concises adaptées au niveau universitaire de cette matière.`,
    `- Utilise des paragraphes courts, des puces (-) et du gras (**mot**) pour mettre en valeur les notions clés.`,
    `- Si l'extrait est un terme technique, donne sa définition précise, son mécanisme ou rôle, et un repère mnémotechnique ou exemple concret si pertinent.`,
  ].join('\n');

  const contents: Array<{role: 'user' | 'model'; parts: Array<{text: string}>}> = [];
  const initialUserPrompt = `Explique clairement ce passage ou terme dans le contexte de mon cours de ${courseContext.subject} :\n\n« ${selectedText} »`;

  if (history.length === 0) {
    contents.push({
      role: 'user',
      parts: [{text: initialUserPrompt}],
    });
  } else {
    for (const turn of history) {
      contents.push({
        role: turn.role,
        parts: [{text: turn.text}],
      });
    }
    if (followUpQuestion?.trim()) {
      contents.push({
        role: 'user',
        parts: [{text: followUpQuestion.trim()}],
      });
    }
  }

  return appelerGeminiAvecSecours(followUpQuestion?.trim() || initialUserPrompt, {
    systemInstruction: {
      parts: [{text: systemText}],
    },
    contents,
    generationConfig: {
      temperature: 0.4,
    },
    signal,
    onStatus,
  });
}
