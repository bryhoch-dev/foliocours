import React, {useState} from 'react';
import {
  CheckCircle2,
  FolderArchive,
  FolderInput,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CourseDocument,
  ImportQueueItem,
  SearchResult,
  TitleFormatSettings,
  WorkspaceTab,
} from '../types/course';
import {buildAccentInsensitiveRegex} from '../services/db';
import {CLASSIFY_FOLDER_NAME} from '../services/filesystem';
import {
  DEFAULT_TITLE_FORMAT_SETTINGS,
  formatCourseDisplayTitle,
} from '../services/parser';
import {FileFormatBadge, FileFormatIcon} from './FileFormatBadge';

interface CenterWorkspaceProps {
  mode: 'local' | 'cloud';
  activeTab: WorkspaceTab;
  hasRootFolder: boolean;
  needsPermissionReconnect: boolean;
  isCloudConnected: boolean;
  documents: CourseDocument[];
  selectedSubject: string | null;
  selectedProfessor: string | null;
  activeDocPath: string | null;
  importQueue: ImportQueueItem[];
  isWritingImport: boolean;
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  onSelectTab: (tab: WorkspaceTab) => void;
  onLinkRootFolder: () => void;
  onConnectCloud: () => void;
  onOpenDocument: (doc: CourseDocument, page?: number, highlight?: string) => void;
  onSortClassifyFolder: (useEditedQueue?: boolean) => void;
  onRefreshClassifyQueue: () => void;
  onUpdateQueueItem: (
    id: string,
    patch: Partial<Pick<ImportQueueItem, 'subject' | 'professor' | 'targetName'>>
  ) => void;
  onRemoveQueueItem: (id: string) => void;
  onSearchQueryChange: (q: string) => void;
  onOpenRules: () => void;
  onOpenFlattenModal: () => void;
  titleFormat?: TitleFormatSettings;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function HighlightedText({text, query}: {text: string; query: string}) {
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

export const CenterWorkspace: React.FC<CenterWorkspaceProps> = ({
  mode,
  activeTab,
  hasRootFolder,
  needsPermissionReconnect,
  isCloudConnected,
  documents,
  selectedSubject,
  selectedProfessor,
  activeDocPath,
  importQueue,
  isWritingImport,
  searchQuery,
  searchResults,
  isSearching,
  onSelectTab,
  onLinkRootFolder,
  onConnectCloud,
  onOpenDocument,
  onSortClassifyFolder,
  onRefreshClassifyQueue,
  onUpdateQueueItem,
  onRemoveQueueItem,
  onSearchQueryChange,
  onOpenRules,
  onOpenFlattenModal,
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
}) => {
  const [listFilter, setListFilter] = useState('');

  const getDisplayTitle = (doc: CourseDocument) =>
    formatCourseDisplayTitle(doc.name, titleFormat, {
      subject: doc.subject,
      professor: doc.professor,
    });

  const visibleDocuments = documents.filter((doc) => {
    if (selectedSubject && doc.subject !== selectedSubject) return false;
    if (selectedProfessor && doc.professor !== selectedProfessor) return false;
    if (listFilter.trim()) {
      const q = listFilter.toLowerCase();
      return (
        doc.name.toLowerCase().includes(q) ||
        getDisplayTitle(doc).toLowerCase().includes(q) ||
        doc.subject.toLowerCase().includes(q) ||
        doc.professor.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pendingClassifyCount = importQueue.filter((i) => i.status !== 'done').length;

  const isSourceActive =
    mode === 'cloud' ? isCloudConnected : hasRootFolder && !needsPermissionReconnect;

  return (
    <section className="w-full md:w-[410px] xl:w-[460px] shrink-0 border-r border-slate-800/90 bg-[#0B1120] flex flex-col min-h-0">
      {/* Sub-header depending on active tab */}
      {activeTab === 'library' && (
        <>
          <div className="p-4 border-b border-slate-800/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-display text-sm font-semibold text-slate-100 truncate">
                  {selectedSubject
                    ? selectedProfessor
                      ? `${selectedSubject} / ${selectedProfessor}`
                      : selectedSubject
                    : 'Tous les cours'}
                </h2>
                <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                  {visibleDocuments.length} document{visibleDocuments.length > 1 ? 's' : ''}
                  {mode === 'cloud' ? ' · Cloud Drive' : ''}
                </p>
              </div>
              {mode === 'local' && hasRootFolder && !needsPermissionReconnect && (
                <div className="flex items-center gap-1.5 flex-wrap shrink-0 justify-end">
                  <button
                    type="button"
                    onClick={onOpenFlattenModal}
                    title={`Récupérer et aplatir un dossier vers ${CLASSIFY_FOLDER_NAME}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderArchive className="w-3.5 h-3.5 text-amber-400" />
                    <span>Importer / Aplatir un dossier</span>
                  </button>
                  <button
                    type="button"
                    disabled={isWritingImport}
                    onClick={() => onSortClassifyFolder(false)}
                    title="Trier récursivement tout l’espace de travail selon le format configuré et supprimer les dossiers vides"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderInput className="w-3.5 h-3.5 text-amber-400" />
                    <span>
                      {isWritingImport
                        ? 'Tri en cours…'
                        : pendingClassifyCount > 0
                        ? `Trier (${pendingClassifyCount})`
                        : 'Trier'}
                    </span>
                  </button>
                </div>
              )}
            </div>

            <input
              type="search"
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              placeholder="Filtrer cette liste par nom, UE ou professeur…"
              className="w-full rounded-lg border border-slate-800 bg-[#0F172A] px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {!isSourceActive ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm text-slate-300 font-medium">
                  {mode === 'cloud'
                    ? 'Google Drive non connecté'
                    : 'Aucun dossier local actif'}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {mode === 'cloud'
                    ? 'Connectez votre compte Google pour parcourir Sauvegarde_Cours et ouvrir vos PDF à la demande sans téléchargement global.'
                    : 'Liez votre dossier racine dans le panneau de gauche pour afficher vos cours et activer l’indexation plein texte.'}
                </p>
                {mode === 'cloud' ? (
                  <button
                    type="button"
                    onClick={onConnectCloud}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                  >
                    Connecter Google Drive
                  </button>
                ) : (
                  !hasRootFolder && (
                    <button
                      type="button"
                      onClick={onLinkRootFolder}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                    >
                      Lier un dossier local
                    </button>
                  )
                )}
              </div>
            ) : visibleDocuments.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm text-slate-300 font-medium">
                  Aucun document dans cette vue
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {mode === 'cloud'
                    ? 'Aucun document trouvé dans Sauvegarde_Cours sur Google Drive. Lancez une sauvegarde depuis votre PC pour synchroniser vos cours.'
                    : `Déposez vos cours (.pdf, .docx, .odt) dans le sous-dossier « ${CLASSIFY_FOLDER_NAME} » ou aplatissez un dossier existant, puis cliquez sur « Trier "${CLASSIFY_FOLDER_NAME}" ».`}
                </p>
                {mode === 'local' && (
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={onOpenFlattenModal}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/50 transition-colors cursor-pointer"
                    >
                      <FolderArchive className="w-3.5 h-3.5 text-amber-400" />
                      <span>Importer / Aplatir un dossier</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onSortClassifyFolder(false)}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                    >
                      <FolderInput className="w-3.5 h-3.5" />
                      <span>Trier « {CLASSIFY_FOLDER_NAME} »</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              visibleDocuments.map((doc) => {
                const isActive = doc.relativePath === activeDocPath;
                const displayTitle = getDisplayTitle(doc);
                return (
                  <button
                    key={doc.relativePath}
                    type="button"
                    onClick={() => onOpenDocument(doc)}
                    title={doc.name}
                    className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                      isActive ? 'bg-slate-900/90' : 'hover:bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <FileFormatIcon
                            fileName={doc.name}
                            format={doc.format}
                            className="w-4 h-4 shrink-0"
                          />
                          <span
                            className={`text-sm font-medium truncate ${
                              isActive ? 'text-amber-300' : 'text-slate-100'
                            }`}
                          >
                            {displayTitle}
                          </span>
                          <FileFormatBadge fileName={doc.name} format={doc.format} />
                        </div>
                        <div className="mt-1 pl-6 flex items-center gap-1.5 text-xs text-slate-400 truncate">
                          <span className="truncate">{doc.subject}</span>
                          <span aria-hidden="true">/</span>
                          <span className="truncate">{doc.professor}</span>
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums text-[11px] text-slate-500 shrink-0 space-y-0.5">
                        <div>{formatBytes(doc.size)}</div>
                        <div>
                          {doc.pageCount > 0
                            ? `${doc.pageCount} p.`
                            : doc.source === 'cloud'
                            ? 'Drive'
                            : doc.indexedAt
                            ? 'Indexé'
                            : 'En attente'}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}

      {activeTab === 'import' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 border-b border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-display text-sm font-semibold text-slate-100">
                  Tri global & Fichiers dans « à organiser »
                </h2>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  Modèle actif : <span className="font-mono text-slate-300">{titleFormat.inputTemplate}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onOpenRules}
                  className="text-xs text-amber-400 hover:text-amber-300 underline-offset-4 hover:underline whitespace-nowrap cursor-pointer"
                >
                  Format de tri
                </button>
              </div>
            </div>

            {!hasRootFolder || needsPermissionReconnect ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex items-center justify-between gap-3">
                <span className="text-xs text-amber-200 leading-snug">
                  Liez d’abord votre dossier racine pour analyser et trier « {CLASSIFY_FOLDER_NAME} ».
                </span>
                <button
                  type="button"
                  onClick={onLinkRootFolder}
                  className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Lier un dossier
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-3 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-300 leading-snug">
                  Les fichiers <span className="font-mono text-slate-100">.pdf</span>,{' '}
                  <span className="font-mono text-slate-100">.docx</span> et{' '}
                  <span className="font-mono text-slate-100">.odt</span> présents dans{' '}
                  <span className="font-mono text-amber-300">{CLASSIFY_FOLDER_NAME}/</span> sont déplacés directement vers{' '}
                  <span className="font-mono text-slate-200">Matière / Professeur</span>.
                </p>
                <button
                  type="button"
                  onClick={onRefreshClassifyQueue}
                  disabled={isWritingImport}
                  title={`Rescanner le dossier « ${CLASSIFY_FOLDER_NAME} »`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-45 shrink-0 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Actualiser</span>
                </button>
              </div>
            )}
          </div>

          {/* Editable Preview Table for files inside "à organiser/Général" */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {importQueue.length === 0 ? (
              <div className="py-10 px-4 text-center space-y-3">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Aucun fichier à classer dans <span className="font-mono text-slate-200">{CLASSIFY_FOLDER_NAME}/</span>.
                  Placez-y vos cours depuis votre ordinateur ou utilisez{' '}
                  <strong className="text-slate-200 font-medium">Importer / Aplatir un dossier</strong>.
                </p>
                {hasRootFolder && !needsPermissionReconnect && (
                  <button
                    type="button"
                    onClick={onOpenFlattenModal}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-300 transition-colors cursor-pointer"
                  >
                    <FolderArchive className="w-3.5 h-3.5 text-amber-400" />
                    <span>Importer / Aplatir un dossier</span>
                  </button>
                )}
              </div>
            ) : (
              importQueue.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-slate-800 bg-[#0F172A] p-3 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileFormatIcon fileName={item.originalName} className="w-3.5 h-3.5 shrink-0" />
                        <p className="text-xs font-medium text-slate-200 truncate" title={item.originalName}>
                          {item.originalName}
                        </p>
                        <FileFormatBadge fileName={item.originalName} />
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                        {formatBytes(item.size)}
                        {item.ueCode ? ` · ${item.ueCode}` : ''}
                        {item.matchedRulePattern ? ` · Règle « ${item.matchedRulePattern} »` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.status === 'done' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Déplacé
                        </span>
                      )}
                      {item.status === 'writing' && (
                        <span className="text-[11px] text-amber-400">Déplacement…</span>
                      )}
                      {item.status !== 'writing' && (
                        <button
                          type="button"
                          onClick={() => onRemoveQueueItem(item.id)}
                          aria-label="Ignorer pour ce tri"
                          title={`Ignorer pour ce tri (le fichier reste dans ${CLASSIFY_FOLDER_NAME})`}
                          className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="block text-[11px] text-slate-400 mb-1">Matière</span>
                      <input
                        type="text"
                        value={item.subject}
                        disabled={item.status === 'done' || isWritingImport}
                        onChange={(e) =>
                          onUpdateQueueItem(item.id, {subject: e.target.value})
                        }
                        className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-2 py-1.5 text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none disabled:opacity-60"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[11px] text-slate-400 mb-1">Professeur</span>
                      <input
                        type="text"
                        value={item.professor}
                        disabled={item.status === 'done' || isWritingImport}
                        onChange={(e) =>
                          onUpdateQueueItem(item.id, {professor: e.target.value})
                        }
                        className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-2 py-1.5 text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none disabled:opacity-60"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="block text-[11px] text-slate-400 mb-1">
                      Nom final sur le disque
                    </span>
                    <input
                      type="text"
                      value={item.targetName}
                      disabled={item.status === 'done' || isWritingImport}
                      onChange={(e) =>
                        onUpdateQueueItem(item.id, {targetName: e.target.value})
                      }
                      className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-2 py-1.5 text-xs font-mono text-slate-200 focus:border-amber-500/60 focus:outline-none disabled:opacity-60"
                    />
                  </label>

                  {item.error && (
                    <p className="text-[11px] text-rose-400">{item.error}</p>
                  )}
                </div>
              ))
            )}
          </div>

          {importQueue.length > 0 && (
            <div className="p-3.5 border-t border-slate-800/80 bg-[#0F172A] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onRefreshClassifyQueue}
                disabled={isWritingImport}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Rescanner
              </button>
              <button
                type="button"
                onClick={() => onSortClassifyFolder(true)}
                disabled={
                  !hasRootFolder ||
                  needsPermissionReconnect ||
                  isWritingImport
                }
                className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {isWritingImport
                  ? 'Tri global en cours…'
                  : `Trier tout l’espace de travail (${pendingClassifyCount} à organiser)`}
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'search' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 border-b border-slate-800/80 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Recherche plein texte
              </h2>
              <button
                type="button"
                onClick={() => onSelectTab('library')}
                className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Fermer</span>
              </button>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="Mot-clé dans les PDF, Word (.docx) et ODT…"
                className="w-full rounded-lg border border-slate-800 bg-[#0F172A] pl-8 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-500 font-mono tabular-nums">
              {isSearching
                ? 'Analyse de l’index IndexedDB…'
                : `${searchResults.length} résultat${searchResults.length > 1 ? 's' : ''}`}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {searchQuery.trim().length < 2 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Saisissez au moins 2 caractères pour rechercher dans tous vos cours indexés.
              </div>
            ) : searchResults.length === 0 && !isSearching ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Aucune correspondance trouvée pour « {searchQuery} ».
              </div>
            ) : (
              searchResults.map((hit, idx) => {
                const matchingDoc = documents.find((d) => d.relativePath === hit.docPath);
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
                    className="w-full text-left px-4 py-3 hover:bg-slate-900/60 transition-colors space-y-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <FileFormatIcon fileName={hit.fileName} className="w-3.5 h-3.5 shrink-0" />
                        <span
                          className="text-xs font-semibold text-amber-300 truncate"
                          title={hit.fileName}
                        >
                          {formatCourseDisplayTitle(hit.fileName, titleFormat, {
                            subject: hit.subject,
                            professor: hit.professor,
                          })}
                        </span>
                        <FileFormatBadge fileName={hit.fileName} />
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                        {hit.fileName.toLowerCase().endsWith('.pdf')
                          ? `p. ${hit.pageNumber}`
                          : `s. ${hit.pageNumber}`}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {hit.subject} / {hit.professor}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">
                      <HighlightedText text={hit.snippet} query={searchQuery} />
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </section>
  );
};
