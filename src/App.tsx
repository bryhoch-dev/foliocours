import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {
  AppMode,
  CloudSearchIndexPayload,
  CourseDocument,
  DriveBackupPlan,
  IndexingProgress,
  ImportQueueItem,
  SearchResult,
  SortRule,
  TitleFormatSettings,
  WorkspaceTab,
} from './types/course';
import {
  clearSearchIndex,
  getAllIndexedDocuments,
  getCloudSearchIndex,
  getRootDirectoryHandle,
  pruneMissingDocuments,
  saveCloudSearchIndex,
  saveRootDirectoryHandle,
  searchCloudIndexPayload,
  searchIndexedLibrary,
} from './services/db';
import {
  buildCourseTree,
  CLASSIFY_FOLDER_NAME,
  isFileSystemAccessSupported,
  isOrganizeRootFolderName,
  ORGANIZE_FOLDER_NAME,
  pickRootDirectory,
  resolveOrganizeSubfolders,
  scanClassifyFolderItems,
  scanRootDirectory,
  sortClassifyFolderItems,
  verifyDirectoryPermission,
} from './services/filesystem';
import {
  loadSortRules,
  loadTitleFormatSettings,
  parseCourseFilename,
  saveSortRules,
  saveTitleFormatSettings,
} from './services/parser';
import {indexDocumentsQueue} from './services/pdfEngine';
import {
  authenticateGoogleDrive,
  buildDriveBackupPlan,
  downloadCloudSearchIndex,
  executeDriveBackup,
  fetchCloudDriveLibrary,
  getMemoryAccessToken,
  getSavedDriveClientId,
} from './services/googleDrive';
import {TopBar} from './components/TopBar';
import {FolderTreePanel} from './components/FolderTreePanel';
import {CenterWorkspace} from './components/CenterWorkspace';
import {PdfReaderPanel} from './components/PdfReaderPanel';
import {MobileWorkspace} from './components/MobileWorkspace';
import {GlobalSearchModal} from './components/GlobalSearchModal';
import {RulesEditorModal} from './components/RulesEditorModal';
import {SettingsAndDriveModal} from './components/SettingsAndDriveModal';
import {DriveBackupConfirmModal} from './components/DriveBackupConfirmModal';
import {FlattenFolderModal} from './components/FlattenFolderModal';
import {OfflineIndicator} from './components/OfflineIndicator';

function detectInitialMode(): AppMode {
  if (typeof window === 'undefined') return 'local';
  if (!isFileSystemAccessSupported() || window.innerWidth < 768) {
    return 'cloud';
  }
  return 'local';
}

