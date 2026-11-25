import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  Settings,
  Sparkles,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AppMode,
  CloudSearchIndexPayload,
  CourseDocument,
  OpenQuizAnswerStatus,
  QuizFolderTarget,
  QuizFormatPreference,
  QuizQuestion,
  SortRule,
  TitleFormatSettings,
} from '../types/course';
import {
  DEFAULT_TITLE_FORMAT_SETTINGS,
  formatCourseDisplayTitle,
} from '../services/parser';
import {
  evaluateOpenQuizAnswer,
  generateFolderQuiz,
  getEffectiveGeminiApiKey,
  getSavedGeminiModel,
  isGeminiAllModelsUnavailableError,
  isGeminiMissingKeyError,
} from '../services/gemini';
import {generateOfflineFolderQuiz} from '../services/offlineQuiz';
import {
  collectFolderContentForQuiz,
  type QuizContentProgress,
} from '../services/quizContent';
import {normaliserTexte} from '../services/db';
import {FileFormatBadge, FileFormatIcon} from './FileFormatBadge';

interface FolderQuizModalProps {
  target: QuizFolderTarget | null;
  mode: AppMode;
  cloudIndex: CloudSearchIndexPayload | null;
  titleFormat?: TitleFormatSettings;
  rules?: SortRule[];
  onOpenSettings: () => void;
  onClose: () => void;
}

type QuizModalPhase = 'config' | 'loading' | 'quiz' | 'summary';

interface QuestionAnswerState {
  selectedOption?: string;
  openInput?: string;
  submitted: boolean;
  isCorrect: boolean | null;
  points: number;
  statut?: OpenQuizAnswerStatus;
  retour?: string;
  evaluatedOffline?: boolean;
}

function formatQuizScore(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace('.', ',');
}

function getParentDirKey(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').trim();
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash).toLowerCase();
}

