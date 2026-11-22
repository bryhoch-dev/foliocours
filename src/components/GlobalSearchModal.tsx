import React, {useEffect, useRef, useState} from 'react';
import {CornerDownLeft, PanelLeft, Search, X} from 'lucide-react';
import type {
  AppMode,
  CloudSearchIndexPayload,
  CourseDocument,
  SearchResult,
  SortRule,
  TitleFormatSettings,
} from '../types/course';
import {
  DEFAULT_TITLE_FORMAT_SETTINGS,
  formatCourseDisplayTitle,
} from '../services/parser';
import {
  buildAccentInsensitiveRegex,
  searchCloudIndexPayload,
  searchIndexedLibrary,
} from '../services/db';
import {FileFormatBadge, FileFormatIcon} from './FileFormatBadge';

interface GlobalSearchModalProps {
  isOpen: boolean;
  mode: AppMode;
  cloudIndex: CloudSearchIndexPayload | null;
  initialQuery: string;
  documents: CourseDocument[];
  titleFormat?: TitleFormatSettings;
  rules?: SortRule[];
  onClose: () => void;
  onSelectResult: (doc: CourseDocument, page: number, query: string) => void;
  onPinResultsToPanel: (query: string, results: SearchResult[]) => void;
}

function HighlightSnippet({text, query}: {text: string; query: string}) {
  const regex = buildAccentInsensitiveRegex(query);
  if (!regex) return <>{text}</>;

  const globalRegex = new RegExp(regex.source, 'gi');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = globalRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <mark key={key++} className="search-highlight">
        {match[0]}
      </mark>
    );
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) break;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return <>{parts}</>;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  mode,
  cloudIndex,
  initialQuery,
  documents,
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
  rules = [],
  onClose,
  onSelectResult,
  onPinResultsToPanel,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [isOpen, initialQuery]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const hits =
          mode === 'cloud'
            ? searchCloudIndexPayload(cloudIndex, trimmed, documents, 60)
            : await searchIndexedLibrary(trimmed, 60);
        if (!cancelled) {
          setResults(hits);
          setSelectedIndex(0);
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isOpen, mode, cloudIndex, documents]);

  if (!isOpen) return null;

  const openHit = (hit: SearchResult) => {
    const doc = documents.find((d) => d.relativePath === hit.docPath);
    if (doc) {
      onSelectResult(doc, hit.pageNumber, query);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      openHit(results[selectedIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-16 px-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-800 bg-[#0F172A] shadow-2xl overflow-hidden flex flex-col max-h-[76vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <Search className="w-4 h-4 text-amber-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === 'cloud'
                ? 'Rechercher dans le cache search_index.json…'
                : 'Rechercher dans les PDF, Word (.docx) et ODT…'
            }
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          {results.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onPinResultsToPanel(query, results);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-300 transition-colors cursor-pointer shrink-0"
            >
              <PanelLeft className="w-3 h-3" />
              <span>Épingler</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la recherche"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {query.trim().length < 2 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-1.5">
              <p>
                {mode === 'cloud'
                  ? 'Recherche instantanée sur l’index léger search_index.json en cache.'
                  : 'Recherche instantanée basse consommation sur l’index IndexedDB.'}
              </p>
              <p className="text-slate-500">
                Tapez au moins 2 caractères (ex. « mitose », « Page », « UE4 »).
              </p>
            </div>
          ) : isSearching ? (
            <div className="p-8 text-center text-xs text-slate-400">
              Recherche en cours…
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Aucun résultat trouvé pour « {query} ».
            </div>
          ) : (
            results.map((hit, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={`${hit.docPath}-${hit.pageNumber}-${idx}`}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => openHit(hit)}
                  className={`w-full text-left px-4 py-3 transition-colors cursor-pointer space-y-1 ${
                    isSelected ? 'bg-slate-800/80' : 'hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileFormatIcon fileName={hit.fileName} className="w-3.5 h-3.5 shrink-0" />
                      <span
                        className="text-xs font-semibold text-slate-100 truncate"
                        title={hit.fileName}
                      >
                        {formatCourseDisplayTitle(hit.fileName, titleFormat, rules, {
                          subject: hit.subject,
                          professor: hit.professor,
                        })}
                      </span>
                      <FileFormatBadge fileName={hit.fileName} />
                    </div>
                    <span className="font-mono tabular-nums text-[11px] text-amber-300 shrink-0">
                      {hit.fileName.toLowerCase().endsWith('.pdf')
                        ? `Page ${hit.pageNumber}`
                        : `Section ${hit.pageNumber}`}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 pl-5 truncate">
                    {hit.subject} / {hit.professor}
                  </div>
                  <p className="text-xs text-slate-300 pl-5 leading-relaxed line-clamp-2">
                    <HighlightSnippet text={hit.snippet} query={query} />
                  </p>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-slate-800 bg-[#0B1120] px-4 py-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>↑↓ Naviguer · Entrée Ouvrir à la page</span>
          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
            <CornerDownLeft className="w-3 h-3" />
            {results.length} résultat{results.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
};
