import React, {useEffect, useMemo, useState} from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  CloudUpload,
  Folder,
  FolderPlus,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  User,
} from 'lucide-react';
import type {
  AppMode,
  CloudSearchIndexPayload,
  CourseDocument,
  MobileTab,
  SearchResult,
  SortRule,
  SubjectGroup,
  TitleFormatSettings,
} from '../types/course';
import {
  DEFAULT_TITLE_FORMAT_SETTINGS,
  formatCourseDisplayTitle,
} from '../services/parser';
import {
  clearAllOfflineCloudCache,
  findHighlightRanges,
  searchCloudIndexPayload,
  searchIndexedLibrary,
} from '../services/db';
import {
  disconnectGoogleDrive,
  getSavedDriveClientId,
  getStoredDriveEmail,
  saveDriveClientId,
} from '../services/googleDrive';
import {PdfReaderPanel} from './PdfReaderPanel';
import {PWAInstallButton} from './PWAInstallButton';
import {FileFormatBadge, FileFormatIcon} from './FileFormatBadge';
import {CourseTitleFormatSection} from './CourseTitleFormatSection';

interface MobileWorkspaceProps {
  mode: AppMode;
  onChangeMode: (mode: AppMode) => void;
  isFsSupported: boolean;
  isCloudConnected: boolean;
  isLoadingCloud: boolean;
  hasBackupFolder: boolean;
  cloudIndex: CloudSearchIndexPayload | null;
  hasRootFolder: boolean;
  rootFolderName: string | null;
  needsPermissionReconnect: boolean;
  documents: CourseDocument[];
  tree: SubjectGroup[];
  activeDoc: CourseDocument | null;
  readerPage: number;
  readerJumpKey?: number;
  highlightQuery: string;
  onPageChange: (page: number) => void;
  onOpenDocument: (doc: CourseDocument, page?: number, query?: string) => void;
  onCloseDocument: () => void;
  onConnectCloud: () => Promise<void>;
  onDisconnectCloud: () => void;
  onRefreshCloud: () => Promise<void>;
  onLinkRootFolder: () => void;
  onReconnectRootFolder: () => void;
  onTriggerDriveBackup: () => void;
  onCloudIndexCleared: () => void;
  onNotify?: (text: string, tone?: 'info' | 'error') => void;
  titleFormat?: TitleFormatSettings;
  rules?: SortRule[];
  onChangeTitleFormat?: (settings: TitleFormatSettings) => void;
}