function getNormalizedBaseName(fileName: string): string {
  const withoutExt = fileName.replace(/\.(pdf|docx|odt)$/i, '');
  return withoutExt.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isPdfDoc(doc: CourseDocument): boolean {
  return doc.format === 'pdf' || doc.name.toLowerCase().endsWith('.pdf');
}

function isOfficeDoc(doc: CourseDocument): boolean {
  const lower = doc.name.toLowerCase();
  return (
    doc.format === 'docx' ||
    doc.format === 'odt' ||
    lower.endsWith('.docx') ||
    lower.endsWith('.odt')
  );
}

function computeDeduplicatedDocuments(documents: CourseDocument[]): CourseDocument[] {
  const pdfKeys = new Set<string>();
  for (const doc of documents) {
    if (isPdfDoc(doc)) {
      pdfKeys.add(`${getParentDirKey(doc.relativePath)}::${getNormalizedBaseName(doc.name)}`);
    }
  }
  return documents.filter((doc) => {
    if (!isOfficeDoc(doc)) return true;
    const key = `${getParentDirKey(doc.relativePath)}::${getNormalizedBaseName(doc.name)}`;
    return !pdfKeys.has(key);
  });
}

export const FolderQuizModal: React.FC<FolderQuizModalProps> = ({
  target,
  mode,
  cloudIndex,
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
  rules,
  onOpenSettings,
  onClose,
}) => {
  const [phase, setPhase] = useState<QuizModalPhase>('config');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [showOfficeDuplicates, setShowOfficeDuplicates] = useState(false);
  const [questionCount, setQuestionCount] = useState<5 | 10 | 15>(10);
  const [quizFormat, setQuizFormat] = useState<QuizFormatPreference>('mixte');

  const [loadingProgress, setLoadingProgress] = useState<QuizContentProgress | null>(null);
  const [loadingStepLabel, setLoadingStepLabel] = useState('');
  const [fallbackStatusMessage, setFallbackStatusMessage] = useState<string | null>(null);
  const [usedModelLabel, setUsedModelLabel] = useState<string | null>(null);
  const [quizGeneratorModel, setQuizGeneratorModel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMissingKeyErr, setIsMissingKeyErr] = useState(false);
  const [offerOfflineFallback, setOfferOfflineFallback] = useState(false);

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, QuestionAnswerState>>({});
  const [openDraft, setOpenDraft] = useState('');
  const [evaluatingIdx, setEvaluatingIdx] = useState<number | null>(null);
  const [evalStatusMessage, setEvalStatusMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const openEvalAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!target) {
      abortRef.current?.abort();
      abortRef.current = null;
      openEvalAbortRef.current?.abort();
      openEvalAbortRef.current = null;
      return;
    }

    const dedup = computeDeduplicatedDocuments(target.documents);
    setPhase('config');
    setShowOfficeDuplicates(false);
    setSelectedPaths(new Set(dedup.map((d) => d.relativePath)));
    setErrorMessage(null);
    setIsMissingKeyErr(false);
    setOfferOfflineFallback(false);
    setFallbackStatusMessage(null);
    setUsedModelLabel(null);
    setQuizGeneratorModel(null);
    setLoadingProgress(null);
    setLoadingStepLabel('');
    setQuestions([]);
    setCurrentIdx(0);
    setAnswers({});
    setOpenDraft('');
    setEvaluatingIdx(null);
    setEvalStatusMessage(null);
  }, [target]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      openEvalAbortRef.current?.abort();
    };
  }, []);

  const deduplicatedDocuments = useMemo(() => {
    if (!target) return [];
    return computeDeduplicatedDocuments(target.documents);
  }, [target]);

  const hiddenDuplicateCount = target
    ? target.documents.length - deduplicatedDocuments.length
    : 0;

  const visibleDocuments = useMemo(() => {
    if (!target) return [];
    return showOfficeDuplicates ? target.documents : deduplicatedDocuments;
  }, [target, showOfficeDuplicates, deduplicatedDocuments]);

  const selectedDocs = useMemo(() => {
    return visibleDocuments.filter((d) => selectedPaths.has(d.relativePath));
  }, [visibleDocuments, selectedPaths]);

  if (!target) return null;

  const hasApiKey = getEffectiveGeminiApiKey().length > 0;
  const allChecked =
    visibleDocuments.length > 0 &&
    visibleDocuments.every((d) => selectedPaths.has(d.relativePath));

  const toggleDoc = (relativePath: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  };

  const toggleAllDocs = () => {
    if (allChecked) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(visibleDocuments.map((d) => d.relativePath)));
    }
  };

  const handleGenerateQuiz = async () => {
    if (selectedDocs.length === 0) return;

    if (!getEffectiveGeminiApiKey()) {
      setIsMissingKeyErr(true);
      setOfferOfflineFallback(true);
      setErrorMessage(
        'Aucune clé API Google Gemini configurée. Collez votre clé dans Paramètres → Clé API Google Gemini, ou utilisez le quiz rapide hors-ligne.'
      );
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('loading');
    setErrorMessage(null);
    setIsMissingKeyErr(false);
    setOfferOfflineFallback(false);
    setFallbackStatusMessage(null);
    setUsedModelLabel(null);
    setQuizGeneratorModel(null);
    setLoadingProgress(null);
    setLoadingStepLabel('Préparation des cours du dossier…');

    try {
      const contentRes = await collectFolderContentForQuiz(selectedDocs, {
        mode,
        cloudIndex,
        signal: controller.signal,
        onProgress: (p) => {
          setLoadingProgress(p);
          setLoadingStepLabel(
            p.phase === 'index'
              ? `Lecture depuis l’index (${p.current}/${p.total})`
              : `Extraction du texte (${p.current}/${p.total})`
          );
        },
      });

      if (controller.signal.aborted) return;

      if (contentRes.excerpts.length === 0) {
        throw new Error(
          'Aucun texte exploitable n’a pu être extrait des fichiers cochés (PDF scannés ou fichiers vides).'
        );
      }

      setLoadingProgress(null);
      setLoadingStepLabel(
        `Génération de ${questionCount} questions avec ${getSavedGeminiModel()}…`
      );

      const {questions: generated, modelUsed} = await generateFolderQuiz({
        folderTitle: target.title,
        questionCount,
        format: quizFormat,
        excerpts: contentRes.excerpts,
        signal: controller.signal,
        onStatus: (statusMsg) => {
          setFallbackStatusMessage(statusMsg);
        },
      });

      if (controller.signal.aborted) return;

      setQuestions(generated);
      setQuizGeneratorModel(modelUsed);
      setUsedModelLabel(`Répondu via ${modelUsed}`);
      setFallbackStatusMessage(null);
      setCurrentIdx(0);
      setAnswers({});
      setOpenDraft('');
      setPhase('quiz');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase('config');
        return;
      }
      setIsMissingKeyErr(isGeminiMissingKeyError(err));
      setOfferOfflineFallback(isGeminiAllModelsUnavailableError(err));
      setFallbackStatusMessage(null);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Impossible de générer le quiz pour ce dossier.'
      );
      setPhase('config');
    }
  };

  const handleGenerateOfflineQuiz = async () => {
    if (selectedDocs.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('loading');
    setErrorMessage(null);
    setIsMissingKeyErr(false);
    setOfferOfflineFallback(false);
    setFallbackStatusMessage(null);
    setUsedModelLabel(null);
    setLoadingProgress(null);
    setLoadingStepLabel('Analyse locale des définitions et notions clés…');

    try {
      const contentRes = await collectFolderContentForQuiz(selectedDocs, {
        mode,
        cloudIndex,
        signal: controller.signal,
        onProgress: (p) => {
          setLoadingProgress(p);
          setLoadingStepLabel(
            p.phase === 'index'
              ? `Lecture depuis l’index (${p.current}/${p.total})`
              : `Extraction locale du texte (${p.current}/${p.total})`
          );
        },
      });

      if (controller.signal.aborted) return;

      if (contentRes.excerpts.length === 0) {
        throw new Error(
          'Aucun texte exploitable n’a pu être extrait des fichiers cochés (PDF scannés ou fichiers vides).'
        );
      }

      const generated = generateOfflineFolderQuiz({
        excerpts: contentRes.excerpts,
        questionCount,
        format: quizFormat,
      });

      setQuestions(generated);
      setQuizGeneratorModel(null);
      setUsedModelLabel('Mode hors-ligne (sans IA)');
      setCurrentIdx(0);
      setAnswers({});
      setOpenDraft('');
      setPhase('quiz');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase('config');
        return;
      }
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Impossible de générer le quiz hors-ligne pour ce dossier.'
      );
      setPhase('config');
    }
  };

  const handleSelectQcmOption = (qIndex: number, option: string) => {
    const q = questions[qIndex];
    if (!q || answers[qIndex]?.submitted) return;
    const isCorrect =
      normaliserTexte(option).trim() === normaliserTexte(q.reponseCorrecte).trim();
    setAnswers((prev) => ({
      ...prev,
      [qIndex]: {
        selectedOption: option,
        submitted: true,
        isCorrect,
        points: isCorrect ? 1 : 0,
        statut: isCorrect ? 'totalement_correcte' : 'incorrecte',
      },
    }));
  };

  const handleSubmitOpenAnswer = async (qIndex: number) => {
    const q = questions[qIndex];
    const trimmed = openDraft.trim();
    if (!q || trimmed.length < 2 || evaluatingIdx !== null || answers[qIndex]?.submitted) {
      return;
    }

    openEvalAbortRef.current?.abort();
    const controller = new AbortController();
    openEvalAbortRef.current = controller;

    setEvaluatingIdx(qIndex);
    setEvalStatusMessage(null);

    try {
      const evaluation = await evaluateOpenQuizAnswer({
        question: q.question,
        expectedAnswer: q.reponseCorrecte,
        referenceExplanation: q.explication,
        userAnswer: trimmed,
        preferredModel: quizGeneratorModel,
        signal: controller.signal,
        onStatus: (msg) => {
          setEvalStatusMessage(msg);
        },
      });

      if (controller.signal.aborted) return;

      setAnswers((prev) => ({
        ...prev,
        [qIndex]: {
          openInput: trimmed,
          submitted: true,
          isCorrect: evaluation.points === 1,
          points: evaluation.points,
          statut: evaluation.statut,
          retour: evaluation.retour,
          evaluatedOffline: evaluation.usedOfflineFallback,
        },
      }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
    } finally {
      if (openEvalAbortRef.current === controller) {
        openEvalAbortRef.current = null;
        setEvaluatingIdx(null);
        setEvalStatusMessage(null);
      }
    }
  };

  const goToQuestion = (nextIdx: number) => {
    if (nextIdx < 0 || nextIdx >= questions.length) return;
    openEvalAbortRef.current?.abort();
    openEvalAbortRef.current = null;
    setEvaluatingIdx(null);
    setEvalStatusMessage(null);
    setCurrentIdx(nextIdx);
    setOpenDraft(answers[nextIdx]?.openInput ?? '');
  };

  const currentQuestion = questions[currentIdx];
  const currentAnswer = answers[currentIdx];

  const answeredCount = Object.values(answers).filter((a) => a.submitted).length;
  const totalScore = Object.values(answers).reduce(
    (sum, a) => sum + (a.submitted ? a.points : 0),
    0
  );
  const missedQuestions = questions.filter((_, idx) => (answers[idx]?.points ?? 0) < 1);

  const handleReplayMissed = () => {
    if (missedQuestions.length === 0) return;
    openEvalAbortRef.current?.abort();
    openEvalAbortRef.current = null;
    setEvaluatingIdx(null);
    setEvalStatusMessage(null);
    setQuestions(missedQuestions);
    setAnswers({});
    setCurrentIdx(0);
    setOpenDraft('');
    setPhase('quiz');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4 backdrop-blur-xs"
      onClick={() => {
        if (phase !== 'loading') {
          openEvalAbortRef.current?.abort();
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-800 bg-[#0F172A] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Brain className="w-4 h-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-sm sm:text-base font-semibold text-slate-100 truncate">
                  Quiz — {target.title}
                </h2>
                {usedModelLabel && (phase === 'quiz' || phase === 'summary') && (
                  <span className="rounded border border-slate-700 bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 shrink-0">
                    {usedModelLabel}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                {phase === 'config'
                  ? `${selectedDocs.length}/${visibleDocuments.length} fichier${
                      visibleDocuments.length > 1 ? 's' : ''
                    } sélectionné${selectedDocs.length > 1 ? 's' : ''}`
                  : phase === 'loading'
                  ? 'Préparation du test de connaissances…'
                  : phase === 'quiz'
                  ? `Question ${currentIdx + 1} sur ${questions.length} · ${formatQuizScore(
                      totalScore
                    )} pt${totalScore > 1 ? 's' : ''}`
                  : `Bilan final : ${formatQuizScore(totalScore)} / ${questions.length}`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              openEvalAbortRef.current?.abort();
              onClose();
            }}
            aria-label="Fermer"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {phase === 'config' && (
            <div className="space-y-5">
              {(!hasApiKey || errorMessage) && (
                <div
                  className={`rounded-lg border p-3.5 text-xs space-y-2.5 ${
                    errorMessage
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                      : 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      {errorMessage ||
                        'Aucune clé API Google Gemini configurée. Renseignez votre clé dans Paramètres pour générer un quiz IA, ou lancez un quiz rapide hors-ligne.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(isMissingKeyErr || !hasApiKey) && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenSettings();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        <span>Ouvrir les Paramètres</span>
                      </button>
                    )}
                    {offerOfflineFallback && selectedDocs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleGenerateOfflineQuiz()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-amber-400 hover:text-amber-200 cursor-pointer"
                      >
                        <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                        <span>Générer un quiz rapide hors-ligne (sans IA)</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* File selection checklist */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-200">
                    Fichiers inclus dans le quiz ({selectedDocs.length}/{visibleDocuments.length})
                  </label>
                  <button
                    type="button"
                    onClick={toggleAllDocs}
                    className="text-xs text-amber-300 hover:text-amber-200 cursor-pointer"
                  >
                    {allChecked ? 'Tout décocher' : 'Tout cocher'}
                  </button>
                </div>

                <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-800 bg-[#0B1120] divide-y divide-slate-800/70">
                  {visibleDocuments.map((doc) => {
                    const checked = selectedPaths.has(doc.relativePath);
                    const displayTitle = formatCourseDisplayTitle(doc.name, titleFormat, {
                      subject: doc.subject,
                      professor: doc.professor,
                      rules,
                    });
                    return (
                      <label
                        key={doc.relativePath}
                        className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-slate-800/40"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDoc(doc.relativePath)}
                          className="accent-amber-500 rounded cursor-pointer shrink-0"
                        />
                        <FileFormatIcon
                          fileName={doc.name}
                          format={doc.format}
                          className="w-3.5 h-3.5 shrink-0"
                        />
                        <span className="flex-1 min-w-0 truncate text-slate-200" title={doc.name}>
                          {displayTitle}
                        </span>
                        <span className="text-[11px] text-slate-500 truncate max-w-[120px] hidden sm:inline">
                          {doc.professor}
                        </span>
                        <FileFormatBadge fileName={doc.name} format={doc.format} />
                      </label>
                    );
                  })}
                </div>

                {(hiddenDuplicateCount > 0 || showOfficeDuplicates) && (
                  <label className="flex items-center gap-2 pt-0.5 text-[11px] text-slate-400 cursor-pointer select-none hover:text-slate-300">
                    <input
                      type="checkbox"
                      checked={showOfficeDuplicates}
                      onChange={(e) => setShowOfficeDuplicates(e.target.checked)}
                      className="accent-amber-500 rounded cursor-pointer shrink-0"
                    />
                    <span>
                      Afficher aussi les doublons Word/LibreOffice (.docx/.odt)
                      {!showOfficeDuplicates && hiddenDuplicateCount > 0
                        ? ` (${hiddenDuplicateCount} masqué${hiddenDuplicateCount > 1 ? 's' : ''})`
                        : ''}
                    </span>
                  </label>
                )}
              </div>

              {/* Count + Format */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-200">
                    Nombre de questions
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {([5, 10, 15] as const).map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setQuestionCount(count)}
                        className={`rounded-lg border py-2 text-xs font-semibold transition-colors cursor-pointer ${
                          questionCount === count
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-slate-800 bg-[#0B1120] text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-200">
                    Format des questions
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        {id: 'qcm', label: 'QCM'},
                        {id: 'ouverte', label: 'Courtes'},
                        {id: 'mixte', label: 'Mixte'},
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setQuizFormat(opt.id)}
                        className={`rounded-lg border py-2 text-xs font-semibold transition-colors cursor-pointer ${
                          quizFormat === opt.id
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-slate-800 bg-[#0B1120] text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {phase === 'loading' && (
            <div className="py-12 px-4 flex flex-col items-center text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
              </div>
              <div className="space-y-1.5 max-w-md">
                <p className="text-sm font-medium text-slate-100">
                  {loadingStepLabel || 'Génération du quiz en cours…'}
                </p>
                {fallbackStatusMessage && (
                  <p className="text-xs text-amber-300/90 leading-snug">
                    {fallbackStatusMessage}
                  </p>
                )}
                {loadingProgress && (
                  <p className="text-xs text-slate-400 truncate">
                    {loadingProgress.fileName}
                  </p>
                )}
              </div>
              {loadingProgress && loadingProgress.total > 0 && (
                <div className="w-full max-w-xs h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-150"
                    style={{
                      width: `${Math.round(
                        (loadingProgress.current / loadingProgress.total) * 100
                      )}%`,
                    }}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="rounded-lg border border-slate-700 px-3.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Annuler
              </button>
            </div>
          )}

          {phase === 'quiz' && currentQuestion && (
            <div className="space-y-5">
              {/* Stepper Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                {questions.map((_, idx) => {
                  const ans = answers[idx];
                  const isCurrent = idx === currentIdx;
                  let style =
                    'border-slate-800 bg-[#0B1120] text-slate-400 hover:border-slate-700';
                  if (ans?.submitted) {
                    if (ans.points === 1) {
                      style =
                        'border-emerald-500/50 bg-emerald-500/15 text-emerald-300';
                    } else if (ans.points === 0.5) {
                      style = 'border-amber-500/60 bg-amber-500/15 text-amber-300';
                    } else {
                      style = 'border-rose-500/50 bg-rose-500/15 text-rose-300';
                    }
                  }
                  if (isCurrent) {
                    style += ' ring-2 ring-amber-400/70';
                  }
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => goToQuestion(idx)}
                      className={`w-7 h-7 rounded-md border font-mono tabular-nums text-xs font-medium cursor-pointer transition-all ${style}`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>

              {/* Question Card */}
              <div className="rounded-xl border border-slate-800 bg-[#0B1120] p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-amber-300">
                    <Sparkles className="w-3 h-3" />
                    <span>
                      {currentQuestion.type === 'qcm'
                        ? 'Choix multiple (QCM)'
                        : 'Question courte'}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 truncate max-w-[260px]">
                    <FileText className="w-3 h-3 shrink-0" />
                    <span className="truncate" title={currentQuestion.fichierSource}>
                      {currentQuestion.fichierSource}
                    </span>
                  </span>
                </div>

                <p className="text-sm sm:text-[15px] font-medium text-slate-100 leading-relaxed">
                  {currentQuestion.question}
                </p>

                {currentQuestion.type === 'qcm' ? (
                  <div className="space-y-2">
                    {currentQuestion.options.map((opt, optIdx) => {
                      const letter = String.fromCharCode(65 + optIdx);
                      const isSubmitted = !!currentAnswer?.submitted;
                      const isSelected = currentAnswer?.selectedOption === opt;
                      const isTargetCorrect =
                        normaliserTexte(opt).trim() ===
                        normaliserTexte(currentQuestion.reponseCorrecte).trim();

                      let btnStyle =
                        'border-slate-800 bg-[#0F172A] text-slate-200 hover:border-amber-500/50 hover:bg-slate-800/70';
                      if (isSubmitted) {
                        if (isTargetCorrect) {
                          btnStyle =
                            'border-emerald-500/70 bg-emerald-500/15 text-emerald-200';
                        } else if (isSelected) {
                          btnStyle = 'border-rose-500/70 bg-rose-500/15 text-rose-200';
                        } else {
                          btnStyle = 'border-slate-800/70 bg-[#0F172A]/60 text-slate-500';
                        }
                      }

                      return (
                        <button
                          key={optIdx}
                          type="button"
                          disabled={isSubmitted}
                          onClick={() => handleSelectQcmOption(currentIdx, opt)}
                          className={`w-full rounded-lg border px-3.5 py-2.5 text-left text-xs sm:text-sm flex items-start gap-3 transition-colors ${
                            isSubmitted ? 'cursor-default' : 'cursor-pointer'
                          } ${btnStyle}`}
                        >
                          <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 shrink-0 mt-0.5">
                            {letter}
                          </span>
                          <span className="flex-1 leading-relaxed">{opt}</span>
                          {isSubmitted && isTargetCorrect && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          )}
                          {isSubmitted && isSelected && !isTargetCorrect && (
                            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <textarea
                      rows={3}
                      disabled={!!currentAnswer?.submitted || evaluatingIdx === currentIdx}
                      value={currentAnswer?.submitted ? currentAnswer.openInput ?? '' : openDraft}
                      onChange={(e) => setOpenDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' &&
                          (e.ctrlKey || e.metaKey || !e.shiftKey)
                        ) {
                          e.preventDefault();
                          if (
                            !currentAnswer?.submitted &&
                            evaluatingIdx !== currentIdx &&
                            openDraft.trim().length >= 2
                          ) {
                            void handleSubmitOpenAnswer(currentIdx);
                          }
                        }
                      }}
                      placeholder="Rédigez votre réponse libre ici (idée principale et notions clés)…"
                      className="w-full rounded-lg border border-slate-800 bg-[#0F172A] p-3 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none disabled:opacity-75 resize-y"
                    />
                    {!currentAnswer?.submitted && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={
                            openDraft.trim().length < 2 || evaluatingIdx === currentIdx
                          }
                          onClick={() => void handleSubmitOpenAnswer(currentIdx)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {evaluatingIdx === currentIdx ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Analyse de ta réponse...</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Valider ma réponse</span>
                            </>
                          )}
                        </button>
                        <span className="text-[11px] text-slate-400">
                          {evaluatingIdx === currentIdx
                            ? evalStatusMessage || 'Évaluation sémantique en cours…'
                            : 'Entrée ou Ctrl + Entrée pour valider'}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Immediate Correction & Explanation */}
                {currentAnswer?.submitted &&
                  (currentQuestion.type === 'ouverte' ? (
                    (() => {
                      const statut: OpenQuizAnswerStatus =
                        currentAnswer.statut ??
                        (currentAnswer.points === 1
                          ? 'totalement_correcte'
                          : currentAnswer.points === 0.5
                          ? 'partiellement_correcte'
                          : 'incorrecte');

                      const containerClass =
                        statut === 'totalement_correcte'
                          ? 'border-emerald-500/40 bg-emerald-500/10'
                          : statut === 'partiellement_correcte'
                          ? 'border-amber-500/45 bg-amber-500/10'
                          : 'border-rose-500/40 bg-rose-500/10';

                      const badgeClass =
                        statut === 'totalement_correcte'
                          ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                          : statut === 'partiellement_correcte'
                          ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                          : 'border-rose-500/50 bg-rose-500/20 text-rose-300';

                      const badgeLabel =
                        statut === 'totalement_correcte'
                          ? 'Totalement correcte (+1 pt)'
                          : statut === 'partiellement_correcte'
                          ? 'Partiellement correcte (+0,5 pt)'
                          : 'Incorrecte (0 pt)';

                      return (
                        <div className={`rounded-lg border p-3.5 space-y-3 text-xs ${containerClass}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-semibold ${badgeClass}`}
                            >
                              {statut === 'totalement_correcte' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              ) : statut === 'partiellement_correcte' ? (
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>{badgeLabel}</span>
                            </span>

                            {currentAnswer.evaluatedOffline && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                                <WifiOff className="w-3 h-3 shrink-0" />
                                <span>Comparaison locale hors-ligne</span>
                              </span>
                            )}
                          </div>

                          {currentAnswer.retour && (
                            <p className="text-slate-100 leading-relaxed">
                              {currentAnswer.retour}
                            </p>
                          )}

                          <div className="rounded-md bg-[#0B1120]/85 border border-slate-800 p-3 space-y-2 text-slate-200">
                            <div>
                              <span className="text-[11px] uppercase tracking-wide text-slate-400 block mb-0.5">
                                Réponse attendue de référence
                              </span>
                              <p className="leading-relaxed font-medium text-slate-100">
                                {currentQuestion.reponseCorrecte}
                              </p>
                            </div>
                            <div className="pt-1.5 border-t border-slate-800/80">
                              <span className="text-[11px] uppercase tracking-wide text-slate-400 block mb-0.5">
                                Explication du cours
                              </span>
                              <p className="leading-relaxed text-slate-300">
                                {currentQuestion.explication}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div
                      className={`rounded-lg border p-3.5 space-y-2.5 text-xs ${
                        currentAnswer.isCorrect
                          ? 'border-emerald-500/40 bg-emerald-500/10'
                          : 'border-amber-500/35 bg-amber-500/10'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 font-semibold ${
                            currentAnswer.isCorrect ? 'text-emerald-300' : 'text-amber-300'
                          }`}
                        >
                          {currentAnswer.isCorrect ? (
                            <>
                              <CheckCircle2 className="w-4 h-4" />
                              <span>Bonne réponse</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-4 h-4 text-rose-400" />
                              <span className="text-rose-300">À revoir</span>
                            </>
                          )}
                        </span>
                      </div>

                      <p className="text-slate-200 leading-relaxed">
                        {currentQuestion.explication}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {phase === 'summary' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-800 bg-[#0B1120] p-5 text-center space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-400">
                  Score final
                </p>
                <p className="font-display text-3xl font-bold text-amber-400 tabular-nums">
                  {formatQuizScore(totalScore)} / {questions.length}
                </p>
                <p className="text-xs text-slate-300">
                  {Math.round((totalScore / Math.max(1, questions.length)) * 100)}% de réussite
                  {missedQuestions.length === 0
                    ? ' — Maîtrise parfaite sur cette série !'
                    : ` · ${missedQuestions.length} question${
                        missedQuestions.length > 1 ? 's' : ''
                      } à revoir`}
                </p>
              </div>

              <div className="space-y-2.5">
                {questions.map((q, idx) => {
                  const ans = answers[idx];
                  const pts = ans?.submitted ? ans.points : 0;
                  const isFull = pts === 1;
                  const isPartial = pts === 0.5;
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg border p-3.5 text-xs space-y-1.5 ${
                        isFull
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : isPartial
                          ? 'border-amber-500/35 bg-amber-500/5'
                          : 'border-rose-500/30 bg-rose-500/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-slate-100 leading-snug">
                          {idx + 1}. {q.question}
                        </p>
                        {isFull ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : isPartial ? (
                          <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 shrink-0">
                            <AlertCircle className="w-3 h-3" />
                            <span>+0,5 pt</span>
                          </span>
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        )}
                      </div>
                      {q.type === 'ouverte' && ans?.retour && (
                        <p className="text-slate-200 leading-relaxed">{ans.retour}</p>
                      )}
                      <p className="text-emerald-300">
                        Réponse : <span className="font-medium">{q.reponseCorrecte}</span>
                      </p>
                      <p className="text-slate-300 leading-relaxed">{q.explication}</p>
                      <p className="text-[11px] text-slate-500">
                        Source : {q.fichierSource}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-4 sm:px-5 py-3.5 border-t border-slate-800 bg-[#0B1120] flex flex-wrap items-center justify-between gap-2.5">
          {phase === 'config' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Fermer
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={selectedDocs.length === 0}
                  onClick={() => void handleGenerateOfflineQuiz()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-200 disabled:opacity-45 cursor-pointer"
                >
                  <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Générer un quiz rapide hors-ligne (sans IA)</span>
                </button>
                <button
                  type="button"
                  disabled={selectedDocs.length === 0}
                  onClick={() => void handleGenerateQuiz()}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Générer le quiz</span>
                </button>
              </div>
            </>
          )}

          {phase === 'loading' && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Annuler
              </button>
            </div>
          )}

          {phase === 'quiz' && (
            <>
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => goToQuestion(currentIdx - 1)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Précédente</span>
              </button>

              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                {answeredCount}/{questions.length} répondues
              </span>

              {currentIdx < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => goToQuestion(currentIdx + 1)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
                >
                  <span>Suivante</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPhase('summary')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Voir le bilan</span>
                </button>
              )}
            </>
          )}

          {phase === 'summary' && (
            <>
              <button
                type="button"
                onClick={() => setPhase('config')}
                className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Nouveau quiz
              </button>

              <div className="flex items-center gap-2">
                {missedQuestions.length > 0 && (
                  <button
                    type="button"
                    onClick={handleReplayMissed}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>
                      Rejouer les questions ratées ({missedQuestions.length})
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
