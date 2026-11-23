import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {
  AppMode,
  CloudSearchIndexPayload,
  CourseDocument,
  DriveBackupPlan,
  IndexingProgress,
  ImportQueueItem,
  QuizFolderTarget,
  SearchResult,
  SortRule,
  TitleFormatSettings,
  WorkspaceTab,
} from './types/course';
import {
  clearSearchIndex,
  getAllIndexedDocuments,
  getCloudDocumentsCache,
  getCloudSearchIndex,
  getRootDirectoryHandle,
  pruneMissingDocuments,
  saveCloudDocumentsCache,
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
  renameWorkspaceDirectory,
  scanOrganizePreviewItems,
  scanRootDirectory,
  sortEntireWorkspace,
} from './services/filesystem';
import {
  loadSortRules,
  loadTitleFormatSettings,
  normalizeTitleFormatSettings,
  parseCourseFilename,
  saveSortRules,
  saveTitleFormatSettings,
  syncRulesOnFolderRename,
} from './services/parser';
import {indexDocumentsQueue} from './services/pdfEngine';
import {
  analyzeDriveMirrorPlan,
  authenticateGoogleDrive,
  downloadCloudConfig,
  downloadCloudSearchIndex,
  executeDriveMirrorSync,
  fetchCloudDriveLibrary,
  fetchDriveFileModifiedTime,
  getMemoryAccessToken,
  getSavedDriveClientId,
  getStoredDriveEmail,
  uploadCloudConfig,
  type DriveMirrorAnalysisResult,
  type DriveMirrorProgress,
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
import {RenameFolderModal, type RenameFolderTarget} from './components/RenameFolderModal';
import {FolderQuizModal} from './components/FolderQuizModal';
import {OfflineIndicator} from './components/OfflineIndicator';

const CLOUD_CONFIG_MTIME_KEY = 'foliocours_cloud_config_mtime';

function detectInitialMode(): AppMode {
  if (typeof window === 'undefined') return 'local';
  if (!isFileSystemAccessSupported() || window.innerWidth < 768) {
    return 'cloud';
  }
  return 'local';
}

function areCloudDocumentListsEqual(a: CourseDocument[], b: CourseDocument[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.relativePath !== right.relativePath ||
      left.driveFileId !== right.driveFileId ||
      left.driveParentFolderId !== right.driveParentFolderId ||
      left.driveModifiedTime !== right.driveModifiedTime ||
      left.size !== right.size ||
      left.lastModified !== right.lastModified ||
      left.pageCount !== right.pageCount
    ) {
      return false;
    }
  }
  return true;
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
  const cloudDocumentsRef = useRef<CourseDocument[]>(cloudDocuments);
  cloudDocumentsRef.current = cloudDocuments;
  const cloudIndexRef = useRef<CloudSearchIndexPayload | null>(cloudIndex);
  cloudIndexRef.current = cloudIndex;
  const isCloudRefreshingRef = useRef(false);
  const lastAutoCloudRefreshAtRef = useRef(0);
  const cloudConfigFileIdRef = useRef<string | null>(null);
  const cloudConfigSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigation & Selection State
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('library');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedProfessor, setSelectedProfessor] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<CourseDocument | null>(null);
  const [readerPage, setReaderPage] = useState(1);
  const [readerJumpKey, setReaderJumpKey] = useState(0);
  const [highlightQuery, setHighlightQuery] = useState('');

  // Import, Rules & Editable Title Format State
  const [rules, setRules] = useState<SortRule[]>(() => loadSortRules());
  const [titleFormat, setTitleFormat] = useState<TitleFormatSettings>(() =>
    loadTitleFormatSettings()
  );
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
  const [searchWholeWordOnly, setSearchWholeWordOnly] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Modals State
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isFlattenModalOpen, setIsFlattenModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameFolderTarget | null>(null);
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [quizTarget, setQuizTarget] = useState<QuizFolderTarget | null>(null);

  // Google Drive Mirror Sync State
  const [driveBackupModalOpen, setDriveBackupModalOpen] = useState(false);
  const [driveBackupPlan, setDriveBackupPlan] = useState<DriveBackupPlan | null>(null);
  const [driveMirrorAnalysis, setDriveMirrorAnalysis] =
    useState<DriveMirrorAnalysisResult | null>(null);
  const [isAnalyzingDrive, setIsAnalyzingDrive] = useState(false);
  const [isUploadingDrive, setIsUploadingDrive] = useState(false);
  const [driveUploadProgress, setDriveUploadProgress] =
    useState<DriveMirrorProgress | null>(null);
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

  useEffect(() => {
    return () => {
      if (cloudConfigSyncTimerRef.current) {
        clearTimeout(cloudConfigSyncTimerRef.current);
      }
    };
  }, []);

  const activeDocuments = mode === 'cloud' ? cloudDocuments : localDocuments;
  const tree = useMemo(() => buildCourseTree(activeDocuments), [activeDocuments]);
  const sampleFilename = useMemo(
    () =>
      importQueue[0]?.originalName ??
      localDocuments[0]?.name ??
      cloudDocuments[0]?.name ??
      null,
    [importQueue, localDocuments, cloudDocuments]
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
      activeFormat: TitleFormatSettings = titleFormat,
      activeRules: SortRule[] = rules
    ) => {
      try {
        const scannedItems = await scanOrganizePreviewItems(
          handle,
          (name, mime) => parseCourseFilename(name, activeFormat, mime, activeRules)
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
    [titleFormat, rules]
  );

  const loadDirectoryAndIndex = useCallback(
    async (
      handle: FileSystemDirectoryHandle,
      forceReindex = false,
      activeRules: SortRule[] = rules,
      activeFormat: TitleFormatSettings = titleFormat
    ) => {
      const indexedMap = await getAllIndexedDocuments();
      const scannedDocs = await scanRootDirectory(handle, indexedMap);
      const validPaths = new Set(scannedDocs.map((d) => d.relativePath));
      await pruneMissingDocuments(validPaths);

      setLocalDocuments(scannedDocs);
      setActiveDoc((prev) => {
        if (!prev || prev.source === 'cloud') return prev;
        return scannedDocs.find((d) => d.relativePath === prev.relativePath) ?? null;
      });

      await refreshClassifyQueue(handle, activeFormat, activeRules);
      void runIndexing(scannedDocs, forceReindex);
    },
    [refreshClassifyQueue, titleFormat, rules, runIndexing]
  );

  // Restore saved local directory handle & cached cloud tree/index on startup
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [cachedCloudIdx, cachedCloudDocs] = await Promise.all([
          getCloudSearchIndex().catch(() => null),
          getCloudDocumentsCache().catch(() => [] as CourseDocument[]),
        ]);
        if (mounted && cachedCloudIdx) {
          cloudIndexRef.current = cachedCloudIdx;
          setCloudIndex(cachedCloudIdx);
        }
        if (mounted && cachedCloudDocs.length > 0) {
          cloudDocumentsRef.current = cachedCloudDocs;
          setCloudDocuments(cachedCloudDocs);
        }
      } catch {
        // ignore IndexedDB cache restore error
      }

      if (getMemoryAccessToken() && mounted) {
        setIsCloudConnected(true);
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
            ? searchCloudIndexPayload(cloudIndex, trimmed, cloudDocuments, 80, {
                wholeWordOnly: searchWholeWordOnly,
              })
            : await searchIndexedLibrary(trimmed, 80, {
                wholeWordOnly: searchWholeWordOnly,
              });
        if (!cancelled) setSearchResults(hits);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeTab, searchQuery, searchWholeWordOnly, mode, cloudIndex, cloudDocuments]);

  const handleConnectOrRefreshCloud = useCallback(
    async (options?: {silentAuto?: boolean}) => {
      const silentAuto = !!options?.silentAuto;
      if (isCloudRefreshingRef.current) return;

      const existingToken = getMemoryAccessToken();
      const clientId = getSavedDriveClientId();

      if (!existingToken && !clientId.trim()) {
        if (!silentAuto) {
          showToast(
            'Configurez d’abord votre Client ID Google Cloud dans les paramètres.',
            'error'
          );
          if (window.innerWidth >= 768) {
            setIsSettingsModalOpen(true);
          }
        }
        return;
      }

      if (!silentAuto) {
        lastAutoCloudRefreshAtRef.current = Date.now();
      }

      isCloudRefreshingRef.current = true;
      setIsLoadingCloud(true);

      try {
        // Start token check/renewal synchronously within click activation before any IndexedDB await
        const tokenPromise = existingToken
          ? Promise.resolve(existingToken)
          : authenticateGoogleDrive(clientId, {silentOnly: silentAuto});

        // Hydrate cached tree and index immediately from IndexedDB while network check runs
        if (cloudDocumentsRef.current.length === 0) {
          const cachedDocs = await getCloudDocumentsCache().catch(() => []);
          if (cachedDocs.length > 0 && cloudDocumentsRef.current.length === 0) {
            cloudDocumentsRef.current = cachedDocs;
            setCloudDocuments(cachedDocs);
          }
        }
        if (!cloudIndexRef.current) {
          const cachedIdx = await getCloudSearchIndex().catch(() => null);
          if (cachedIdx && !cloudIndexRef.current) {
            cloudIndexRef.current = cachedIdx;
            setCloudIndex(cachedIdx);
          }
        }

        let token = await tokenPromise;
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
            token = await authenticateGoogleDrive(clientId, {silentOnly: silentAuto});
            libraryResult = await fetchCloudDriveLibrary(token);
          } else {
            throw libErr;
          }
        }

        const {
          hasBackupFolder: folderExists,
          documents: remoteDocs,
          searchIndexFileId,
          searchIndexModifiedTime,
          configFileId,
          configModifiedTime,
        } = libraryResult;
        setHasBackupFolder(folderExists);
        cloudConfigFileIdRef.current = configFileId;

        let latestIndex = cloudIndexRef.current;
        let indexDownloadedFresh = false;
        let configSynced = false;
        if (searchIndexFileId) {
          try {
            const remoteModifiedTime =
              (await fetchDriveFileModifiedTime(token, searchIndexFileId)) ??
              searchIndexModifiedTime;
            const cachedTs = latestIndex?.driveModifiedTime
              ? Date.parse(latestIndex.driveModifiedTime)
              : 0;
            const remoteTs = remoteModifiedTime ? Date.parse(remoteModifiedTime) : 0;
            const needsDownload =
              !latestIndex ||
              !latestIndex.driveModifiedTime ||
              (remoteTs > 0 && remoteTs > cachedTs) ||
              (!!remoteModifiedTime &&
                remoteModifiedTime !== latestIndex.driveModifiedTime);

            if (needsDownload) {
              const downloaded = await downloadCloudSearchIndex(
                token,
                searchIndexFileId
              );
              latestIndex = {
                ...downloaded,
                driveFileId: searchIndexFileId,
                driveModifiedTime: remoteModifiedTime ?? undefined,
              };
              await saveCloudSearchIndex(latestIndex);
              cloudIndexRef.current = latestIndex;
              setCloudIndex(latestIndex);
              indexDownloadedFresh = true;
            }
          } catch (idxErr) {
            console.warn('Impossible de charger search_index.json:', idxErr);
          }
        }

        // Sync display format settings from Drive (config.json preferred, search_index.json fallback)
        if (configFileId) {
          try {
            const remoteConfigMtime =
              (await fetchDriveFileModifiedTime(token, configFileId)) ??
              configModifiedTime;
            const cachedConfigMtime = localStorage.getItem(CLOUD_CONFIG_MTIME_KEY);
            const shouldDownloadConfig =
              !cachedConfigMtime ||
              (!!remoteConfigMtime && remoteConfigMtime !== cachedConfigMtime);

            if (shouldDownloadConfig) {
              const cloudCfg = await downloadCloudConfig(token, configFileId);
              if (cloudCfg?.titleFormat) {
                const normalizedFormat = normalizeTitleFormatSettings(cloudCfg.titleFormat);
                setTitleFormat(normalizedFormat);
                saveTitleFormatSettings(normalizedFormat);
                configSynced = true;
              }
              if (remoteConfigMtime) {
                localStorage.setItem(CLOUD_CONFIG_MTIME_KEY, remoteConfigMtime);
              }
            }
          } catch (cfgErr) {
            console.warn('Impossible de charger config.json:', cfgErr);
          }
        } else if (indexDownloadedFresh && latestIndex?.titleFormat) {
          const normalizedFormat = normalizeTitleFormatSettings(latestIndex.titleFormat);
          setTitleFormat(normalizedFormat);
          saveTitleFormatSettings(normalizedFormat);
          configSynced = true;
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

        const docsChanged = !areCloudDocumentListsEqual(
          cloudDocumentsRef.current,
          enriched
        );
        if (docsChanged) {
          cloudDocumentsRef.current = enriched;
          setCloudDocuments(enriched);
          await saveCloudDocumentsCache(enriched).catch(() => {});
        }

        if (!folderExists) {
          if (!silentAuto) {
            showToast(
              'Dossier « Sauvegarde_Cours » introuvable sur votre Drive.',
              'error'
            );
          }
        } else if (!silentAuto) {
          showToast(
            `${enriched.length} cours chargés depuis Google Drive${
              latestIndex
                ? indexDownloadedFresh
                  ? ' (index téléchargé)'
                  : ' (index en cache déjà à jour)'
                : ''
            }.`
          );
        } else if (docsChanged || indexDownloadedFresh || configSynced) {
          showToast(`Cloud Drive mis à jour (${enriched.length} cours).`);
        }
      } catch (err) {
        if (!getMemoryAccessToken()) {
          setIsCloudConnected(false);
        }
        if (!silentAuto) {
          showToast(
            err instanceof Error ? err.message : 'Erreur de connexion Google Drive.',
            'error'
          );
        }
      } finally {
        isCloudRefreshingRef.current = false;
        setIsLoadingCloud(false);
      }
    },
    [showToast]
  );

  // Automatic refresh when switching to the « Cloud Drive » tab (20s cooldown + isRefreshing lock)
  useEffect(() => {
    if (mode !== 'cloud') return;
    if (isCloudRefreshingRef.current) return;

    const now = Date.now();
    if (now - lastAutoCloudRefreshAtRef.current < 20_000) return;

    const clientId = getSavedDriveClientId().trim();
    if (!clientId) return;
    if (!getMemoryAccessToken() && !getStoredDriveEmail()) return;

    lastAutoCloudRefreshAtRef.current = now;
    void handleConnectOrRefreshCloud({silentAuto: true});
  }, [mode, handleConnectOrRefreshCloud]);

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
    },
    [mode, activeTab]
  );

  const ensureWritableRootHandle =
    useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
      if (!isFsSupported) {
        showToast(
          "Votre navigateur ne prend pas en charge l'API File System Access. Utilisez Chrome, Edge ou Opera.",
          'error'
        );
        return null;
      }

      if (!rootHandle) {
        const picked = await window.showDirectoryPicker({mode: 'readwrite'});
        await saveRootDirectoryHandle(picked);
        setRootHandle(picked);
        setRootFolderName(picked.name);
        setNeedsPermissionReconnect(false);
        return picked;
      }

      const currentPerm = await rootHandle.queryPermission({mode: 'readwrite'});
      if (currentPerm !== 'granted') {
        const requestedPerm = await rootHandle.requestPermission({mode: 'readwrite'});
        if (requestedPerm !== 'granted') {
          setNeedsPermissionReconnect(true);
          return null;
        }
      }
      setNeedsPermissionReconnect(false);
      return rootHandle;
    }, [isFsSupported, rootHandle, showToast]);

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
    try {
      const activeRoot = await ensureWritableRootHandle();
      if (activeRoot) {
        await loadDirectoryAndIndex(activeRoot);
        showToast(`Accès réactivé pour « ${activeRoot.name} ».`);
      } else {
        showToast('Permission refusée sur le dossier local.', 'error');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showToast(
        err instanceof Error ? err.message : 'Permission refusée sur le dossier local.',
        'error'
      );
    }
  };

  const handleRefreshTree = async () => {
    if (mode === 'cloud') {
      await handleConnectOrRefreshCloud();
      return;
    }
    try {
      const activeRoot = await ensureWritableRootHandle();
      if (!activeRoot) {
        showToast('Permission refusée sur le dossier local.', 'error');
        return;
      }
      await loadDirectoryAndIndex(activeRoot);
      showToast('Arborescence synchronisée avec le disque dur.');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showToast(
        err instanceof Error ? err.message : 'Impossible d’accéder au dossier local.',
        'error'
      );
    }
  };

  const handleReindexAll = async () => {
    if (mode === 'cloud') {
      await handleConnectOrRefreshCloud();
      return;
    }
    try {
      const activeRoot = await ensureWritableRootHandle();
      if (!activeRoot) {
        showToast('Permission refusée sur le dossier local.', 'error');
        return;
      }
      await loadDirectoryAndIndex(activeRoot, true);
      showToast('Réindexation complète lancée en arrière-plan.');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showToast(
        err instanceof Error ? err.message : 'Impossible d’indexer le dossier local.',
        'error'
      );
    }
  };

  const handleOpenDocument = useCallback(
    async (doc: CourseDocument, page = 1, query = '') => {
      if (doc.source !== 'cloud') {
        try {
          const activeRoot = await ensureWritableRootHandle();
          if (!activeRoot) {
            showToast('Permission requise pour ouvrir ce fichier local.', 'error');
            return;
          }
          if (doc.handle) {
            const filePerm = await doc.handle.queryPermission({mode: 'read'});
            if (filePerm !== 'granted') {
              const reqPerm = await doc.handle.requestPermission({mode: 'read'});
              if (reqPerm !== 'granted') {
                showToast('Permission refusée sur ce fichier local.', 'error');
                return;
              }
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          showToast(
            err instanceof Error ? err.message : 'Impossible d’accéder au fichier local.',
            'error'
          );
          return;
        }
      }
      setActiveDoc(doc);
      setReaderPage(page);
      setHighlightQuery(query);
      setReaderJumpKey((k) => k + 1);
    },
    [ensureWritableRootHandle, showToast]
  );

  const handleCloseDocument = useCallback(() => {
    setActiveDoc(null);
    setHighlightQuery('');
  }, []);

  const handleRefreshClassifyQueue = async () => {
    try {
      const activeRoot = await ensureWritableRootHandle();
      if (!activeRoot) {
        showToast('Permission refusée sur le dossier local.', 'error');
        return;
      }
      await refreshClassifyQueue(activeRoot, titleFormat, rules);
      showToast(`Dossier « ${CLASSIFY_FOLDER_NAME} » rescanné.`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showToast(
        err instanceof Error ? err.message : 'Impossible d’accéder au dossier local.',
        'error'
      );
    }
  };

  const handleUpdateQueueItem = (
    id: string,
    patch: Partial<Pick<ImportQueueItem, 'subject' | 'professor' | 'targetName'>>
  ) => {
    setImportQueue((prev) =>
      prev.map((item) => (item.id === id ? {...item, ...patch} : item))
    );
  };

  const handleSortWorkspace = async (useEditedQueue = false) => {
    if (mode === 'cloud') {
      await handleConnectOrRefreshCloud();
      return;
    }

    let activeRoot: FileSystemDirectoryHandle | null = null;
    try {
      activeRoot = await ensureWritableRootHandle();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showToast(
        err instanceof Error ? err.message : 'Impossible d’accéder au dossier local.',
        'error'
      );
      return;
    }

    if (!activeRoot) {
      showToast('Permission d’écriture requise sur le dossier local.', 'error');
      return;
    }

    setIsWritingImport(true);
    try {
      let overridesMap:
        | Map<string, {subject: string; professor: string; targetName: string}>
        | undefined;
      if (useEditedQueue && importQueue.length > 0) {
        overridesMap = new Map();
        for (const q of importQueue) {
          if (q.status !== 'done') {
            overridesMap.set(q.id, {
              subject: q.subject,
              professor: q.professor,
              targetName: q.targetName,
            });
          }
        }
      }

      const result = await sortEntireWorkspace(
        activeRoot,
        (name, mime) => parseCourseFilename(name, titleFormat, mime, rules),
        overridesMap
      );

      await loadDirectoryAndIndex(activeRoot);

      const {
        movedCount,
        unchangedCount,
        renamedDuplicatesCount,
        deletedFoldersCount,
        failedCount,
        totalScannedCount,
      } = result;

      if (selectedSubject && isOrganizeRootFolderName(selectedSubject)) {
        setSelectedSubject(null);
        setSelectedProfessor(null);
      }

      if (totalScannedCount === 0 && deletedFoldersCount === 0) {
        showToast('Aucun fichier (.pdf, .docx, .odt) trouvé dans l’espace de travail.');
        return;
      }

      if (movedCount > 0 || deletedFoldersCount > 0) {
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
          `Tri global terminé : ${movedCount} fichier${
            movedCount > 1 ? 's' : ''
          } déplacé${movedCount > 1 ? 's' : ''}, ${unchangedCount} déjà en place, ${deletedFoldersCount} dossier${
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
          : 'Impossible de trier l’espace de travail.',
        'error'
      );
    } finally {
      setIsWritingImport(false);
    }
  };

  const handleRenameFolder = async (
    target: RenameFolderTarget,
    newName: string
  ) => {
    const activeRoot = await ensureWritableRootHandle();
    if (!activeRoot) {
      throw new Error('Permission d’écriture requise sur le dossier local.');
    }

    setIsRenamingFolder(true);
    try {
      const renameRes = await renameWorkspaceDirectory(activeRoot, {
        kind: target.kind,
        subjectName: target.subjectName,
        professorName: target.professorName,
        newName,
      });

      if (renameRes.oldName === renameRes.newName) {
        return;
      }

      const syncRes = syncRulesOnFolderRename({
        targetType: target.kind,
        oldName: renameRes.oldName,
        newName: renameRes.newName,
        existingRules: rules,
      });
      setRules(syncRes.rules);

      if (target.kind === 'subject' && selectedSubject === renameRes.oldName) {
        setSelectedSubject(renameRes.newName);
      } else if (
        target.kind === 'professor' &&
        selectedSubject === target.subjectName &&
        selectedProfessor
      ) {
        const parts = selectedProfessor.split(' / ');
        if (parts[parts.length - 1] === renameRes.oldName) {
          parts[parts.length - 1] = renameRes.newName;
          setSelectedProfessor(parts.join(' / '));
        }
      }

      // Preserve active document selection in reader across folder rename
      if (activeDoc && activeDoc.source !== 'cloud') {
        const oldPrefix =
          target.kind === 'subject'
            ? `${renameRes.oldName}/`
            : `${target.subjectName}/${target.professorName?.replace(/ \/ /g, '/')}/`;
        if (activeDoc.relativePath.startsWith(oldPrefix)) {
          const newPrefix =
            target.kind === 'subject'
              ? `${renameRes.newName}/`
              : (() => {
                  const profSegs = (target.professorName ?? '').split(' / ');
                  profSegs[profSegs.length - 1] = renameRes.newName;
                  return `${target.subjectName}/${profSegs.join('/')}/`;
                })();
          const nextRelPath = `${newPrefix}${activeDoc.relativePath.slice(oldPrefix.length)}`;
          setActiveDoc((prev) =>
            prev
              ? {
                  ...prev,
                  relativePath: nextRelPath,
                  subject:
                    target.kind === 'subject' ? renameRes.newName : prev.subject,
                  professor:
                    target.kind === 'professor'
                      ? (() => {
                          const profSegs = (target.professorName ?? '').split(' / ');
                          profSegs[profSegs.length - 1] = renameRes.newName;
                          return profSegs.join(' / ');
                        })()
                      : prev.professor,
                }
              : prev
          );
        }
      }

      await loadDirectoryAndIndex(activeRoot, false, syncRes.rules, titleFormat);

      const ruleMsg =
        syncRes.action === 'updated'
          ? `${syncRes.updatedCount} règle${
              syncRes.updatedCount > 1 ? 's' : ''
            } existante${syncRes.updatedCount > 1 ? 's' : ''} mise${
              syncRes.updatedCount > 1 ? 's' : ''
            } à jour vers « ${renameRes.newName} »`
          : syncRes.action === 'created'
          ? `nouvelle règle d’alias créée (${renameRes.oldName} → ${renameRes.newName})`
          : 'règle d’alias conservée';

      showToast(
        `Dossier « ${renameRes.oldName} » renommé en « ${renameRes.newName} » · ${ruleMsg}.`
      );
    } finally {
      setIsRenamingFolder(false);
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
          titleFormat,
          undefined,
          nextRules
        );
        return {
          ...item,
          ueCode: reparsed.ueCode,
          subject: reparsed.subject,
          professor: reparsed.professor,
          targetName: reparsed.targetName,
          displayTitle: reparsed.displayTitle,
          matchedRulePattern: undefined,
        };
      })
    );
  };

  const handleSaveTitleFormat = useCallback(
    (nextFormat: TitleFormatSettings, options?: {notify?: boolean}) => {
      const normalized = normalizeTitleFormatSettings(nextFormat);
      setTitleFormat(normalized);
      saveTitleFormatSettings(normalized);
      setImportQueue((prev) =>
        prev.map((item) => {
          if (item.status !== 'pending') return item;
          const reparsed = parseCourseFilename(
            item.originalName,
            normalized,
            undefined,
            rules
          );
          return {
            ...item,
            ueCode: reparsed.ueCode,
            subject: reparsed.subject,
            professor: reparsed.professor,
            targetName: reparsed.targetName,
            displayTitle: reparsed.displayTitle,
            matchedRulePattern: undefined,
          };
        })
      );

      if (options?.notify) {
        showToast('Format et règles d’alias enregistrés.');
      }

      if (mode === 'cloud') {
        if (cloudConfigSyncTimerRef.current) {
          clearTimeout(cloudConfigSyncTimerRef.current);
        }
        cloudConfigSyncTimerRef.current = setTimeout(() => {
          void (async () => {
            try {
              const clientId = getSavedDriveClientId().trim();
              let token = getMemoryAccessToken();
              if (!token && clientId && getStoredDriveEmail()) {
                token = await authenticateGoogleDrive(clientId, {silentOnly: true});
              }
              if (!token) return;
              const uploadedCfg = await uploadCloudConfig(
                token,
                normalized,
                cloudConfigFileIdRef.current
              );
              if (uploadedCfg) {
                cloudConfigFileIdRef.current = uploadedCfg.id;
                if (uploadedCfg.modifiedTime) {
                  localStorage.setItem(CLOUD_CONFIG_MTIME_KEY, uploadedCfg.modifiedTime);
                }
              }
            } catch (err) {
              console.warn('Synchronisation config.json Drive ignorée:', err);
            }
          })();
        }, 600);
      }
    },
    [mode, rules, showToast]
  );

  const runDriveMirrorAnalysis = useCallback(async () => {
    const clientId = getSavedDriveClientId();
    if (!clientId.trim()) return;

    setIsAnalyzingDrive(true);
    setDriveErrorMessage(null);
    setDriveBackupPlan(null);
    setDriveMirrorAnalysis(null);

    try {
      let token = await authenticateGoogleDrive(clientId);
      setIsCloudConnected(true);
      let analysis: DriveMirrorAnalysisResult;
      try {
        analysis = await analyzeDriveMirrorPlan(token, localDocuments);
      } catch (err) {
        if (
          !getMemoryAccessToken() &&
          err instanceof Error &&
          err.message.includes('Session Google expirée')
        ) {
          token = await authenticateGoogleDrive(clientId);
          analysis = await analyzeDriveMirrorPlan(token, localDocuments);
        } else {
          throw err;
        }
      }
      setDriveMirrorAnalysis(analysis);
      setDriveBackupPlan(analysis.plan);
    } catch (err) {
      setDriveErrorMessage(
        err instanceof Error
          ? err.message
          : 'Impossible d’analyser la sauvegarde sur Google Drive.'
      );
    } finally {
      setIsAnalyzingDrive(false);
    }
  }, [localDocuments]);

  const handleTriggerDriveBackup = () => {
    setDriveBackupPlan(null);
    setDriveMirrorAnalysis(null);
    setDriveResultMessage(null);
    setDriveErrorMessage(null);
    setDriveUploadProgress(null);
    setDriveBackupModalOpen(true);
    void runDriveMirrorAnalysis();
  };

  const handleConfirmDriveUpload = async () => {
    if (!driveMirrorAnalysis) return;
    const clientId = getSavedDriveClientId();
    setIsUploadingDrive(true);
    setDriveErrorMessage(null);

    try {
      let token = await authenticateGoogleDrive(clientId);
      setIsCloudConnected(true);

      let syncRes;
      try {
        syncRes = await executeDriveMirrorSync(token, driveMirrorAnalysis, {
          deleteObsolete: true,
          titleFormat,
          onProgress: setDriveUploadProgress,
        });
      } catch (err) {
        if (
          !getMemoryAccessToken() &&
          err instanceof Error &&
          err.message.includes('Session Google expirée')
        ) {
          token = await authenticateGoogleDrive(clientId);
          syncRes = await executeDriveMirrorSync(token, driveMirrorAnalysis, {
            deleteObsolete: true,
            titleFormat,
            onProgress: setDriveUploadProgress,
          });
        } else {
          throw err;
        }
      }

      const folderSuffix =
        syncRes.deletedFolders > 0
          ? `, ${syncRes.deletedFolders} dossier${
              syncRes.deletedFolders > 1 ? 's' : ''
            } vide${syncRes.deletedFolders > 1 ? 's' : ''} nettoyé${
              syncRes.deletedFolders > 1 ? 's' : ''
            }`
          : '';
      const indexSuffix = syncRes.indexUpdated ? ' · search_index.json à jour' : '';
      const summaryLine = `${syncRes.uploaded} ajoutés/mis à jour, ${syncRes.deleted} supprimés sur Drive`;

      setDriveResultMessage(`${summaryLine}${folderSuffix}${indexSuffix}.`);
      showToast(summaryLine);
    } catch (err) {
      setDriveErrorMessage(
        err instanceof Error ? err.message : 'Échec de la synchronisation Google Drive.'
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
            void refreshClassifyQueue(rootHandle, titleFormat);
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
          onRequestRenameFolder={(target) => setRenameTarget(target)}
          onRequestFolderQuiz={(target) => setQuizTarget(target)}
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
          wholeWordOnly={searchWholeWordOnly}
          searchResults={searchResults}
          isSearching={isSearching}
          titleFormat={titleFormat}
          onSelectTab={setActiveTab}
          onLinkRootFolder={handleLinkRootFolder}
          onConnectCloud={() => void handleConnectOrRefreshCloud()}
          onOpenDocument={handleOpenDocument}
          onSortClassifyFolder={(useEditedQueue) =>
            void handleSortWorkspace(useEditedQueue)
          }
          onRefreshClassifyQueue={() => void handleRefreshClassifyQueue()}
          onUpdateQueueItem={handleUpdateQueueItem}
          onRemoveQueueItem={(id) =>
            setImportQueue((prev) => prev.filter((item) => item.id !== id))
          }
          onSearchQueryChange={setSearchQuery}
          onWholeWordOnlyChange={setSearchWholeWordOnly}
          onOpenRules={() => setIsRulesModalOpen(true)}
          onOpenFlattenModal={async () => {
            try {
              const activeRoot = await ensureWritableRootHandle();
              if (!activeRoot) {
                showToast('Permission requise sur le dossier local.', 'error');
                return;
              }
              setIsFlattenModalOpen(true);
            } catch (err) {
              if (err instanceof DOMException && err.name === 'AbortError') return;
              showToast(
                err instanceof Error
                  ? err.message
                  : 'Impossible d’accéder au dossier local.',
                'error'
              );
            }
          }}
        />

        <PdfReaderPanel
          document={activeDoc}
          mode={mode}
          allDocuments={activeDocuments}
          cloudIndex={cloudIndex}
          targetPage={readerPage}
          jumpKey={readerJumpKey}
          highlightQuery={highlightQuery}
          titleFormat={titleFormat}
          rules={rules}
          onPageChange={setReaderPage}
          onOpenDocument={handleOpenDocument}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
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
        onChangeTitleFormat={(next) => handleSaveTitleFormat(next)}
        onPageChange={setReaderPage}
        onOpenDocument={handleOpenDocument}
        onCloseDocument={handleCloseDocument}
        onRequestFolderQuiz={(target) => setQuizTarget(target)}
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
          showToast('Cache hors-ligne vidé.');
        }}
      />

      {/* Modals */}
      <GlobalSearchModal
        isOpen={isSearchModalOpen}
        mode={mode}
        cloudIndex={cloudIndex}
        initialQuery={searchQuery}
        wholeWordOnly={searchWholeWordOnly}
        onWholeWordOnlyChange={setSearchWholeWordOnly}
        documents={activeDocuments}
        titleFormat={titleFormat}
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
        sampleFilename={sampleFilename}
        onSaveRules={handleSaveRules}
        onSaveTitleFormat={(next) => handleSaveTitleFormat(next, {notify: true})}
        onClose={() => setIsRulesModalOpen(false)}
      />

      <SettingsAndDriveModal
        isOpen={isSettingsModalOpen}
        mode={mode}
        hasRootFolder={!!rootHandle && !needsPermissionReconnect}
        rules={rules}
        titleFormat={titleFormat}
        sampleFilename={sampleFilename}
        onChangeTitleFormat={(next) => handleSaveTitleFormat(next)}
        onClose={() => setIsSettingsModalOpen(false)}
        onReindexAll={() => void handleReindexAll()}
        onClearIndex={async () => {
          await clearSearchIndex();
          setLocalDocuments((prev) =>
            prev.map((d) => ({...d, pageCount: 0, indexedAt: undefined}))
          );
          showToast('Index IndexedDB vidé.');
        }}
        onCloudIndexCleared={() => {
          setCloudIndex(null);
          showToast('Cache hors-ligne vidé.');
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
        isAnalyzing={isAnalyzingDrive}
        isUploading={isUploadingDrive}
        progress={driveUploadProgress}
        resultMessage={driveResultMessage}
        errorMessage={driveErrorMessage}
        onConfirmUpload={handleConfirmDriveUpload}
        onRetryAnalyze={() => void runDriveMirrorAnalysis()}
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

      <RenameFolderModal
        target={renameTarget}
        isRenaming={isRenamingFolder}
        onConfirm={handleRenameFolder}
        onClose={() => setRenameTarget(null)}
      />

      <FolderQuizModal
        target={quizTarget}
        mode={mode}
        cloudIndex={cloudIndex}
        titleFormat={titleFormat}
        rules={rules}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onClose={() => setQuizTarget(null)}
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
