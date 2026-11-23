import React, {useEffect, useRef, useState} from 'react';
import {
  AlertCircle,
  Loader2,
  Search,
  Send,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  CourseDocument,
  GeminiChatTurn,
  SearchResult,
  SortRule,
  TitleFormatSettings,
} from '../types/course';
import {findHighlightRanges} from '../services/db';
import {
  DEFAULT_TITLE_FORMAT_SETTINGS,
  formatCourseDisplayTitle,
} from '../services/parser';
import {FileFormatBadge, FileFormatIcon} from './FileFormatBadge';

export type AssistantDrawerMode = 'explain' | 'search';

interface ReaderAssistantDrawerProps {
  isOpen: boolean;
  drawerMode: AssistantDrawerMode;
  selectedText: string;
  // Explain (AI)
  chatHistory: GeminiChatTurn[];
  isExplaining: boolean;
  explainError: string | null;
  isMissingApiKey: boolean;
  onAskFollowUp: (question: string) => void;
  onSwitchMode: (mode: AssistantDrawerMode) => void;
  onOpenSettings?: () => void;
  // Search in courses
  searchResults: SearchResult[];
  isSearching: boolean;
  allDocuments: CourseDocument[];
  titleFormat?: TitleFormatSettings;
  rules?: SortRule[];
  onSelectSearchResult?: (doc: CourseDocument, page: number, query: string) => void;
  onClose: () => void;
}

function renderInlineFormatting(line: string, keyPrefix: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(
        <strong key={`${keyPrefix}-b-${idx++}`} className="font-semibold text-slate-50">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code
          key={`${keyPrefix}-c-${idx++}`}
          className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[11px] text-amber-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    tokens.push(line.slice(lastIndex));
  }
  return tokens.length > 0 ? tokens : line;
}

function SafeAiFormattedText({text}: {text: string}) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let blockKey = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const current = listItems;
    listItems = [];
    blocks.push(
      <ul key={`ul-${blockKey++}`} className="list-disc pl-4 space-y-1 text-slate-200">
        {current.map((item, i) => (
          <li key={i} className="leading-relaxed">
            {renderInlineFormatting(item, `li-${blockKey}-${i}`)}
          </li>
        ))}
      </ul>
    );
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    if (/^#{1,4}\s+/.test(trimmed)) {
      flushList();
      const headingText = trimmed.replace(/^#{1,4}\s+/, '');
      blocks.push(
        <p key={`h-${blockKey++}`} className="font-semibold text-amber-300 pt-1">
          {renderInlineFormatting(headingText, `h-${blockKey}`)}
        </p>
      );
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*•]\s+/, ''));
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^\d+\.\s+/, ''));
      continue;
    }

    flushList();
    blocks.push(
      <p key={`p-${blockKey++}`} className="text-slate-200 leading-relaxed">
        {renderInlineFormatting(trimmed, `p-${blockKey}`)}
      </p>
    );
  }

  flushList();

  return <div className="space-y-2 text-xs">{blocks}</div>;
}

