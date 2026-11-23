import type {
  GeminiChatTurn,
  QuizFormatPreference,
  QuizQuestion,
} from '../types/course';

const GEMINI_API_KEY_STORAGE_KEY = 'foliocours_gemini_api_key';
const GEMINI_MODEL_STORAGE_KEY = 'foliocours_gemini_model';
const GEMINI_MODELS_CACHE_STORAGE_KEY = 'foliocours_gemini_models_cache_v2';
const GEMINI_FAST_MODEL_SESSION_KEY = 'gemini_fast_model';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const STATIC_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-lite',
  'gemini-3.8-pro',
  'gemma-3-27b-it',
  'gemma-3-12b-it',
];

const MODEL_DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const QUIZ_REQUEST_TIMEOUT_MS = 30000;
const EXPLAIN_REQUEST_TIMEOUT_MS = 15000;
const PRIMARY_TRANSIENT_RETRY_DELAY_MS = 1500;

interface CachedModelsRecord {
  keyTag: string;
  fetchedAt: number;
  models: string[];
}

let cachedModelsEntry: CachedModelsRecord | null = null;

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

function getApiKeyTag(apiKey: string): string {
  return `${apiKey.length}:${apiKey.slice(-6)}`;
}

function isLegacyClosedModel(rawName: string): boolean {
  const lower = normalizeModelName(rawName).toLowerCase();
  return lower.includes('gemini-1.') || lower.includes('gemini-2.');
}

function sanitizeStoredGeminiModels(): string {
  if (typeof window === 'undefined') return DEFAULT_GEMINI_MODEL;
  let resolved = DEFAULT_GEMINI_MODEL;

  try {
    const raw = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY)?.trim() ?? '';
    if (raw) {
      const normalized = normalizeModelName(raw);
      if (isLegacyClosedModel(normalized) || !isEligibleTextGeminiModel(normalized)) {
        localStorage.removeItem(GEMINI_MODEL_STORAGE_KEY);
        resolved = DEFAULT_GEMINI_MODEL;
      } else {
        resolved = normalized;
      }
    }
  } catch {
    // ignore storage errors
  }

  try {
    const fast = sessionStorage.getItem(GEMINI_FAST_MODEL_SESSION_KEY)?.trim() ?? '';
    if (fast && (isLegacyClosedModel(fast) || !isEligibleTextGeminiModel(fast))) {
      sessionStorage.removeItem(GEMINI_FAST_MODEL_SESSION_KEY);
    }
  } catch {
    // ignore storage errors
  }

  return resolved;
}

function getSessionFastModel(): string {
  if (typeof window === 'undefined') return '';
  try {
    const val = sessionStorage.getItem(GEMINI_FAST_MODEL_SESSION_KEY)?.trim() ?? '';
    if (!val) return '';
    const norm = normalizeModelName(val);
    if (isLegacyClosedModel(norm) || !isEligibleTextGeminiModel(norm)) {
      sessionStorage.removeItem(GEMINI_FAST_MODEL_SESSION_KEY);
      return '';
    }
    return norm;
  } catch {
    return '';
  }
}

function saveSessionFastModel(model: string): void {
  if (typeof window === 'undefined') return;
  const cleaned = normalizeModelName(model);
  if (
    !cleaned ||
    isLegacyClosedModel(cleaned) ||
    !cleaned.toLowerCase().startsWith('gemini-')
  ) {
    return;
  }
  try {
    sessionStorage.setItem(GEMINI_FAST_MODEL_SESSION_KEY, cleaned);
  } catch {
    // ignore storage errors
  }
}