export default function App() {
  const isFsSupported = useMemo(() => isFileSystemAccessSupported(), []);
  const [mode, setMode] = useState<AppMode>(detectInitialMode);

  // Local File System & Mirror Tree State
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [rootFolderName, setRootFolderName] = useState<string | null>(null);
  const [needsPermissionReconnect, setNeedsPermissionReconnect] = useState(false);
  const [localDocuments, setLocalDocuments] = useState<CourseDocument[]>([]);

  // Cloud (Google Drive) State
  const [isCloudConnected, setIsCloudConnected] = useState(() => !!getMemoryAccessToken());
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [hasBackupFolder, setHasBackupFolder] = useState(true);
  const [cloudDocuments, setCloudDocuments] = useState<CourseDocument[]>([]);
  const [cloudIndex, setCloudIndex] = useState<CloudSearchIndexPayload | null>(null);

  // Navigation & Selection State
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('library');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedProfessor, setSelectedProfessor] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<CourseDocument | null>(null);
  const [readerPage, setReaderPage] = useState(1);
  const [readerJumpKey, setReaderJumpKey] = useState(0);
  const [highlightQuery, setHighlightQuery] = useState('');

  // Import, Rules & Title Format State
  const [rules, setRules] = useState<SortRule[]>(() => loadSortRules());
  const [titleFormat, setTitleFormat] = useState<TitleFormatSettings>(() =>
    loadTitleFormatSettings()
  );
  const [includeAlreadySorted, setIncludeAlreadySorted] = useState(true);
  const [importQueue, setImportQueue] = useState<ImportQueueItem[]>([]);
  const [isWritingImport, setIsWritingImport] = useState(false);

  // Indexing State
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress>({
    active: false,
    current: 0,
    total: 0,
    currentFileName: '',
  });
  const indexAbortRef = useRef<AbortController | null>(null);

  // Search State
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Modals State
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isFlattenModalOpen, setIsFlattenModalOpen] = useState(false);

  // Google Drive Backup State
  const [driveBackupModalOpen, setDriveBackupModalOpen] = useState(false);
  const [driveBackupPlan, setDriveBackupPlan] = useState<DriveBackupPlan | null>(null);
  const [isUploadingDrive, setIsUploadingDrive] = useState(false);
  const [driveUploadProgress, setDriveUploadProgress] = useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null);
  const [driveResultMessage, setDriveResultMessage] = useState<string | null>(null);
  const [driveErrorMessage, setDriveErrorMessage] = useState<string | null>(null);

  // Non-intrusive toast feedback
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    tone: 'info' | 'error';
  } | null>(null);

  const showToast = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    setToastMessage({text, tone});
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 4500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const activeDocuments = mode === 'cloud' ? cloudDocuments : localDocuments;
  const tree = useMemo(() => buildCourseTree(activeDocuments), [activeDocuments]);
  const sampleOrganizeFilename = useMemo(
    () =>
      importQueue.find((i) => i.isFromOrganize)?.originalName ??
      importQueue[0]?.originalName ??
      localDocuments.find((d) => isOrganizeRootFolderName(d.subject))?.name ??
      null,
    [importQueue, localDocuments]
  );

  const runIndexing = useCallback(
    async (docsToIndex: CourseDocument[], forceReindex = false) => {
      if (indexAbortRef.current) {
        indexAbortRef.current.abort();
      }
      const controller = new AbortController();
      indexAbortRef.current = controller;

      await indexDocumentsQueue(docsToIndex, {
        forceReindex,
        signal: controller.signal,
        onProgress: setIndexingProgress,
        onDocumentIndexed: (relativePath, pageCount, indexedAt) => {
          setLocalDocuments((prev) =>
            prev.map((d) =>
              d.relativePath === relativePath ? {...d, pageCount, indexedAt} : d
            )
          );
        },
      });
    },
    []
  );

  const refreshClassifyQueue = useCallback(
    async (
      handle: FileSystemDirectoryHandle,
      activeRules: SortRule[],
      activeFormat: TitleFormatSettings = titleFormat
    ) => {
      try {
        const scannedItems = await scanClassifyFolderItems(
          handle,
          (name, mime) => parseCourseFilename(name, activeRules, mime, activeFormat),
          {includeAlreadySorted: false}
        );
        setImportQueue(
          scannedItems.map((item) => ({
            ...item,
            status: 'pending' as const,
          }))
        );
      } catch (err) {
        console.warn(`Analyse de « ${ORGANIZE_FOLDER_NAME} » impossible:`, err);
      }
    },
    [titleFormat]
  );

  const loadDirectoryAndIndex = useCallback(
    async (handle: FileSystemDirectoryHandle, forceReindex = false) => {
      try {
        await resolveOrganizeSubfolders(handle, true);
      } catch {
        // Ignore if directory is temporarily read-only until explicit reconnect
      }

      const indexedMap = await getAllIndexedDocuments();
      const scannedDocs = await scanRootDirectory(handle, indexedMap);
      const validPaths = new Set(scannedDocs.map((d) => d.relativePath));
      await pruneMissingDocuments(validPaths);

      setLocalDocuments(scannedDocs);
      setActiveDoc((prev) => {
        if (!prev || prev.source === 'cloud') return prev;
        return scannedDocs.find((d) => d.relativePath === prev.relativePath) ?? null;
      });

      await refreshClassifyQueue(handle, rules, titleFormat);
      void runIndexing(scannedDocs, forceReindex);
    },
    [refreshClassifyQueue, rules, titleFormat, runIndexing]
  );

  // Restore saved local directory handle & cached cloud search index on startup
  useEffect(() => {
    let mounted = true;
    (async () => {
      let cachedIndexRef: CloudSearchIndexPayload | null = null;
      try {
        const cachedCloudIdx = await getCloudSearchIndex();
        if (mounted && cachedCloudIdx) {
          cachedIndexRef = cachedCloudIdx;
          setCloudIndex(cachedCloudIdx);
        }
      } catch {
        // ignore
      }

      // Restore valid Google Drive session silently on startup without ever opening a popup
      const restoredToken = getMemoryAccessToken();
      if (restoredToken && mounted) {
        setIsCloudConnected(true);
        if (detectInitialMode() === 'cloud') {
          void fetchCloudDriveLibrary(restoredToken)
            .then(async ({hasBackupFolder: folderExists, documents: remoteDocs, searchIndexFileId}) => {
              if (!mounted) return;
              setHasBackupFolder(folderExists);
              let idx = cachedIndexRef;
              if (searchIndexFileId) {
                try {
                  idx = await downloadCloudSearchIndex(restoredToken, searchIndexFileId);
                  await saveCloudSearchIndex(idx);
                  if (mounted) setCloudIndex(idx);
                } catch {
                  // keep cached index if offline
                }
              }
              const pageCountMap = new Map<string, number>();
              if (idx) {
                for (const d of idx.documents) {
                  pageCountMap.set(d.relativePath, d.pageCount);
                }
              }
              if (mounted) {
                setCloudDocuments(
                  remoteDocs.map((doc) => ({
                    ...doc,
                    pageCount: pageCountMap.get(doc.relativePath) ?? doc.pageCount,
                  }))
                );
              }
            })
            .catch(() => {
              // Silent startup restore failure must never pop up OAuth
              if (mounted && !getMemoryAccessToken()) {
                setIsCloudConnected(false);
              }
            });
        }
      }

      if (!isFsSupported) return;
      try {
        const saved = await getRootDirectoryHandle();
        if (!saved || !mounted) return;
        setRootHandle(saved);
        setRootFolderName(saved.name);

        const perm = await saved.queryPermission({mode: 'readwrite'});
        if (!mounted) return;

        if (perm === 'granted') {
          setNeedsPermissionReconnect(false);
          await loadDirectoryAndIndex(saved);
        } else {
          setNeedsPermissionReconnect(true);
        }
      } catch (err) {
        console.warn('Restauration dossier impossible:', err);
      }
    })();

    return () => {
      mounted = false;
      indexAbortRef.current?.abort();
    };
  }, [isFsSupported, loadDirectoryAndIndex]);

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchModalOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Debounced search when desktop middle search tab is active
  useEffect(() => {
    if (activeTab !== 'search') return;
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
            ? searchCloudIndexPayload(cloudIndex, trimmed, cloudDocuments, 80)
            : await searchIndexedLibrary(trimmed, 80);
        if (!cancelled) setSearchResults(hits);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeTab, searchQuery, mode, cloudIndex, cloudDocuments]);

  const handleConnectOrRefreshCloud = useCallback(async () => {
    const existingToken = getMemoryAccessToken();
    const clientId = getSavedDriveClientId();

    if (!existingToken && !clientId.trim()) {
      showToast(
        'Configurez d’abord votre Client ID Google Cloud dans les paramètres.',
        'error'
      );
      if (window.innerWidth >= 768) {
        setIsSettingsModalOpen(true);
      }
      return;
    }

    setIsLoadingCloud(true);
    try {
      let token = existingToken || (await authenticateGoogleDrive(clientId));
      setIsCloudConnected(true);

      let libraryResult: Awaited<ReturnType<typeof fetchCloudDriveLibrary>>;
      try {
        libraryResult = await fetchCloudDriveLibrary(token);
      } catch (libErr) {
        if (
          !getMemoryAccessToken() &&
          libErr instanceof Error &&
          libErr.message.includes('Session Google expirée')
        ) {
          token = await authenticateGoogleDrive(clientId);
          libraryResult = await fetchCloudDriveLibrary(token);
        } else {
          throw libErr;
        }
      }

      const {
        hasBackupFolder: folderExists,
        documents: remoteDocs,
        searchIndexFileId,
      } = libraryResult;
      setHasBackupFolder(folderExists);

      let latestIndex = cloudIndex;
      if (searchIndexFileId) {
        try {
          latestIndex = await downloadCloudSearchIndex(token, searchIndexFileId);
          await saveCloudSearchIndex(latestIndex);
          setCloudIndex(latestIndex);
        } catch (idxErr) {
          console.warn('Impossible de charger search_index.json:', idxErr);
        }
      }

      // Enrich page counts from search_index.json without downloading PDFs
      const pageCountMap = new Map<string, number>();
      if (latestIndex) {
        for (const d of latestIndex.documents) {
          pageCountMap.set(d.relativePath, d.pageCount);
        }
      }

      const enriched = remoteDocs.map((doc) => ({
        ...doc,
        pageCount: pageCountMap.get(doc.relativePath) ?? doc.pageCount,
      }));
      setCloudDocuments(enriched);

      if (!folderExists) {
        showToast('Dossier « Sauvegarde_Cours » introuvable sur votre Drive.', 'error');
      } else {
        showToast(
          `${enriched.length} cours chargés depuis Google Drive${
            latestIndex ? ' (index recherche à jour)' : ''
          }.`
        );
      }
    } catch (err) {
      if (!getMemoryAccessToken()) {
        setIsCloudConnected(false);
      }
      showToast(
        err instanceof Error ? err.message : 'Erreur de connexion Google Drive.',
        'error'
      );
    } finally {
      setIsLoadingCloud(false);
    }
  }, [cloudIndex, showToast]);

  const handleChangeMode = useCallback(
    (nextMode: AppMode) => {
      if (nextMode === mode) return;
      setMode(nextMode);
      setActiveDoc(null);
      setSelectedSubject(null);
      setSelectedProfessor(null);
      if (nextMode === 'cloud' && activeTab === 'import') {
        setActiveTab('library');
      }
      if (nextMode === 'cloud' && cloudDocuments.length === 0) {
        if (getMemoryAccessToken() || getSavedDriveClientId().trim()) {
          void handleConnectOrRefreshCloud();
        }
      }
    },
    [mode, activeTab, cloudDocuments.length, handleConnectOrRefreshCloud]
  );

  const handleLinkRootFolder = async () => {
    try {
      const handle = await pickRootDirectory();
      await saveRootDirectoryHandle(handle);
      setRootHandle(handle);
      setRootFolderName(handle.name);
      setNeedsPermissionReconnect(false);
      setSelectedSubject(null);
      setSelectedProfessor(null);
      await loadDirectoryAndIndex(handle);
      showToast(`Dossier « ${handle.name} » lié avec succès.`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showToast(
        err instanceof Error ? err.message : 'Impossible de lier ce dossier.',
        'error'
      );
    }
  };

  const handleReconnectRootFolder = async () => {
    if (!rootHandle) return;
    const granted = await verifyDirectoryPermission(rootHandle, true);
    if (granted) {
      setNeedsPermissionReconnect(false);
      await loadDirectoryAndIndex(rootHandle);
      showToast(`Accès réactivé pour « ${rootHandle.name} ».`);
    } else {
      showToast('Permission refusée sur le dossier local.', 'error');
    }
  };

  const handleRefreshTree = async () => {
    if (mode === 'cloud') {
      await handleConnectOrRefreshCloud();
      return;
    }
    if (!rootHandle || needsPermissionReconnect) return;
    await loadDirectoryAndIndex(rootHandle);
    showToast('Arborescence synchronisée avec le disque dur.');
  };

  const handleOpenDocument = useCallback(
    (doc: CourseDocument, page = 1, query = '') => {
      setActiveDoc(doc);
      setReaderPage(page);
      setHighlightQuery(query);
      setReaderJumpKey((k) => k + 1);
    },
    []
  );

  const handleCloseDocument = useCallback(() => {
    setActiveDoc(null);
    setHighlightQuery('');
  }, []);

  const handleRefreshClassifyQueue = async () => {
    if (!rootHandle || needsPermissionReconnect) return;
    await refreshClassifyQueue(rootHandle, rules, titleFormat);
    showToast(`Dossier « ${CLASSIFY_FOLDER_NAME} » rescanné.`);
  };

  const handleUpdateQueueItem = (
    id: string,
    patch: Partial<Pick<ImportQueueItem, 'subject' | 'professor' | 'targetName'>>
  ) => {
    setImportQueue((prev) =>
      prev.map((item) => (item.id === id ? {...item, ...patch} : item))
    );
  };

  const handleSortClassifyFolder = async (useEditedQueue = false) => {
    if (!rootHandle || needsPermissionReconnect) {
      showToast('Veuillez lier votre dossier local avant de trier les fichiers.', 'error');
      return;
    }

    const granted = await verifyDirectoryPermission(rootHandle, true);
    if (!granted) {
      showToast('Permission d’écriture requise sur le dossier local.', 'error');
      return;
    }

    setIsWritingImport(true);
    try {
      await resolveOrganizeSubfolders(rootHandle, true);

      let itemsToSort: ImportQueueItem[];
      if (useEditedQueue && importQueue.length > 0) {
        const editedPending = importQueue.filter((i) => i.status !== 'done');
        if (includeAlreadySorted) {
          const allScanned = await scanClassifyFolderItems(
            rootHandle,
            (name, mime) => parseCourseFilename(name, rules, mime, titleFormat),
            {includeAlreadySorted: true}
          );
          const alreadySortedOnly: ImportQueueItem[] = allScanned
            .filter((i) => !i.isFromOrganize)
            .map((item) => ({...item, status: 'pending' as const}));
          itemsToSort = [...editedPending, ...alreadySortedOnly];
        } else {
          itemsToSort = editedPending;
        }
      } else {
        const fresh = await scanClassifyFolderItems(
          rootHandle,
          (name, mime) => parseCourseFilename(name, rules, mime, titleFormat),
          {includeAlreadySorted}
        );
        itemsToSort = fresh.map((item) => ({
          ...item,
          status: 'pending' as const,
        }));
        setImportQueue(
          itemsToSort
            .filter((i) => i.isFromOrganize !== false)
        );
      }

      if (itemsToSort.length === 0) {
        showToast(
          `Aucun fichier (.pdf, .docx, .odt) trouvé dans « ${CLASSIFY_FOLDER_NAME} »${
            includeAlreadySorted ? ' ni dans les dossiers existants' : ''
          }.`
        );
        return;
      }

      const result = await sortClassifyFolderItems(rootHandle, itemsToSort, {
        cleanupEmptySortedFolders: includeAlreadySorted,
        onItemStatus: (id, status, error) => {
          setImportQueue((prev) =>
            prev.map((q) => (q.id === id ? {...q, status, error} : q))
          );
        },
      });

      await loadDirectoryAndIndex(rootHandle);

      const {
        newlyClassifiedCount,
        relocatedSortedCount,
        movedCount,
        unchangedCount,
        renamedDuplicatesCount,
        deletedFoldersCount,
        failedCount,
      } = result;

      if (movedCount > 0 || deletedFoldersCount > 0) {
        if (selectedSubject && isOrganizeRootFolderName(selectedSubject)) {
          setSelectedSubject(null);
          setSelectedProfessor(null);
        }
        const dupInfo =
          renamedDuplicatesCount > 0
            ? ` · ${renamedDuplicatesCount} doublon${
                renamedDuplicatesCount > 1 ? 's' : ''
              } renommé${renamedDuplicatesCount > 1 ? 's' : ''}`
            : '';
        const errInfo =
          failedCount > 0
            ? ` · ${failedCount} erreur${failedCount > 1 ? 's' : ''}`
            : '';
        showToast(
          `Tri terminé : ${newlyClassifiedCount} nouveau${
            newlyClassifiedCount > 1 ? 'x' : ''
          } cours classé${newlyClassifiedCount > 1 ? 's' : ''}, ${relocatedSortedCount} cours déjà trié${
            relocatedSortedCount > 1 ? 's' : ''
          } déplacé${relocatedSortedCount > 1 ? 's' : ''}, ${deletedFoldersCount} dossier${
            deletedFoldersCount > 1 ? 's' : ''
          } vide${deletedFoldersCount > 1 ? 's' : ''} supprimé${
            deletedFoldersCount > 1 ? 's' : ''
          }${dupInfo}${errInfo}.`
        );
      } else if (failedCount > 0) {
        showToast(
          `${failedCount} fichier${
            failedCount > 1 ? 's' : ''
          } n’ont pas pu être déplacés.`,
          'error'
        );
      } else {
        showToast(
          `Aucun déplacement nécessaire : ${unchangedCount} cours déjà au bon emplacement.`
        );
      }
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : `Impossible de trier le dossier « ${CLASSIFY_FOLDER_NAME} ».`,
        'error'
      );
    } finally {
      setIsWritingImport(false);
    }
  };

  const handleSaveRules = (nextRules: SortRule[]) => {
    setRules(nextRules);
    saveSortRules(nextRules);
    setImportQueue((prev) =>
      prev.map((item) => {
        if (item.status !== 'pending') return item;
        const reparsed = parseCourseFilename(
          item.originalName,
          nextRules,
          undefined,
          titleFormat
        );
        return {
          ...item,
          ueCode: reparsed.ueCode,
          subject: reparsed.subject,
          professor: reparsed.professor,
          targetName: reparsed.targetName,
          displayTitle: reparsed.displayTitle,
          courseType: reparsed.courseType,
          courseNumber: reparsed.courseNumber,
          matchedRulePattern: reparsed.matchedRulePattern,
        };
      })
    );
    showToast('Règles et alias enregistrés.');
  };

  const handleSaveTitleFormat = (nextFormat: TitleFormatSettings) => {
    setTitleFormat(nextFormat);
    saveTitleFormatSettings(nextFormat);
    setImportQueue((prev) =>
      prev.map((item) => {
        if (item.status !== 'pending') return item;
        const reparsed = parseCourseFilename(
          item.originalName,
          rules,
          undefined,
          nextFormat
        );
        return {
          ...item,
          ueCode: reparsed.ueCode,
          subject: reparsed.subject,
          professor: reparsed.professor,
          targetName: reparsed.targetName,
          displayTitle: reparsed.displayTitle,
          courseType: reparsed.courseType,
          courseNumber: reparsed.courseNumber,
          matchedRulePattern: reparsed.matchedRulePattern,
        };
      })
    );
    showToast('Format du titre de cours enregistré.');
  };

  const handleTriggerDriveBackup = () => {
    const plan = buildDriveBackupPlan(localDocuments);
    setDriveBackupPlan(plan);
    setDriveResultMessage(null);
    setDriveErrorMessage(null);
    setDriveUploadProgress(null);
    setDriveBackupModalOpen(true);
  };

  const handleConfirmDriveUpload = async () => {
    if (!driveBackupPlan) return;
    const clientId = getSavedDriveClientId();
    setIsUploadingDrive(true);
    setDriveErrorMessage(null);

    try {
      const token = await authenticateGoogleDrive(clientId);
      setIsCloudConnected(true);
      const {uploaded, skippedExisting, indexUpdated} = await executeDriveBackup(
        token,
        driveBackupPlan,
        setDriveUploadProgress
      );
      setDriveResultMessage(
        `${uploaded} fichier${uploaded > 1 ? 's' : ''} téléversé${uploaded > 1 ? 's' : ''} dans Sauvegarde_Cours${
          skippedExisting > 0
            ? ` (${skippedExisting} déjà présent${skippedExisting > 1 ? 's' : ''})`
            : ''
        }${indexUpdated ? ' · search_index.json mis à jour' : ''}.`
      );
    } catch (err) {
      setDriveErrorMessage(
        err instanceof Error ? err.message : 'Échec de la sauvegarde sur Google Drive.'
      );
    } finally {
      setIsUploadingDrive(false);
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B1120] text-slate-100">
      {/* Desktop Header */}
      <TopBar
        mode={mode}
        onChangeMode={handleChangeMode}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          if (tab === 'import' && rootHandle && !needsPermissionReconnect) {
            void refreshClassifyQueue(rootHandle, rules, titleFormat);
          }
        }}
        onOpenSearch={() => setIsSearchModalOpen(true)}
        onOpenRules={() => setIsRulesModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onTriggerDriveBackup={handleTriggerDriveBackup}
        onRefreshCloud={() => void handleConnectOrRefreshCloud()}
        hasRootFolder={!!rootHandle && !needsPermissionReconnect}
        isBackingUp={isUploadingDrive}
        isLoadingCloud={isLoadingCloud}
        isCloudConnected={isCloudConnected}
      />

      {/* Desktop 3-Panel Workstation (>= 768px) */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
        <FolderTreePanel
          mode={mode}
          rootFolderName={rootFolderName}
          needsPermissionReconnect={needsPermissionReconnect}
          isFsSupported={isFsSupported}
          isCloudConnected={isCloudConnected}
          isLoadingCloud={isLoadingCloud}
          cloudIndexDocCount={cloudIndex?.documents.length ?? 0}
          tree={tree}
          selectedSubject={selectedSubject}
          selectedProfessor={selectedProfessor}
          activeDocPath={activeDoc?.relativePath ?? null}
          indexingProgress={indexingProgress}
          titleFormat={titleFormat}
          rules={rules}
          onLinkRootFolder={handleLinkRootFolder}
          onReconnectRootFolder={handleReconnectRootFolder}
          onRefreshTree={() => void handleRefreshTree()}
          onConnectCloud={() => void handleConnectOrRefreshCloud()}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onSelectScope={(subject, professor) => {
            setSelectedSubject(subject);
            setSelectedProfessor(professor);
            setActiveTab('library');
          }}
          onOpenDocument={(doc) => handleOpenDocument(doc, 1, '')}
        />

        <CenterWorkspace
          mode={mode}
          activeTab={activeTab}
          hasRootFolder={!!rootHandle}
          needsPermissionReconnect={needsPermissionReconnect}
          isCloudConnected={isCloudConnected}
          documents={activeDocuments}
          selectedSubject={selectedSubject}
          selectedProfessor={selectedProfessor}
          activeDocPath={activeDoc?.relativePath ?? null}
          importQueue={importQueue}
          isWritingImport={isWritingImport}
          searchQuery={searchQuery}
          searchResults={searchResults}
          isSearching={isSearching}
          includeAlreadySorted={includeAlreadySorted}
          onToggleIncludeAlreadySorted={setIncludeAlreadySorted}
          titleFormat={titleFormat}
          rules={rules}
          onSelectTab={setActiveTab}
          onLinkRootFolder={handleLinkRootFolder}
          onConnectCloud={() => void handleConnectOrRefreshCloud()}
          onOpenDocument={handleOpenDocument}
          onSortClassifyFolder={(useEditedQueue) =>
            void handleSortClassifyFolder(useEditedQueue)
          }
          onRefreshClassifyQueue={() => void handleRefreshClassifyQueue()}
          onUpdateQueueItem={handleUpdateQueueItem}
          onRemoveQueueItem={(id) =>
            setImportQueue((prev) => prev.filter((item) => item.id !== id))
          }
          onSearchQueryChange={setSearchQuery}
          onOpenRules={() => setIsRulesModalOpen(true)}
          onOpenFlattenModal={() => setIsFlattenModalOpen(true)}
        />

        <PdfReaderPanel
          document={activeDoc}
          targetPage={readerPage}
          jumpKey={readerJumpKey}
          highlightQuery={highlightQuery}
          titleFormat={titleFormat}
          rules={rules}
          onPageChange={setReaderPage}
          onNotify={showToast}
        />
      </div>

      {/* Mobile Touch Shell (< 768px) */}
      <MobileWorkspace
        mode={mode}
        onChangeMode={handleChangeMode}
        isFsSupported={isFsSupported}
        isCloudConnected={isCloudConnected}
        isLoadingCloud={isLoadingCloud}
        hasBackupFolder={hasBackupFolder}
        cloudIndex={cloudIndex}
        hasRootFolder={!!rootHandle}
        rootFolderName={rootFolderName}
        needsPermissionReconnect={needsPermissionReconnect}
        documents={activeDocuments}
        tree={tree}
        activeDoc={activeDoc}
        readerPage={readerPage}
        readerJumpKey={readerJumpKey}
        highlightQuery={highlightQuery}
        titleFormat={titleFormat}
        rules={rules}
        onPageChange={setReaderPage}
        onOpenDocument={handleOpenDocument}
        onCloseDocument={handleCloseDocument}
        onNotify={showToast}
        onConnectCloud={handleConnectOrRefreshCloud}
        onDisconnectCloud={() => {
          setIsCloudConnected(false);
          setCloudDocuments([]);
          setActiveDoc((prev) => (prev?.source === 'cloud' ? null : prev));
          showToast('Session Google Drive déconnectée.');
        }}
        onRefreshCloud={handleConnectOrRefreshCloud}
        onLinkRootFolder={handleLinkRootFolder}
        onReconnectRootFolder={handleReconnectRootFolder}
        onTriggerDriveBackup={handleTriggerDriveBackup}
        onCloudIndexCleared={() => {
          setCloudIndex(null);
          showToast('Cache d’index mobile vidé.');
        }}
      />

      {/* Modals */}
      <GlobalSearchModal
        isOpen={isSearchModalOpen}
        mode={mode}
        cloudIndex={cloudIndex}
        initialQuery={searchQuery}
        documents={activeDocuments}
        titleFormat={titleFormat}
        rules={rules}
        onClose={() => setIsSearchModalOpen(false)}
        onSelectResult={(doc, page, query) => {
          setSearchQuery(query);
          handleOpenDocument(doc, page, query);
        }}
        onPinResultsToPanel={(query, results) => {
          setSearchQuery(query);
          setSearchResults(results);
          setActiveTab('search');
        }}
      />

      <RulesEditorModal
        isOpen={isRulesModalOpen}
        rules={rules}
        titleFormat={titleFormat}
        sampleOrganizeFilename={sampleOrganizeFilename}
        onSaveRules={handleSaveRules}
        onSaveTitleFormat={handleSaveTitleFormat}
        onClose={() => setIsRulesModalOpen(false)}
      />

      <SettingsAndDriveModal
        isOpen={isSettingsModalOpen}
        hasRootFolder={!!rootHandle && !needsPermissionReconnect}
        rules={rules}
        titleFormat={titleFormat}
        sampleOrganizeFilename={sampleOrganizeFilename}
        onChangeTitleFormat={handleSaveTitleFormat}
        onClose={() => setIsSettingsModalOpen(false)}
        onReindexAll={() => {
          if (rootHandle && !needsPermissionReconnect) {
            void loadDirectoryAndIndex(rootHandle, true);
            showToast('Réindexation complète lancée en arrière-plan.');
          }
        }}
        onClearIndex={async () => {
          await clearSearchIndex();
          setLocalDocuments((prev) =>
            prev.map((d) => ({...d, pageCount: 0, indexedAt: undefined}))
          );
          showToast('Index IndexedDB vidé.');
        }}
        onCloudIndexCleared={() => {
          setCloudIndex(null);
          showToast('Cache d’index cloud vidé.');
        }}
        onCloudAuthChanged={(connected) => {
          setIsCloudConnected(connected);
          if (!connected) {
            setCloudDocuments([]);
            setActiveDoc((prev) => (prev?.source === 'cloud' ? null : prev));
          }
        }}
      />

      <DriveBackupConfirmModal
        isOpen={driveBackupModalOpen}
        plan={driveBackupPlan}
        hasClientId={!!getSavedDriveClientId().trim()}
        isUploading={isUploadingDrive}
        progress={driveUploadProgress}
        resultMessage={driveResultMessage}
        errorMessage={driveErrorMessage}
        onConfirmUpload={handleConfirmDriveUpload}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onClose={() => setDriveBackupModalOpen(false)}
      />

      <FlattenFolderModal
        isOpen={isFlattenModalOpen}
        rootHandle={rootHandle}
        onClose={() => setIsFlattenModalOpen(false)}
        onComplete={async (res) => {
          if (rootHandle) {
            await loadDirectoryAndIndex(rootHandle);
          }
          if (res.movedCount > 0) {
            setSelectedSubject(res.organizeFolderName);
            setSelectedProfessor(res.generalFolderName);
            setActiveTab('library');
          }
          const keptPart =
            res.keptFolders.length > 0
              ? ` · ${res.keptFolders.length} dossier${
                  res.keptFolders.length > 1 ? 's' : ''
                } conservé${res.keptFolders.length > 1 ? 's' : ''} (autres fichiers)`
              : '';
          showToast(
            `${res.movedCount} fichier${res.movedCount > 1 ? 's' : ''} déplacé${
              res.movedCount > 1 ? 's' : ''
            } vers « ${ORGANIZE_FOLDER_NAME} » · ${res.deletedFoldersCount} dossier${
              res.deletedFoldersCount > 1 ? 's' : ''
            } vide${res.deletedFoldersCount > 1 ? 's' : ''} supprimé${
              res.deletedFoldersCount > 1 ? 's' : ''
            }${keptPart}.`
          );
        }}
      />

      {/* Non-intrusive toast */}
      {toastMessage && (
        <div
          role="status"
          className={`fixed bottom-20 md:bottom-4 right-4 z-50 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-xl max-w-[calc(100vw-2rem)] ${
            toastMessage.tone === 'error'
              ? 'border-rose-500/40 bg-[#0F172A] text-rose-200'
              : 'border-slate-700 bg-[#0F172A] text-slate-100'
          }`}
        >
          {toastMessage.text}
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