function HighlightedSearchSnippet({text, query}: {text: string; query: string}) {
  const ranges = findHighlightRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const range of ranges) {
    if (range.start < lastIndex) continue;
    if (range.start > lastIndex) {
      parts.push(text.slice(lastIndex, range.start));
    }
    parts.push(
      <mark key={key++} className="search-highlight">
        {text.slice(range.start, range.end)}
      </mark>
    );
    lastIndex = range.end;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

export const ReaderAssistantDrawer: React.FC<ReaderAssistantDrawerProps> = ({
  isOpen,
  drawerMode,
  selectedText,
  chatHistory,
  isExplaining,
  explainError,
  isMissingApiKey,
  onAskFollowUp,
  onSwitchMode,
  onOpenSettings,
  searchResults,
  isSearching,
  allDocuments,
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
  rules,
  onSelectSearchResult,
  onClose,
}) => {
  const [followUpInput, setFollowUpInput] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setFollowUpInput('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (drawerMode === 'explain' && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [chatHistory, isExplaining, drawerMode]);

  if (!isOpen) return null;

  const handleSubmitFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = followUpInput.trim();
    if (!trimmed || isExplaining) return;
    setFollowUpInput('');
    onAskFollowUp(trimmed);
  };

  return (
    <aside
      aria-label={
        drawerMode === 'explain'
          ? 'Explication Gemini'
          : 'Recherche dans mes cours'
      }
      className="fixed inset-x-0 bottom-0 z-40 max-h-[55vh] rounded-t-2xl border-t border-slate-800 bg-[#0F172A] shadow-2xl flex flex-col min-h-0 md:static md:inset-auto md:z-auto md:max-h-none md:rounded-none md:border-t-0 md:border-l md:w-80 xl:w-96 md:shrink-0 md:shadow-none"
    >
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
        <div className="inline-flex items-center rounded-lg border border-slate-800 bg-[#0B1120] p-0.5">
          <button
            type="button"
            onClick={() => onSwitchMode('explain')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
              drawerMode === 'explain'
                ? 'bg-slate-800 text-amber-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Expliquer (IA)</span>
          </button>
          <button
            type="button"
            onClick={() => onSwitchMode('search')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
              drawerMode === 'search'
                ? 'bg-slate-800 text-amber-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Mes cours</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le panneau latéral"
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Selected quote banner */}
      <div className="px-3.5 py-2 border-b border-slate-800/80 bg-[#0B1120]/70 shrink-0">
        <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
          Sélection
        </p>
        <p className="text-xs text-amber-200/95 italic line-clamp-2 leading-snug">
          « {selectedText} »
        </p>
      </div>

      {/* Body */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto p-3.5 space-y-3 min-h-0">
        {drawerMode === 'explain' ? (
          <>
            {chatHistory.map((turn, idx) => {
              if (turn.role === 'user' && idx === 0) {
                return null;
              }
              return turn.role === 'user' ? (
                <div
                  key={idx}
                  className="ml-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 leading-relaxed"
                >
                  {turn.text}
                </div>
              ) : (
                <div
                  key={idx}
                  className="rounded-lg border border-slate-800 bg-[#0B1120] p-3"
                >
                  <SafeAiFormattedText text={turn.text} />
                </div>
              );
            })}

            {isExplaining && (
              <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3 flex items-center gap-2 text-xs text-slate-300">
                <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                <span>Gemini analyse ce passage…</span>
              </div>
            )}

            {explainError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{explainError}</p>
                </div>
                {isMissingApiKey && onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Ouvrir Paramètres</span>
                  </button>
                )}
              </div>
            )}
          </>
        ) : isSearching ? (
          <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
            <span>Recherche dans vos cours indexés…</span>
          </div>
        ) : searchResults.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 space-y-1">
            <p>Aucune correspondance trouvée dans vos cours indexés.</p>
            <p className="text-[11px] text-slate-500">
              Astuce : essayez avec un mot-clé plus court si cette expression est longue.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] font-mono tabular-nums text-slate-400">
              {searchResults.length} occurrence{searchResults.length > 1 ? 's' : ''} trouvée
              {searchResults.length > 1 ? 's' : ''}
            </p>
            {searchResults.map((hit, idx) => {
              const matchingDoc = allDocuments.find(
                (d) => d.relativePath === hit.docPath
              );
              const displayFileName = matchingDoc?.name ?? hit.fileName;
              const displaySubject = matchingDoc?.subject ?? hit.subject;
              const displayProfessor = matchingDoc?.professor ?? hit.professor;
              return (
                <button
                  key={`${hit.docPath}-${hit.pageNumber}-${idx}`}
                  type="button"
                  disabled={!matchingDoc || !onSelectSearchResult}
                  onClick={() => {
                    if (matchingDoc && onSelectSearchResult) {
                      onSelectSearchResult(matchingDoc, hit.pageNumber, selectedText);
                    }
                  }}
                  className="w-full text-left rounded-lg border border-slate-800 bg-[#0B1120] p-2.5 hover:border-amber-500/40 hover:bg-slate-800/40 transition-colors space-y-1 cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <FileFormatIcon
                        fileName={displayFileName}
                        className="w-3 h-3 shrink-0"
                      />
                      <span className="text-xs font-semibold text-amber-300 truncate">
                        {formatCourseDisplayTitle(displayFileName, titleFormat, {
                          subject: displaySubject,
                          professor: displayProfessor,
                          rules,
                        })}
                      </span>
                      <FileFormatBadge fileName={displayFileName} />
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                      {displayFileName.toLowerCase().endsWith('.pdf')
                        ? `p. ${hit.pageNumber}`
                        : `s. ${hit.pageNumber}`}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {displaySubject} / {displayProfessor}
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">
                    <HighlightedSearchSnippet text={hit.snippet} query={selectedText} />
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Follow-up Question Input for Explain AI mode */}
      {drawerMode === 'explain' && (
        <form
          onSubmit={handleSubmitFollowUp}
          className="p-3 border-t border-slate-800 bg-[#0B1120] flex items-center gap-2 shrink-0 pb-safe"
        >
          <input
            type="text"
            value={followUpInput}
            onChange={(e) => setFollowUpInput(e.target.value)}
            disabled={isExplaining}
            placeholder="Poser une question de suivi…"
            className="flex-1 min-w-0 rounded-lg border border-slate-800 bg-[#0F172A] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!followUpInput.trim() || isExplaining}
            aria-label="Envoyer la question"
            className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 cursor-pointer shrink-0 inline-flex items-center justify-center"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      )}
    </aside>
  );
};
