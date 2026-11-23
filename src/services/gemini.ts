import type {
  GeminiChatTurn,
  QuizFormatPreference,
  QuizQuestion,
} from '../types/course';

const GEMINI_API_KEY_STORAGE_KEY = 'foliocours_gemini_api_key';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export class GeminiMissingKeyError extends Error {
  constructor() {
    super(
      'Aucune clé API Google Gemini configurée. Renseignez-la dans Paramètres → Clé API Google Gemini.'
    );
    this.name = 'GeminiMissingKeyError';
  }
}

export function isGeminiMissingKeyError(err: unknown): boolean {
  return err instanceof GeminiMissingKeyError;
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

async function callGeminiGenerateContent(
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  const apiKey = getEffectiveGeminiApiKey();
  if (!apiKey) {
    throw new GeminiMissingKeyError();
  }

  const response = await fetch(
    `${GEMINI_GENERATE_URL}?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    }
  );

  let data: GeminiGenerateResponse | null = null;
  try {
    data = (await response.json()) as GeminiGenerateResponse;
  } catch {
    // non-JSON response
  }

  if (!response.ok) {
    const apiMessage = data?.error?.message?.trim();
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      if (apiMessage && /api key|expired|invalid|permission/i.test(apiMessage)) {
        throw new Error(
          `Clé API Gemini invalide ou refusée (${apiMessage}). Vérifiez votre clé dans Paramètres.`
        );
      }
    }
    throw new Error(
      apiMessage || `Erreur API Gemini (HTTP ${response.status}).`
    );
  }

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini n’a renvoyé aucune réponse exploitable.');
  }

  return text;
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
}): Promise<QuizQuestion[]> {
  const {folderTitle, questionCount, format, excerpts, signal} = params;
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

  const rawJson = await callGeminiGenerateContent(
    {
      contents: [
        {
          role: 'user',
          parts: [{text: prompt}],
        },
      ],
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
    },
    signal
  );

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

  return sanitized;
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
}): Promise<string> {
  const {selectedText, courseContext, history, followUpQuestion, signal} = params;

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

  if (history.length === 0) {
    contents.push({
      role: 'user',
      parts: [
        {
          text: `Explique clairement ce passage ou terme dans le contexte de mon cours de ${courseContext.subject} :\n\n« ${selectedText} »`,
        },
      ],
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

  return callGeminiGenerateContent(
    {
      systemInstruction: {
        parts: [{text: systemText}],
      },
      contents,
      generationConfig: {
        temperature: 0.4,
      },
    },
    signal
  );
}