type MobileSortBy = 'name' | 'size' | 'recent';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function HighlightedSnippet({text, query}: {text: string; query: string}) {
  const ranges = findHighlightRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const range of ranges) {
    if (range.start < lastIndex) continue;
    if (range.start > lastIndex) parts.push(text.slice(lastIndex, range.start));
    parts.push(
      <mark key={key++} className="search-highlight">
        {text.slice(range.start, range.end)}
      </mark>
    );
    lastIndex = range.end;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

export const MobileWorkspace: React.FC<MobileWorkspaceProps> = ({
  mode,
  onChangeMode,
  isFsSupported,
  isCloudConnected,
  isLoadingCloud,
  hasBackupFolder,
  cloudIndex,
  hasRootFolder,
  rootFolderName,
  needsPermissionReconnect,
  documents,
  tree,
  activeDoc,
  readerPage,
  readerJumpKey,
  highlightQuery,
  onPageChange,
  onOpenDocument,
  onCloseDocument,
  onConnectCloud,
  onDisconnectCloud,
  onRefreshCloud,
  onLinkRootFolder,
  onReconnectRootFolder,
  onTriggerDriveBackup,
  onCloudIndexCleared,
  onNotify,
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
  rules,
  onChangeTitleFormat,
}) => {
  const [mobileTab, setMobileTab] = useState<MobileTab>('courses');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedProfessor, setSelectedProfessor] = useState<string | null>(null);

  // Screen 2 (Files) filter & sort
  const [fileFilter, setFileFilter] = useState('');
  const [sortBy, setSortBy] = useState<MobileSortBy>('name');

  // Mobile search state
  const [searchQuery, setSearchQuery] = useState('');
  const [wholeWordOnly, setWholeWordOnly] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Client ID draft in Sync tab
  const [clientIdDraft, setClientIdDraft] = useState(getSavedDriveClientId);
  const [clientIdNotice, setClientIdNotice] = useState<string | null>(null);
  const [showMobileGuide, setShowMobileGuide] = useState(false);

  // Reset drill-down when switching modes or when active subject disappears
  useEffect(() => {
    setSelectedSubject(null);
    setSelectedProfessor(null);
  }, [mode]);

  // Execute search on mobile Search tab
  useEffect(() => {
    if (mobileTab !== 'search') return;
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const hits =
          mode === 'cloud'
            ? searchCloudIndexPayload(cloudIndex, trimmed, documents, 60, {
                wholeWordOnly,
              })
            : await searchIndexedLibrary(trimmed, 60, {wholeWordOnly});
        if (!cancelled) setSearchResults(hits);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mobileTab, searchQuery, wholeWordOnly, mode, cloudIndex, documents]);

  const currentSubjectGroup = useMemo(
    () => tree.find((s) => s.name === selectedSubject) ?? null,
    [tree, selectedSubject]
  );

  const screen2Files = useMemo(() => {
    if (!selectedSubject) return [];
    let list = documents.filter((d) => {
      if (d.subject !== selectedSubject) return false;
      if (selectedProfessor && selectedProfessor !== '__ALL__' && d.professor !== selectedProfessor) {
        return false;
      }
      return true;
    });

    if (fileFilter.trim()) {
      const q = fileFilter.toLowerCase();
      list = list.filter((d) => {
        const display = formatCourseDisplayTitle(d.name, titleFormat, {
          subject: d.subject,
          professor: d.professor,
        });
        return (
          d.name.toLowerCase().includes(q) ||
          display.toLowerCase().includes(q) ||
          d.professor.toLowerCase().includes(q)
        );
      });
    }

    const sorted = [...list];
    if (sortBy === 'size') {
      sorted.sort((a, b) => b.size - a.size);
    } else if (sortBy === 'recent') {
      sorted.sort((a, b) => b.lastModified - a.lastModified);
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr', {numeric: true}));
    }
    return sorted;
  }, [documents, selectedSubject, selectedProfessor, fileFilter, sortBy, titleFormat]);

  // Screen 3: Full-screen PDF Reader (hides bottom tab bar and frees RAM when closing)
  if (activeDoc) {
    return (
      <div className="md:hidden fixed inset-0 z-40 flex flex-col bg-[#070B14]">
        <PdfReaderPanel
          document={activeDoc}
          targetPage={readerPage}
          jumpKey={readerJumpKey}
          highlightQuery={highlightQuery}
          titleFormat={titleFormat}
          onPageChange={onPageChange}
          onCloseMobile={onCloseDocument}
          onNotify={onNotify}
        />
      </div>
    );
  }

  const isSourceReady =
    mode === 'cloud'
      ? isCloudConnected || documents.length > 0
      : hasRootFolder && !needsPermissionReconnect;

  const canGoBackInCourses =
    mobileTab === 'courses' && (selectedProfessor !== null || selectedSubject !== null);

  const handleMobileBack = () => {
    if (selectedProfessor !== null) {
      setSelectedProfessor(null);
      setFileFilter('');
    } else if (selectedSubject !== null) {
      setSelectedSubject(null);
    }
  };

  const headerTitle =
    mobileTab === 'search'
      ? 'Recherche'
      : mobileTab === 'sync'
      ? 'Synchronisation / Drive'
      : selectedProfessor
      ? selectedProfessor === '__ALL__'
        ? selectedSubject || 'Fichiers'
        : selectedProfessor
      : selectedSubject || 'Mes Matières';

  return (
    <div className="md:hidden flex-1 flex flex-col min-h-0 bg-[#0B1120]">
      {/* Compact Sticky Mobile Top Bar (48px + safe-area) */}
      <header className="h-12 shrink-0 border-b border-slate-800/90 bg-[#0F172A]/95 backdrop-blur-md px-3 flex items-center justify-between gap-2 pt-safe">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBackInCourses ? (
            <button
              type="button"
              onClick={handleMobileBack}
              className="min-h-[44px] min-w-[44px] -ml-2 inline-flex items-center justify-center rounded-lg text-amber-400 active:bg-slate-800 cursor-pointer shrink-0"
              aria-label="Retour"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <svg
              className="w-5 h-5 shrink-0"
              viewBox="0 0 512 512"
              fill="none"
              aria-hidden="true"
            >
              <rect width="512" height="512" rx="112" fill="#1E293B" />
              <path d="M168 96H236V236L202 210L168 236V96Z" fill="#F59E0B" />
              <rect x="168" y="280" width="176" height="18" rx="9" fill="#E2E8F0" />
              <rect x="168" y="324" width="132" height="16" rx="8" fill="#64748B" />
            </svg>
          )}
          <h1 className="font-display text-sm font-semibold text-slate-100 truncate">
            {headerTitle}
          </h1>
        </div>

        {/* Manual Mode Switcher + Cloud Refresh on Mobile Header */}
        <div className="flex items-center gap-1.5 shrink-0">
          {mode === 'cloud' && (
            <button
              type="button"
              onClick={onRefreshCloud}
              disabled={isLoadingCloud}
              aria-label="Actualiser Google Drive"
              title="Actualiser Google Drive"
              className="p-1.5 rounded-lg border border-slate-800 bg-[#0B1120] text-slate-300 active:bg-slate-800 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCloud ? 'animate-spin text-amber-400' : ''}`} />
            </button>
          )}
          <div
            role="group"
            aria-label="Basculer PC ou Cloud"
            className="inline-flex items-center rounded-lg border border-slate-800 bg-[#0B1120] p-0.5 shrink-0"
          >
            <button
              type="button"
              onClick={() => onChangeMode('local')}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                mode === 'local' ? 'bg-slate-800 text-amber-300' : 'text-slate-400'
              }`}
            >
              PC
            </button>
            <button
              type="button"
              onClick={() => onChangeMode('cloud')}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                mode === 'cloud' ? 'bg-slate-800 text-amber-300' : 'text-slate-400'
              }`}
            >
              <span>Cloud</span>
              {isLoadingCloud && (
                <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-400 shrink-0" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Scrollable Mobile Content */}
      <div className="flex-1 overflow-y-auto pb-20">
        {/* TAB 1: COURS (Screen 1 Folders -> Screen 2 Files) */}
        {mobileTab === 'courses' && (
          <>
            {!isSourceReady ? (
              <div className="p-6 text-center space-y-4 mt-6">
                <div className="w-12 h-12 rounded-2xl border border-slate-800 bg-[#0F172A] flex items-center justify-center mx-auto">
                  {mode === 'cloud' ? (
                    <Cloud className="w-6 h-6 text-amber-400" />
                  ) : (
                    <HardDrive className="w-6 h-6 text-amber-400" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <h2 className="font-display text-base font-semibold text-slate-100">
                    {mode === 'cloud'
                      ? 'Accédez à vos cours sur Drive'
                      : 'Dossier local requis'}
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
                    {mode === 'cloud'
                      ? 'Parcourez Sauvegarde_Cours et ouvrez chaque PDF à la demande sans saturer le stockage de votre téléphone.'
                      : 'Liez un dossier local sur votre appareil ou basculez en Mode Cloud.'}
                  </p>
                </div>

                {mode === 'cloud' ? (
                  <div className="space-y-2.5 max-w-xs mx-auto">
                    <button
                      type="button"
                      onClick={onConnectCloud}
                      disabled={isLoadingCloud}
                      className="w-full min-h-[48px] rounded-xl bg-amber-500 px-4 text-sm font-semibold text-slate-950 active:scale-[0.98] transition-transform cursor-pointer"
                    >
                      {isLoadingCloud ? 'Connexion à Google Drive…' : 'Connecter Google Drive'}
                    </button>
                    {!getSavedDriveClientId().trim() && (
                      <button
                        type="button"
                        onClick={() => setMobileTab('sync')}
                        className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#0F172A] px-4 text-xs font-medium text-slate-200 cursor-pointer"
                      >
                        Configurer mon Client ID dans Synchro
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2.5 max-w-xs mx-auto">
                    {needsPermissionReconnect ? (
                      <button
                        type="button"
                        onClick={onReconnectRootFolder}
                        className="w-full min-h-[48px] rounded-xl bg-amber-500 px-4 text-sm font-semibold text-slate-950 cursor-pointer"
                      >
                        Réactiver « {rootFolderName} »
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onLinkRootFolder}
                        disabled={!isFsSupported}
                        className="w-full min-h-[48px] rounded-xl bg-amber-500 px-4 text-sm font-semibold text-slate-950 disabled:opacity-45 cursor-pointer"
                      >
                        Lier un dossier local
                      </button>
                    )}
                    {!isFsSupported && (
                      <button
                        type="button"
                        onClick={() => onChangeMode('cloud')}
                        className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#0F172A] px-4 text-xs font-medium text-amber-300 cursor-pointer"
                      >
                        Basculer en Mode Cloud Drive
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : selectedSubject === null ? (
              /* SCREEN 1A: MATIÈRES */
              <div className="divide-y divide-slate-800/70">
                {mode === 'cloud' && !hasBackupFolder ? (
                  <div className="p-6 text-center space-y-2">
                    <p className="text-sm font-medium text-slate-200">
                      Dossier « Sauvegarde_Cours » introuvable
                    </p>
                    <p className="text-xs text-slate-400">
                      Effectuez une première sauvegarde depuis la version PC pour créer l’arborescence sur votre Drive.
                    </p>
                  </div>
                ) : tree.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    Aucun cours trouvé.
                  </div>
                ) : (
                  tree.map((subject) => (
                    <button
                      key={subject.name}
                      type="button"
                      onClick={() => setSelectedSubject(subject.name)}
                      className="w-full min-h-[60px] px-4 py-3 flex items-center justify-between gap-3 active:bg-slate-800/70 transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                          <Folder className="w-4 h-4 text-amber-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-100 truncate">
                            {subject.name}
                          </p>
                          <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                            {subject.professors.length} prof. · {subject.totalCount} PDF
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                    </button>
                  ))
                )}
              </div>
            ) : selectedProfessor === null ? (
              /* SCREEN 1B: PROFESSEURS D'UNE MATIÈRE */
              <div className="divide-y divide-slate-800/70">
                <button
                  type="button"
                  onClick={() => setSelectedProfessor('__ALL__')}
                  className="w-full min-h-[56px] px-4 py-3 flex items-center justify-between gap-3 bg-slate-900/40 active:bg-slate-800/70 text-left cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-300">
                      Tous les cours de {selectedSubject}
                    </p>
                    <p className="text-xs text-slate-400 font-mono tabular-nums">
                      {currentSubjectGroup?.totalCount ?? 0} PDF
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-amber-400 shrink-0" />
                </button>

                {currentSubjectGroup?.professors.map((prof) => (
                  <button
                    key={prof.name}
                    type="button"
                    onClick={() => setSelectedProfessor(prof.name)}
                    className="w-full min-h-[60px] px-4 py-3 flex items-center justify-between gap-3 active:bg-slate-800/70 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-slate-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-100 truncate">
                          {prof.name}
                        </p>
                        <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                          {prof.documents.length} PDF
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              /* SCREEN 2: LISTE DES FICHIERS PDF */
              <div>
                <div className="p-3 border-b border-slate-800/80 bg-[#0F172A]/50 space-y-2.5">
                  <input
                    type="search"
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    placeholder="Filtrer ces fichiers…"
                    className="w-full min-h-[42px] rounded-xl border border-slate-800 bg-[#0B1120] px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      {screen2Files.length} document{screen2Files.length > 1 ? 's' : ''}
                    </span>
                    <div className="inline-flex items-center rounded-lg border border-slate-800 bg-[#0B1120] p-0.5">
                      {(['name', 'size', 'recent'] as MobileSortBy[]).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setSortBy(opt)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer ${
                            sortBy === opt
                              ? 'bg-slate-800 text-amber-300'
                              : 'text-slate-400'
                          }`}
                        >
                          {opt === 'name' ? 'Nom' : opt === 'size' ? 'Taille' : 'Récent'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-slate-800/60">
                  {screen2Files.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      Aucun PDF correspondant.
                    </div>
                  ) : (
                    screen2Files.map((doc) => (
                      <button
                        key={doc.relativePath}
                        type="button"
                        onClick={() => onOpenDocument(doc, 1, '')}
                        className="w-full min-h-[60px] px-4 py-3 flex items-center justify-between gap-3 active:bg-slate-800/70 transition-colors text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                            <FileFormatIcon
                              fileName={doc.name}
                              format={doc.format}
                              className="w-4 h-4 shrink-0"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="text-sm font-medium text-slate-100 truncate">
                                {formatCourseDisplayTitle(doc.name, titleFormat, {
                                  subject: doc.subject,
                                  professor: doc.professor,
                                })}
                              </p>
                              <FileFormatBadge fileName={doc.name} format={doc.format} />
                            </div>
                            <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5 truncate">
                              {doc.professor} · {formatBytes(doc.size)}
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* TAB 2: RECHERCHE INTERNE ULTRA-LÉGÈRE */}
        {mobileTab === 'search' && (
          <div className="flex flex-col">
            <div className="p-3.5 border-b border-slate-800/80 bg-[#0F172A]/60 space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Mot-clé dans vos PDF, Word et ODT…"
                    className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-[#0B1120] pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={wholeWordOnly}
                  onClick={() => setWholeWordOnly((v) => !v)}
                  className={`min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                    wholeWordOnly
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-slate-800 bg-[#0B1120] text-slate-300'
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded-xs border flex items-center justify-center ${
                      wholeWordOnly
                        ? 'border-amber-400 bg-amber-500 text-slate-950'
                        : 'border-slate-600 bg-slate-900'
                    }`}
                  >
                    {wholeWordOnly && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </span>
                  <span>Mot entier</span>
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                <span>
                  {mode === 'cloud'
                    ? cloudIndex
                      ? `Index léger en cache (${cloudIndex.documents.length} fichiers)`
                      : 'Aucun index JSON en cache'
                    : 'Index local IndexedDB'}
                </span>
                {searchQuery.trim().length >= 2 && (
                  <span>
                    {isSearching ? '…' : `${searchResults.length} rés.`}
                  </span>
                )}
              </div>
            </div>

            {mode === 'cloud' && !cloudIndex && (
              <div className="m-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-2">
                <p className="text-xs text-amber-200 leading-relaxed">
                  Téléchargez le petit fichier <span className="font-mono">search_index.json</span> depuis Drive pour rechercher à l’intérieur des cours sans télécharger les fichiers.
                </p>
                <button
                  type="button"
                  onClick={isCloudConnected ? onRefreshCloud : onConnectCloud}
                  disabled={isLoadingCloud}
                  className="min-h-[40px] rounded-lg bg-amber-500 px-3 text-xs font-semibold text-slate-950 cursor-pointer"
                >
                  {isCloudConnected
                    ? 'Charger search_index.json'
                    : 'Connecter Google Drive'}
                </button>
              </div>
            )}

            <div className="divide-y divide-slate-800/60">
              {searchQuery.trim().length < 2 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Saisissez au moins 2 caractères pour rechercher instantanément dans les titres et le contenu de vos cours.
                </div>
              ) : searchResults.length === 0 && !isSearching ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Aucun résultat pour « {searchQuery} ».
                </div>
              ) : (
                searchResults.map((hit, idx) => {
                  const matchingDoc = documents.find(
                    (d) => d.relativePath === hit.docPath
                  );
                  return (
                    <button
                      key={`${hit.docPath}-${hit.pageNumber}-${idx}`}
                      type="button"
                      disabled={!matchingDoc}
                      onClick={() => {
                        if (matchingDoc) {
                          onOpenDocument(matchingDoc, hit.pageNumber, searchQuery);
                        }
                      }}
                      className="w-full min-h-[64px] text-left px-4 py-3 active:bg-slate-800/70 space-y-1 cursor-pointer disabled:opacity-45"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <FileFormatIcon fileName={hit.fileName} className="w-3.5 h-3.5 shrink-0" />
                          <span className="text-xs font-semibold text-amber-300 truncate">
                            {formatCourseDisplayTitle(hit.fileName, titleFormat, {
                              subject: hit.subject,
                              professor: hit.professor,
                            })}
                          </span>
                          <FileFormatBadge fileName={hit.fileName} />
                        </span>
                        <span className="font-mono tabular-nums text-[11px] text-slate-300 shrink-0">
                          {hit.fileName.toLowerCase().endsWith('.pdf')
                            ? `p. ${hit.pageNumber}`
                            : `s. ${hit.pageNumber}`}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {hit.subject} / {hit.professor}
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                        <HighlightedSnippet text={hit.snippet} query={searchQuery} />
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SYNCHRONISATION / DRIVE */}
        {mobileTab === 'sync' && (
          <div className="p-4 space-y-5">
            {/* Mode Switcher Card */}
            <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-4 space-y-3">
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Mode d’accès aux cours
              </h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onChangeMode('cloud')}
                  className={`min-h-[48px] rounded-xl border px-3 py-2 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer ${
                    mode === 'cloud'
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-slate-800 bg-[#0B1120] text-slate-300'
                  }`}
                >
                  <Cloud className="w-4 h-4 shrink-0" />
                  <span>Mobile / Cloud</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeMode('local')}
                  className={`min-h-[48px] rounded-xl border px-3 py-2 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer ${
                    mode === 'local'
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-slate-800 bg-[#0B1120] text-slate-300'
                  }`}
                >
                  <HardDrive className="w-4 h-4 shrink-0" />
                  <span>PC Local</span>
                </button>
              </div>
            </div>

            {/* Google Drive Connection & Actions */}
            <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-4 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold text-slate-100">
                  Google Drive (Sauvegarde_Cours)
                </h2>
                <span
                  className={`text-xs font-medium truncate max-w-[160px] ${
                    isCloudConnected
                      ? 'text-emerald-400'
                      : getStoredDriveEmail()
                      ? 'text-amber-300'
                      : 'text-slate-400'
                  }`}
                >
                  {isCloudConnected
                    ? getStoredDriveEmail() || 'Connecté'
                    : getStoredDriveEmail()
                    ? 'Renouvellement auto'
                    : 'Non connecté'}
                </span>
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-slate-400">
                  Client ID Google Cloud
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={clientIdDraft}
                    onChange={(e) => setClientIdDraft(e.target.value)}
                    placeholder="xxxx.apps.googleusercontent.com"
                    className="flex-1 min-h-[44px] rounded-xl border border-slate-800 bg-[#0B1120] px-3 text-xs font-mono text-slate-100 focus:border-amber-500/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      saveDriveClientId(clientIdDraft);
                      setClientIdNotice('Client ID enregistré.');
                      setTimeout(() => setClientIdNotice(null), 2500);
                    }}
                    className="min-h-[44px] rounded-xl border border-slate-700 bg-slate-800 px-3 text-xs font-medium text-slate-100 cursor-pointer shrink-0"
                  >
                    OK
                  </button>
                </div>
                {clientIdNotice && (
                  <p className="text-[11px] text-emerald-400">{clientIdNotice}</p>
                )}
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={isCloudConnected ? onRefreshCloud : onConnectCloud}
                  disabled={isLoadingCloud || !clientIdDraft.trim()}
                  className="w-full min-h-[48px] rounded-xl bg-amber-500 px-4 text-xs font-semibold text-slate-950 disabled:opacity-45 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingCloud ? 'animate-spin' : ''}`} />
                  <span>
                    {isLoadingCloud
                      ? 'Synchronisation…'
                      : isCloudConnected
                      ? 'Actualiser Drive & search_index.json'
                      : 'Connecter Google Drive'}
                  </span>
                </button>

                {mode === 'local' && hasRootFolder && (
                  <button
                    type="button"
                    onClick={onTriggerDriveBackup}
                    className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#0B1120] px-4 text-xs font-medium text-slate-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CloudUpload className="w-4 h-4 text-amber-400" />
                    <span>Sauvegarder le dossier local sur Drive</span>
                  </button>
                )}

                {mode === 'local' && !hasRootFolder && isFsSupported && (
                  <button
                    type="button"
                    onClick={onLinkRootFolder}
                    className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#0B1120] px-4 text-xs font-medium text-slate-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <FolderPlus className="w-4 h-4 text-amber-400" />
                    <span>Lier un dossier local</span>
                  </button>
                )}

                {isCloudConnected && (
                  <button
                    type="button"
                    onClick={() => {
                      disconnectGoogleDrive();
                      onDisconnectCloud();
                    }}
                    className="w-full min-h-[40px] text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Déconnecter la session Google
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowMobileGuide((v) => !v)}
                  className="w-full text-left text-xs text-amber-300 hover:text-amber-200 pt-1 cursor-pointer"
                >
                  {showMobileGuide ? 'Masquer l’aide Client ID ▲' : 'Comment obtenir mon Client ID ? (4 étapes) ▼'}
                </button>

                {showMobileGuide && (
                  <ol className="rounded-xl border border-slate-800 bg-[#0B1120] p-3 space-y-1.5 text-[11px] text-slate-400 leading-relaxed">
                    <li>1. Activez <span className="text-slate-200">Google Drive API</span> dans Google Cloud Console.</li>
                    <li>2. Configurez l’écran OAuth (utilisateur test + scope <span className="font-mono text-slate-300">drive.file</span>).</li>
                    <li>3. Créez un ID client OAuth Web et autorisez <span className="font-mono text-slate-300">{typeof window !== 'undefined' ? window.location.origin : ''}</span>.</li>
                    <li>4. Collez le Client ID ci-dessus puis cliquez sur OK.</li>
                  </ol>
                )}
              </div>
            </div>

            {/* Course Title Display Format Settings (Mobile + Cloud Sync) */}
            {onChangeTitleFormat && (
              <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-4">
                <CourseTitleFormatSection
                  displayOnly
                  value={titleFormat}
                  onChange={onChangeTitleFormat}
                  sampleFilename={documents[0]?.name ?? null}
                  rules={rules}
                />
              </div>
            )}

            {/* Cloud Offline Cache Status */}
            <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold text-slate-100">
                  Cache hors-ligne (IndexedDB)
                </h2>
                <span className="font-mono tabular-nums text-xs text-slate-400">
                  {cloudIndex ? `${cloudIndex.documents.length} cours` : 'Vide'}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                L’index de recherche et les cours déjà ouverts sont mis en cache localement selon leur date de modification Drive pour économiser vos données mobiles.
              </p>
              <button
                type="button"
                onClick={async () => {
                  await clearAllOfflineCloudCache();
                  onCloudIndexCleared();
                }}
                className="inline-flex items-center gap-1.5 text-xs text-rose-300 hover:text-rose-200 py-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vider le cache hors-ligne</span>
              </button>
            </div>

            {/* PWA Install Card */}
            <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-sm font-semibold text-slate-100">
                  Installer sur l’écran d’accueil
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Ouverture plein écran sans barre d’adresse.
                </p>
              </div>
              <PWAInstallButton showFallbackHint />
            </div>
          </div>
        )}
      </div>

      {/* Fixed Mobile Bottom Navigation Bar (3 Tabs: Cours, Recherche, Synchro) */}
      <nav
        aria-label="Navigation principale mobile"
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800/90 bg-[#0F172A]/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-3 h-14">
          <button
            type="button"
            onClick={() => setMobileTab('courses')}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] cursor-pointer transition-colors ${
              mobileTab === 'courses' ? 'text-amber-400' : 'text-slate-400'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Cours</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileTab('search')}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] cursor-pointer transition-colors ${
              mobileTab === 'search' ? 'text-amber-400' : 'text-slate-400'
            }`}
          >
            <Search className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Recherche</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileTab('sync')}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] cursor-pointer transition-colors ${
              mobileTab === 'sync' ? 'text-amber-400' : 'text-slate-400'
            }`}
          >
            <Cloud className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Synchro</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
