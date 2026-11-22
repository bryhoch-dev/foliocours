import React, {useMemo, useState} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import type {
  AppMode,
  CourseDocument,
  IndexingProgress,
  SortRule,
  SubjectGroup,
  TitleFormatSettings,
} from '../types/course';
import {
  DEFAULT_TITLE_FORMAT_SETTINGS,
  formatCourseDisplayTitle,
} from '../services/parser';
import {FileFormatBadge, FileFormatIcon} from './FileFormatBadge';
import type {RenameFolderTarget} from './RenameFolderModal';

interface FolderTreePanelProps {
  mode: AppMode;
  rootFolderName: string | null;
  needsPermissionReconnect: boolean;
  isFsSupported: boolean;
  isCloudConnected: boolean;
  isLoadingCloud: boolean;
  cloudIndexDocCount: number;
  tree: SubjectGroup[];
  selectedSubject: string | null;
  selectedProfessor: string | null;
  activeDocPath: string | null;
  indexingProgress: IndexingProgress;
  onLinkRootFolder: () => void;
  onReconnectRootFolder: () => void;
  onRefreshTree: () => void;
  onConnectCloud: () => void;
  onOpenSettings: () => void;
  onSelectScope: (subject: string | null, professor: string | null) => void;
  onOpenDocument: (doc: CourseDocument) => void;
  onRequestRenameFolder?: (target: RenameFolderTarget) => void;
  titleFormat?: TitleFormatSettings;
  rules?: SortRule[];
}