function clearSessionFastModel(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(GEMINI_FAST_MODEL_SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}

function clearModelsDiscoveryCache(): void {
  cachedModelsEntry = null;
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(GEMINI_MODELS_CACHE_STORAGE_KEY);
    localStorage.removeItem('foliocours_gemini_models_cache_v1');
  } catch {
    // ignore storage errors
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
  clearModelsDiscoveryCache();
  clearSessionFastModel();
}

export function getSavedGeminiModel(): string {
  return sanitizeStoredGeminiModels();
}

export function saveGeminiModel(model: string): void {
  if (typeof window === 'undefined') return;
  const cleaned = normalizeModelName(model.trim());
  const safeModel =
    !cleaned || isLegacyClosedModel(cleaned) ? DEFAULT_GEMINI_MODEL : cleaned;
  try {
    if (safeModel && safeModel !== DEFAULT_GEMINI_MODEL) {
      localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, safeModel);
    } else {
      localStorage.removeItem(GEMINI_MODEL_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
  clearSessionFastModel();
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
  if (!name) return false;

  // Strictly exclude closed legacy models & non-text specialized models
  if (/(gemini-1\.|gemini-2\.|embedding|vision|image|tts|aqa)/i.test(name)) {
    return false;
  }

  // Only keep active gemini-3+ and gemma-3+ families
  const isGemini3OrAbove = /^gemini-([3-9]|[1-9]\d+)(\.|-|$)/.test(name);
  const isGemma3OrAbove = /^gemma-([3-9]|[1-9]\d+)(\.|-|$)/.test(name);
  return isGemini3OrAbove || isGemma3OrAbove;
}

function scoreDiscoveredModel(modelName: string): number {
  const lower = modelName.toLowerCase();
  let score = 0;

  // Always rank Gemini 3+ variants ahead of Gemma 3 last-resort models
  if (lower.startsWith('gemini-')) {
    score += 1000;
    if (lower === 'gemini-3.8-flash') score += 300;
    else if (lower.includes('flash-lite') || (lower.includes('flash') && lower.includes('lite'))) {
      score += 220;
    } else if (lower.includes('flash')) {
      score += 200;
    } else if (lower.includes('pro')) {
      score += 120;
    }
    if (lower.includes('3.8')) score += 40;
    else if (lower.includes('3.')) score += 20;
  } else if (lower.startsWith('gemma-')) {
    score += 100;
    if (lower === 'gemma-3-27b-it') score += 50;
    else if (lower === 'gemma-3-12b-it') score += 40;
    else if (lower.includes('27b')) score += 30;
    else if (lower.includes('12b')) score += 20;
  }

  if (lower.includes('latest')) score += 4;
  if (lower.includes('exp') || lower.includes('preview')) score -= 3;
  return score;
}

sanitizeStoredGeminiModels();

function readCachedModelsFromStorage(keyTag: string): string[] | null {
  if (
    cachedModelsEntry &&
    cachedModelsEntry.keyTag === keyTag &&
    Date.now() - cachedModelsEntry.fetchedAt < MODEL_DISCOVERY_TTL_MS
  ) {
    return cachedModelsEntry.models;
  }

  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(GEMINI_MODELS_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedModelsRecord>;
    if (
      parsed.keyTag === keyTag &&
      typeof parsed.fetchedAt === 'number' &&
      Date.now() - parsed.fetchedAt < MODEL_DISCOVERY_TTL_MS &&
      Array.isArray(parsed.models) &&
      parsed.models.length > 0
    ) {
      const cleaned = parsed.models
        .filter(
          (m): m is string =>
            typeof m === 'string' &&
            m.trim().length > 0 &&
            isEligibleTextGeminiModel(m)
        )
        .map((m) => normalizeModelName(m))
        .sort((a, b) => scoreDiscoveredModel(b) - scoreDiscoveredModel(a));
      cachedModelsEntry = {
        keyTag,
        fetchedAt: parsed.fetchedAt,
        models: cleaned,
      };
      return cleaned;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function writeCachedModelsToStorage(keyTag: string, models: string[]): void {
  const record: CachedModelsRecord = {
    keyTag,
    fetchedAt: Date.now(),
    models,
  };
  cachedModelsEntry = record;
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GEMINI_MODELS_CACHE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore storage errors
  }
}

async function discoverCompatibleModels(
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  const keyTag = getApiKeyTag(apiKey);
  const cached = readCachedModelsFromStorage(keyTag);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), 4000);
  const onExternalAbort = () => controller.abort('external');
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException('Requête annulée.', 'AbortError');
    }
    signal.addEventListener('abort', onExternalAbort, {once: true});
  }

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/models?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'GET',
        signal: controller.signal,
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
    if (unique.length > 0) {
      writeCachedModelsToStorage(keyTag, unique);
    }
    return unique;
  } catch (err) {
    if (signal?.aborted) {
      throw new DOMException('Requête annulée.', 'AbortError');
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      return [];
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);
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
  timeoutMs?: number;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}

export interface GeminiCallResult {
  text: string;
  modelUsed: string;
}

function isTransientHighDemandFailure(status: number, message: string): boolean {
  if (status === 429 || status === 503) return true;
  return /high demand|overloaded|rate limit|resource exhausted/i.test(message);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Requête annulée.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Requête annulée.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

function buildUniversalContents(
  prompt: string,
  options: GeminiCallOptions
): Array<{role: 'user' | 'model'; parts: Array<{text: string}>}> {
  const sysText = (options.systemInstruction?.parts ?? [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  const baseContents =
    options.contents && options.contents.length > 0
      ? options.contents.map((turn) => ({
          role: turn.role,
          parts: turn.parts.map((part) => ({text: part.text})),
        }))
      : [
          {
            role: 'user' as const,
            parts: [{text: prompt}],
          },
        ];

  if (sysText) {
    const firstUserIdx = baseContents.findIndex((t) => t.role === 'user');
    if (firstUserIdx !== -1) {
      const existing = baseContents[firstUserIdx].parts.map((p) => p.text).join('\n');
      baseContents[firstUserIdx] = {
        role: 'user',
        parts: [{text: `${sysText}\n\n${existing}`}],
      };
    } else {
      baseContents.unshift({
        role: 'user',
        parts: [{text: sysText}],
      });
    }
  }

  return baseContents;
}

/**
 * Centralized Gemini/Gemma caller:
 * - Strictly excludes legacy gemini-1.x / gemini-2.x models
 * - Prioritizes gemini-3.8-flash (with 1.5s retry on 429/503/high demand),
 *   then remaining gemini-3+ variants, then gemma-3-27b-it / gemma-3-12b-it
 * - Omits systemInstruction & responseMimeType for universal Gemini 3 + Gemma 3 compatibility
 * - Surfaces the first model's error if all models fail
 */
export async function appelerGeminiAvecSecours(
  prompt: string,
  options: GeminiCallOptions = {}
): Promise<GeminiCallResult> {
  const apiKey = getEffectiveGeminiApiKey();
  if (!apiKey) {
    throw new GeminiMissingKeyError();
  }

  const sanitizedSaved = sanitizeStoredGeminiModels();
  const rawPreferred = normalizeModelName(
    options.preferredModel?.trim() || sanitizedSaved
  );
  const preferred =
    !rawPreferred || isLegacyClosedModel(rawPreferred) || !isEligibleTextGeminiModel(rawPreferred)
      ? DEFAULT_GEMINI_MODEL
      : rawPreferred;

  const fastSessionModel = getSessionFastModel();
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const discovered = await discoverCompatibleModels(apiKey, options.signal);
  const discoveredGemini3 = discovered.filter((m) =>
    m.toLowerCase().startsWith('gemini-')
  );
  const discoveredGemma3 = discovered.filter((m) =>
    m.toLowerCase().startsWith('gemma-')
  );
  const staticGemini3 = STATIC_FALLBACK_MODELS.filter((m) =>
    m.toLowerCase().startsWith('gemini-')
  );
  const staticGemma3 = STATIC_FALLBACK_MODELS.filter((m) =>
    m.toLowerCase().startsWith('gemma-')
  );

  const candidateModels = Array.from(
    new Set([
      ...(fastSessionModel ? [fastSessionModel] : []),
      preferred,
      DEFAULT_GEMINI_MODEL,
      ...staticGemini3,
      ...discoveredGemini3,
      ...staticGemma3,
      ...discoveredGemma3,
    ])
  ).filter((name) => isEligibleTextGeminiModel(name));

  const payload: Record<string, unknown> = {
    contents: buildUniversalContents(prompt, options),
  };

  if (options.generationConfig) {
    const safeGenConfig: Record<string, unknown> = {};
    if (typeof options.generationConfig.temperature === 'number') {
      safeGenConfig.temperature = options.generationConfig.temperature;
    }
    if (typeof options.generationConfig.maxOutputTokens === 'number') {
      safeGenConfig.maxOutputTokens = options.generationConfig.maxOutputTokens;
    }
    if (Object.keys(safeGenConfig).length > 0) {
      payload.generationConfig = safeGenConfig;
    }
  }

  let firstErrorMessage = '';
  let retriedPrimaryModel = false;

  for (let i = 0; i < candidateModels.length; i++) {
    if (options.signal?.aborted) {
      throw new DOMException('Requête annulée.', 'AbortError');
    }

    const model = candidateModels[i];
    const attemptController = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      attemptController.abort('timeout');
    }, timeoutMs);

    const onExternalAbort = () => {
      attemptController.abort('external');
    };
    options.signal?.addEventListener('abort', onExternalAbort, {once: true});

    try {
      const response = await fetch(
        `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: attemptController.signal,
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

        if (!firstErrorMessage) {
          firstErrorMessage = `${model} : ${apiMessage}`;
        }

        if (
          model === DEFAULT_GEMINI_MODEL &&
          !retriedPrimaryModel &&
          isTransientHighDemandFailure(response.status, apiMessage)
        ) {
          retriedPrimaryModel = true;
          options.onStatus?.(
            `Modèle saturé, nouvelle tentative rapide sur ${model}...`
          );
          await abortableSleep(PRIMARY_TRANSIENT_RETRY_DELAY_MS, options.signal);
          i--;
          continue;
        }

        if (isRetryableModelFailure(response.status, apiMessage)) {
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
        if (!firstErrorMessage) {
          firstErrorMessage = `${model} : réponse vide`;
        }
        if (i < candidateModels.length - 1) {
          options.onStatus?.(
            'Modèle saturé, bascule automatique sur un modèle disponible...'
          );
          continue;
        }
        throw new GeminiAllModelsUnavailableError(firstErrorMessage);
      }

      saveSessionFastModel(model);
      return {text, modelUsed: model};
    } catch (err) {
      if (options.signal?.aborted) {
        throw new DOMException('Requête annulée.', 'AbortError');
      }

      if (timedOut || (err instanceof DOMException && err.name === 'AbortError')) {
        if (!firstErrorMessage) {
          firstErrorMessage = `${model} : délai dépassé (${Math.round(timeoutMs / 1000)}s)`;
        }
        if (i < candidateModels.length - 1) {
          options.onStatus?.(
            'Modèle saturé, bascule automatique sur un modèle disponible...'
          );
        }
        continue;
      }

      if (
        err instanceof Error &&
        err.message.includes('Clé API Gemini invalide')
      ) {
        throw err;
      }

      if (err instanceof TypeError) {
        throw new GeminiAllModelsUnavailableError(
          'Connexion réseau indisponible pour contacter les serveurs Google Gemini.'
        );
      }

      const msg = err instanceof Error ? err.message : String(err);
      if (!firstErrorMessage) {
        firstErrorMessage = `${model} : ${msg}`;
      }
      if (isRetryableModelFailure(0, msg)) {
        if (i < candidateModels.length - 1) {
          options.onStatus?.(
            'Modèle saturé, bascule automatique sur un modèle disponible...'
          );
        }
        continue;
      }

      throw err;
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw new GeminiAllModelsUnavailableError(
    firstErrorMessage
      ? `Tous les modèles sont indisponibles (${firstErrorMessage}).`
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
    `FORMAT DE SORTIE STRICT : Réponds UNIQUEMENT avec un objet JSON valide sans aucun texte avant ou après, suivant exactement cette structure :`,
    `{"questions":[{"question":"...","type":"qcm","options":["...","...","...","..."],"reponseCorrecte":"...","explication":"...","fichierSource":"..."}]}`,
    ``,
    contextBlock,
  ].join('\n');

  const {text: rawResponse, modelUsed} = await appelerGeminiAvecSecours(prompt, {
    signal,
    onStatus,
    timeoutMs: QUIZ_REQUEST_TIMEOUT_MS,
    generationConfig: {
      temperature: 0.35,
    },
  });

  let parsed: {questions?: unknown};
  try {
    const cleanedText = rawResponse
      .replace(/```json\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    const jsonMatch = cleanedText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    const jsonPayload = jsonMatch ? jsonMatch[1] : cleanedText;
    const rawParsed = JSON.parse(jsonPayload) as unknown;
    parsed = Array.isArray(rawParsed)
      ? {questions: rawParsed}
      : (rawParsed as {questions?: unknown});
  } catch {
    throw new Error('Réponse JSON du quiz invalide retournée par le modèle.');
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

export interface DocumentExplanationContext {
  documentIntro?: string;
  contextBefore?: string;
  contextAfter?: string;
}

export async function askGeminiSelectionExplain(params: {
  selectedText: string;
  courseContext: {
    displayTitle: string;
    fileName: string;
    subject: string;
    professor: string;
  };
  documentContext?: DocumentExplanationContext;
  history: GeminiChatTurn[];
  followUpQuestion?: string;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}): Promise<GeminiCallResult> {
  const {
    selectedText,
    courseContext,
    documentContext,
    history,
    followUpQuestion,
    signal,
    onStatus,
  } = params;

  const systemLines = [
    `Tu es un assistant universitaire. Explique uniquement le terme ou passage sélectionné dans le cadre précis de la matière et de l'extrait de cours fournis ci-dessous. Ignore totalement les définitions grand public ou issues d'autres disciplines en cas d'homonymie.`,
    ``,
    `=== MÉTADONNÉES DU COURS ===`,
    `- Matière : ${courseContext.subject || 'Non précisée'}`,
    `- Professeur : ${courseContext.professor || 'Non précisé'}`,
    `- Titre du fichier : ${courseContext.displayTitle} (${courseContext.fileName})`,
  ];

  if (documentContext?.documentIntro?.trim()) {
    systemLines.push(
      ``,
      `=== THÈME GÉNÉRAL DU DOCUMENT (500 premiers caractères) ===`,
      documentContext.documentIntro.trim()
    );
  }

  const hasWindow =
    Boolean(documentContext?.contextBefore?.trim()) ||
    Boolean(documentContext?.contextAfter?.trim());

  if (hasWindow) {
    const before = documentContext?.contextBefore?.trim();
    const after = documentContext?.contextAfter?.trim();
    systemLines.push(
      ``,
      `=== EXTRAIT DE COURS AUTOUR DU PASSAGE SÉLECTIONNÉ ===`,
      `${before ? `[…] ${before} ` : ''}<<< ${selectedText} >>>${after ? ` ${after} […]` : ''}`
    );
  } else {
    systemLines.push(
      ``,
      `=== PASSAGE SÉLECTIONNÉ ===`,
      `« ${selectedText} »`
    );
  }

  systemLines.push(
    ``,
    `=== FORMAT DE RÉPONSE ATTENDU ===`,
    `Donne une réponse courte, rigoureuse et strictement ancrée dans ce document de cours, structurée exactement en 3 points :`,
    `- **Définition dans ce cours** : définition précise du terme ou concept dans le contexte de cette matière.`,
    `- **Mécanisme / rôle clé** : fonctionnement, propriétés ou rôle essentiel décrit dans le cours.`,
    `- **Lien avec le passage sélectionné** : explication concrète du sens et de la portée du passage sélectionné dans cet extrait.`,
    `Pour toute question de suivi, reste strictement dans le cadre de ce même cours et de ce contexte.`
  );

  const systemText = systemLines.join('\n');

  const contents: Array<{role: 'user' | 'model'; parts: Array<{text: string}>}> = [];
  const initialUserPrompt = `Explique le passage ou terme sélectionné « ${selectedText} » strictement dans le cadre de ce cours de ${courseContext.subject || 'cette matière'}.`;

  if (history.length === 0) {
    contents.push({
      role: 'user',
      parts: [{text: `${systemText}\n\n${initialUserPrompt}`}],
    });
  } else {
    history.forEach((turn, idx) => {
      contents.push({
        role: turn.role,
        parts: [
          {
            text:
              idx === 0 && turn.role === 'user'
                ? `${systemText}\n\n${turn.text}`
                : turn.text,
          },
        ],
      });
    });
    if (followUpQuestion?.trim()) {
      contents.push({
        role: 'user',
        parts: [{text: followUpQuestion.trim()}],
      });
    }
  }

  return appelerGeminiAvecSecours(followUpQuestion?.trim() || initialUserPrompt, {
    contents,
    generationConfig: {
      temperature: 0.3,
    },
    timeoutMs: EXPLAIN_REQUEST_TIMEOUT_MS,
    signal,
    onStatus,
  });
}