export const FolderTreePanel: React.FC<FolderTreePanelProps> = ({
  mode,
  rootFolderName,
  needsPermissionReconnect,
  isFsSupported,
  isCloudConnected,
  isLoadingCloud,
  cloudIndexDocCount,
  tree,
  selectedSubject,
  selectedProfessor,
  activeDocPath,
  indexingProgress,
  onLinkRootFolder,
  onReconnectRootFolder,
  onRefreshTree,
  onConnectCloud,
  onOpenSettings,
  onSelectScope,
  onOpenDocument,
  onRequestRenameFolder,
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
  rules,
}) => {
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(() => new Set());
  const [expandedProfessors, setExpandedProfessors] = useState<Set<string>>(() => new Set());
  const [treeFilter, setTreeFilter] = useState('');

  const filteredTree = useMemo(() => {
    const q = treeFilter.trim().toLowerCase();
    if (!q) return tree;
    return tree
      .map((subject) => {
        const subjectMatch = subject.name.toLowerCase().includes(q);
        const filteredProfs = subject.professors
          .map((prof) => {
            const profMatch = prof.name.toLowerCase().includes(q);
            const docs =
              subjectMatch || profMatch
                ? prof.documents
                : prof.documents.filter((d) => {
                    const display = formatCourseDisplayTitle(d.name, titleFormat, {
                      subject: d.subject,
                      professor: d.professor,
                      rules,
                    });
                    return (
                      d.name.toLowerCase().includes(q) ||
                      display.toLowerCase().includes(q)
                    );
                  });
            return {...prof, documents: docs};
          })
          .filter((p) => p.documents.length > 0);
        return {
          ...subject,
          professors: filteredProfs,
          totalCount: filteredProfs.reduce((acc, p) => acc + p.documents.length, 0),
        };
      })
      .filter((s) => s.professors.length > 0);
  }, [tree, treeFilter, titleFormat, rules]);

  const totalDocs = useMemo(
    () => tree.reduce((sum, s) => sum + s.totalCount, 0),
    [tree]
  );

  const toggleSubject = (subjectName: string) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subjectName)) next.delete(subjectName);
      else next.add(subjectName);
      return next;
    });
  };

  const toggleProfessor = (key: string) => {
    setExpandedProfessors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isSourceReady =
    mode === 'cloud' ? isCloudConnected : !!rootFolderName && !needsPermissionReconnect;

  return (
    <aside className="w-64 xl:w-72 shrink-0 border-r border-slate-800/90 bg-[#0F172A] flex flex-col min-h-0">
      {/* Source connection block */}
      <div className="p-3.5 border-b border-slate-800/80 space-y-2.5">
        {mode === 'cloud' ? (
          !isCloudConnected ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-400 leading-relaxed">
                Consultez l’arborescence <span className="font-mono text-slate-200">Sauvegarde_Cours</span> sur Google Drive sans stockage local.
              </p>
              <button
                type="button"
                onClick={onConnectCloud}
                disabled={isLoadingCloud}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Cloud className="w-4 h-4 shrink-0" />
                <span>{isLoadingCloud ? 'Connexion…' : 'Connecter Google Drive'}</span>
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                className="w-full text-[11px] text-slate-400 hover:text-slate-200 py-1 cursor-pointer"
              >
                Configurer le Client ID
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelectScope(null, null)}
                  className="flex items-center gap-2 min-w-0 text-left group cursor-pointer"
                >
                  <Cloud className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm font-semibold text-slate-100 truncate group-hover:text-amber-300 transition-colors">
                    Sauvegarde_Cours
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onRefreshTree}
                  disabled={isLoadingCloud}
                  title="Actualiser depuis Google Drive"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors cursor-pointer shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCloud ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                <span>{tree.length} matières</span>
                <span>{totalDocs} fichiers · {cloudIndexDocCount} indexés</span>
              </div>
              <input
                type="search"
                value={treeFilter}
                onChange={(e) => setTreeFilter(e.target.value)}
                placeholder="Filtrer l’arborescence…"
                className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
              />
            </div>
          )
        ) : !rootFolderName ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 leading-relaxed">
              Liez votre dossier local (ex. <span className="font-mono text-slate-200">Mes_Cours</span>) pour lire et trier vos PDF, Word et ODT sur disque.
            </p>
            <button
              type="button"
              onClick={onLinkRootFolder}
              disabled={!isFsSupported}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 shrink-0" />
              <span>Lier un dossier local</span>
            </button>
            {!isFsSupported && (
              <p className="text-[11px] text-rose-400 leading-snug">
                API File System Access non disponible sur ce navigateur. Utilisez le Mode Cloud Drive.
              </p>
            )}
          </div>
        ) : needsPermissionReconnect ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-200 truncate">
                {rootFolderName}
              </span>
              <span className="text-[11px] text-amber-400 shrink-0">Accès requis</span>
            </div>
            <button
              type="button"
              onClick={onReconnectRootFolder}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span>Réactiver « {rootFolderName} »</span>
            </button>
            <button
              type="button"
              onClick={onLinkRootFolder}
              className="w-full text-[11px] text-slate-400 hover:text-slate-200 transition-colors py-1 cursor-pointer"
            >
              Choisir un autre dossier
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onSelectScope(null, null)}
                className="flex items-center gap-2 min-w-0 text-left group cursor-pointer"
                title="Afficher tous les cours"
              >
                <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-sm font-semibold text-slate-100 truncate group-hover:text-amber-300 transition-colors">
                  {rootFolderName}
                </span>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={onRefreshTree}
                  title="Actualiser l’arborescence disque"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onLinkRootFolder}
                  title="Changer de dossier racine"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
              <span>{tree.length} matières</span>
              <span>{totalDocs} fichiers</span>
            </div>

            <input
              type="search"
              value={treeFilter}
              onChange={(e) => setTreeFilter(e.target.value)}
              placeholder="Filtrer l’arborescence…"
              className="w-full rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Indexing status bar (local mode) */}
      {mode === 'local' && indexingProgress.active && (
        <div className="px-3.5 py-2 border-b border-slate-800/80 bg-slate-900/80 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-amber-300">
            <span className="truncate">Indexation : {indexingProgress.currentFileName}</span>
            <span className="font-mono tabular-nums shrink-0 ml-2">
              {indexingProgress.current}/{indexingProgress.total}
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-150"
              style={{
                width: `${Math.round(
                  (indexingProgress.current / Math.max(1, indexingProgress.total)) * 100
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Mirror Folder Tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {isSourceReady && (
          <button
            type="button"
            onClick={() => onSelectScope(null, null)}
            className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
              selectedSubject === null
                ? 'bg-slate-800/90 text-amber-300 font-medium'
                : 'text-slate-300 hover:bg-slate-800/50'
            }`}
          >
            <span>Tous les cours</span>
            <span className="font-mono tabular-nums text-[11px] text-slate-500">
              {totalDocs}
            </span>
          </button>
        )}

        {filteredTree.length === 0 && isSourceReady && (
          <p className="px-2.5 py-4 text-xs text-slate-500 text-center">
            {treeFilter ? 'Aucun dossier correspondant.' : 'Aucun document trouvé.'}
          </p>
        )}

        {filteredTree.map((subject) => {
          const isSubjectOpen =
            expandedSubjects.has(subject.name) ||
            treeFilter.trim().length > 0 ||
            selectedSubject === subject.name;
          const isSubjectSelected =
            selectedSubject === subject.name && selectedProfessor === null;
          const canRenameSubject =
            mode === 'local' &&
            isSourceReady &&
            !!onRequestRenameFolder &&
            subject.professors.some((p) =>
              p.documents.some((d) => d.relativePath.startsWith(`${subject.name}/`))
            );

          return (
            <div key={subject.name} className="space-y-0.5">
              <div
                className={`group flex items-center gap-1 rounded-md px-1.5 py-1.5 text-xs transition-colors ${
                  isSubjectSelected
                    ? 'bg-slate-800/90 text-amber-300 font-medium'
                    : 'text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSubject(subject.name)}
                  aria-label={`Déplier ${subject.name}`}
                  className="p-0.5 text-slate-400 hover:text-slate-100 cursor-pointer shrink-0"
                >
                  {isSubjectOpen ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelectScope(subject.name, null);
                    setExpandedSubjects((prev) => new Set(prev).add(subject.name));
                  }}
                  className="flex-1 flex items-center justify-between gap-2 min-w-0 text-left cursor-pointer"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Folder className="w-3.5 h-3.5 text-amber-400/90 shrink-0" />
                    <span className="truncate">{subject.name}</span>
                  </span>
                  <span className="font-mono tabular-nums text-[11px] text-slate-500 shrink-0">
                    {subject.totalCount}
                  </span>
                </button>
                {canRenameSubject && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequestRenameFolder?.({
                        kind: 'subject',
                        subjectName: subject.name,
                      });
                    }}
                    title={`Renommer « ${subject.name} »`}
                    aria-label={`Renommer le dossier ${subject.name}`}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-700/70 transition-opacity cursor-pointer shrink-0"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>

              {isSubjectOpen && (
                <div className="pl-4 space-y-0.5">
                  {subject.professors.map((prof) => {
                    const profKey = `${subject.name}::${prof.name}`;
                    const isProfOpen =
                      expandedProfessors.has(profKey) ||
                      treeFilter.trim().length > 0 ||
                      (selectedSubject === subject.name && selectedProfessor === prof.name);
                    const isProfSelected =
                      selectedSubject === subject.name && selectedProfessor === prof.name;
                    const expectedProfPrefix = `${subject.name}/${prof.name.replace(/ \/ /g, '/')}/`;
                    const canRenameProf =
                      mode === 'local' &&
                      isSourceReady &&
                      !!onRequestRenameFolder &&
                      prof.name !== 'Racine' &&
                      prof.documents.some((d) =>
                        d.relativePath.startsWith(expectedProfPrefix)
                      );

                    return (
                      <div key={profKey} className="space-y-0.5">
                        <div
                          className={`group flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors ${
                            isProfSelected
                              ? 'bg-slate-800/90 text-amber-300 font-medium'
                              : 'text-slate-300 hover:bg-slate-800/50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleProfessor(profKey)}
                            aria-label={`Déplier ${prof.name}`}
                            className="p-0.5 text-slate-500 hover:text-slate-200 cursor-pointer shrink-0"
                          >
                            {isProfOpen ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectScope(subject.name, prof.name);
                              setExpandedProfessors((prev) => new Set(prev).add(profKey));
                            }}
                            className="flex-1 flex items-center justify-between gap-2 min-w-0 text-left cursor-pointer"
                          >
                            <span className="truncate">{prof.name}</span>
                            <span className="font-mono tabular-nums text-[11px] text-slate-500 shrink-0">
                              {prof.documents.length}
                            </span>
                          </button>
                          {canRenameProf && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRequestRenameFolder?.({
                                  kind: 'professor',
                                  subjectName: subject.name,
                                  professorName: prof.name,
                                });
                              }}
                              title={`Renommer « ${prof.name} »`}
                              aria-label={`Renommer le dossier ${prof.name}`}
                              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-700/70 transition-opacity cursor-pointer shrink-0"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        {isProfOpen && (
                          <div className="pl-4 space-y-0.5">
                            {prof.documents.map((doc) => {
                              const isActive = activeDocPath === doc.relativePath;
                              return (
                                <button
                                  key={doc.relativePath}
                                  type="button"
                                  onClick={() => onOpenDocument(doc)}
                                  title={doc.name}
                                  className={`w-full flex items-center justify-between gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors cursor-pointer ${
                                    isActive
                                      ? 'bg-amber-500/15 text-amber-300 font-medium'
                                      : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5 min-w-0">
                                    <FileFormatIcon
                                      fileName={doc.name}
                                      format={doc.format}
                                      className="w-3 h-3 shrink-0"
                                    />
                                    <span className="truncate">
                                      {formatCourseDisplayTitle(doc.name, titleFormat, {
                                        subject: doc.subject,
                                        professor: doc.professor,
                                        rules,
                                      })}
                                    </span>
                                  </span>
                                  <FileFormatBadge fileName={doc.name} format={doc.format} />
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
