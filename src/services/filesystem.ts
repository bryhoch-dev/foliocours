import type {
  CourseDocument,
  CourseFileFormat,
  StoredDocumentMeta,
  SubjectGroup,
} from '../types/course';
import {getCourseFileFormat, stripSupportedExtension} from './fileFormats';

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function verifyDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  readWrite = true
): Promise<boolean> {
  const mode = readWrite ? 'readwrite' : 'read';
  try {
    if ((await handle.queryPermission({mode})) === 'granted') {
      return true;
    }
    if ((await handle.requestPermission({mode})) === 'granted') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function pickRootDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      "Votre navigateur ne prend pas en charge l'API File System Access. Utilisez Chrome, Edge ou Opera."
    );
  }
  return window.showDirectoryPicker({mode: 'readwrite'});
}

export function sanitizePathSegment(segment: string, fallback: string): string {
  const cleaned = segment
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return cleaned || fallback;
}

export function sanitizeCourseFileName(
  fileName: string,
  fallbackFormat: CourseFileFormat = 'pdf'
): string {
  const ext = getCourseFileFormat(fileName) ?? fallbackFormat;
  const base = sanitizePathSegment(stripSupportedExtension(fileName), 'Document');
  return `${base}.${ext}`;
}

export const ORGANIZE_ROOT_NAME = 'à organiser';
export const ORGANIZE_GENERAL_NAME = 'Général';
export const ORGANIZE_PATH_LABEL = `${ORGANIZE_ROOT_NAME}/${ORGANIZE_GENERAL_NAME}`;
export const CLASSIFY_FOLDER_NAME = ORGANIZE_PATH_LABEL;
export const ORGANIZE_FOLDER_NAME = ORGANIZE_PATH_LABEL;

function normalizeFolderForMatch(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function isOrganizeRootFolderName(name: string): boolean {
  return normalizeFolderForMatch(name) === 'a organiser';
}

export function isHiddenDotFolder(name: string): boolean {
  return name.trim().startsWith('.');
}

export function isExcludedSystemFolder(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.startsWith('.') || trimmed.toLowerCase() === 'sauvegarde_cours';
}

/**
 * Recursively scans the workspace directory (ignoring hidden .* folders and Sauvegarde_Cours)
 * to populate the document library without reading binary payloads into RAM.
 */
export async function scanRootDirectory(
  rootHandle: FileSystemDirectoryHandle,
  indexedMap: Map<string, StoredDocumentMeta>
): Promise<CourseDocument[]> {
  const docs: CourseDocument[] = [];

  const walk = async (
    dir: FileSystemDirectoryHandle,
    segments: string[]
  ): Promise<void> => {
    for await (const [entryName, entryHandle] of dir.entries()) {
      if (entryHandle.kind === 'file') {
        const format = getCourseFileFormat(entryName);
        if (!format) continue;

        const fileHandle = entryHandle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const relativePath =
          segments.length > 0 ? `${segments.join('/')}/${entryName}` : entryName;
        const indexed = indexedMap.get(relativePath);

        const subject = segments[0] ?? ORGANIZE_ROOT_NAME;
        const professor =
          segments.length === 0
            ? 'Racine'
            : segments.length === 1
            ? ORGANIZE_GENERAL_NAME
            : segments.slice(1).join(' / ');

        docs.push({
          relativePath,
          name: entryName,
          format,
          subject,
          professor,
          size: file.size,
          lastModified: file.lastModified,
          pageCount: indexed?.pageCount ?? 0,
          indexedAt: indexed?.indexedAt,
          handle: fileHandle,
        });
      } else if (entryHandle.kind === 'directory') {
        if (isExcludedSystemFolder(entryName)) continue;
        await walk(entryHandle as FileSystemDirectoryHandle, [...segments, entryName]);
      }
    }
  };

  await walk(rootHandle, []);
  docs.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'fr', {numeric: true}));
  return docs;
}

export function buildCourseTree(documents: CourseDocument[]): SubjectGroup[] {
  const subjectMap = new Map<string, Map<string, CourseDocument[]>>();

  for (const doc of documents) {
    let profMap = subjectMap.get(doc.subject);
    if (!profMap) {
      profMap = new Map<string, CourseDocument[]>();
      subjectMap.set(doc.subject, profMap);
    }
    let list = profMap.get(doc.professor);
    if (!list) {
      list = [];
      profMap.set(doc.professor, list);
    }
    list.push(doc);
  }

  const subjects: SubjectGroup[] = [];
  for (const [subjectName, profMap] of subjectMap.entries()) {
    const professors = [];
    let totalCount = 0;
    for (const [profName, docs] of profMap.entries()) {
      const sortedDocs = [...docs].sort((a, b) =>
        a.name.localeCompare(b.name, 'fr', {numeric: true})
      );
      professors.push({name: profName, documents: sortedDocs});
      totalCount += sortedDocs.length;
    }
    professors.sort((a, b) => a.name.localeCompare(b.name, 'fr', {numeric: true}));
    subjects.push({name: subjectName, professors, totalCount});
  }

  subjects.sort((a, b) => a.name.localeCompare(b.name, 'fr', {numeric: true}));
  return subjects;
}

/**
 * Finds an existing directory ignoring case and accents, or creates it if requested.
 */
async function findOrCreateDirectoryNormalized(
  parentDir: FileSystemDirectoryHandle,
  targetName: string,
  createIfMissing = true
): Promise<FileSystemDirectoryHandle | null> {
  const targetNorm = normalizeFolderForMatch(targetName);
  for await (const [entryName, entryHandle] of parentDir.entries()) {
    if (
      entryHandle.kind === 'directory' &&
      normalizeFolderForMatch(entryName) === targetNorm
    ) {
      return entryHandle as FileSystemDirectoryHandle;
    }
  }
  if (!createIfMissing) return null;
  return parentDir.getDirectoryHandle(targetName, {create: true});
}

/**
 * Checks existing directories case-insensitively first, then creates systematically via
 * getDirectoryHandle(..., { create: true }) after cleaning Windows-forbidden characters.
 */
async function findOrCreateDirectoryCaseInsensitive(
  parentDir: FileSystemDirectoryHandle,
  rawName: string,
  fallback: string
): Promise<FileSystemDirectoryHandle> {
  const safeName = sanitizePathSegment(rawName, fallback);
  const targetLower = safeName.toLowerCase();
  for await (const [entryName, entryHandle] of parentDir.entries()) {
    if (
      entryHandle.kind === 'directory' &&
      entryName.trim().toLowerCase() === targetLower
    ) {
      return entryHandle as FileSystemDirectoryHandle;
    }
  }
  return parentDir.getDirectoryHandle(safeName, {create: true});
}

/**
 * Resolves "à organiser" and its subfolder "Général" (case- and accent-insensitive).
 * Only creates them when createIfMissing = true (e.g. during "Importer / Aplatir un dossier").
 */
export async function resolveOrganizeSubfolders(
  rootHandle: FileSystemDirectoryHandle,
  createIfMissing = false
): Promise<{
  organizeDir: FileSystemDirectoryHandle;
  generalDir: FileSystemDirectoryHandle;
} | null> {
  const organizeDir = await findOrCreateDirectoryNormalized(
    rootHandle,
    ORGANIZE_ROOT_NAME,
    createIfMissing
  );
  if (!organizeDir) return null;

  const generalDir = await findOrCreateDirectoryNormalized(
    organizeDir,
    ORGANIZE_GENERAL_NAME,
    createIfMissing
  );
  if (!generalDir) return null;

  return {organizeDir, generalDir};
}

export interface FlattenPreviewSummary {
  sourceName: string;
  courseFilesCount: number;
  subfolderCount: number;
  otherFilesCount: number;
}

export interface FlattenExecutionResult {
  movedCount: number;
  renamedDuplicatesCount: number;
  deletedFoldersCount: number;
  keptFolders: string[];
  organizeFolderName: string;
  generalFolderName: string;
}

export interface GlobalSortResult {
  movedCount: number;
  unchangedCount: number;
  renamedDuplicatesCount: number;
  deletedFoldersCount: number;
  failedCount: number;
  totalScannedCount: number;
}

export async function listWorkspaceSubfolders(
  rootHandle: FileSystemDirectoryHandle
): Promise<string[]> {
  const folders: string[] = [];
  for await (const [name, handle] of rootHandle.entries()) {
    if (
      handle.kind === 'directory' &&
      !isOrganizeRootFolderName(name) &&
      !isExcludedSystemFolder(name)
    ) {
      folders.push(name);
    }
  }
  folders.sort((a, b) => a.localeCompare(b, 'fr', {numeric: true}));
  return folders;
}

async function isSameDirectoryHandle(
  a: FileSystemHandle,
  b: FileSystemHandle
): Promise<boolean> {
  if (typeof a.isSameEntry === 'function') {
    try {
      return await a.isSameEntry(b);
    } catch {
      return false;
    }
  }
  return false;
}

function getUniqueTargetFileName(
  desiredName: string,
  existingNamesLower: Set<string>
): {uniqueName: string; wasRenamed: boolean} {
  if (!existingNamesLower.has(desiredName.toLowerCase())) {
    existingNamesLower.add(desiredName.toLowerCase());
    return {uniqueName: desiredName, wasRenamed: false};
  }

  const extMatch = desiredName.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : '';
  const base = ext ? desiredName.slice(0, -ext.length) : desiredName;

  let index = 2;
  while (index < 10000) {
    const candidate = `${base} (${index})${ext}`;
    if (!existingNamesLower.has(candidate.toLowerCase())) {
      existingNamesLower.add(candidate.toLowerCase());
      return {uniqueName: candidate, wasRenamed: true};
    }
    index++;
  }

  const fallback = `${base} (${Date.now()})${ext}`;
  existingNamesLower.add(fallback.toLowerCase());
  return {uniqueName: fallback, wasRenamed: true};
}

async function moveFileHandleWithDuplicateCheck(
  fileHandle: FileSystemFileHandle,
  sourceParentHandle: FileSystemDirectoryHandle,
  sourceFileName: string,
  destDirHandle: FileSystemDirectoryHandle,
  desiredTargetName: string,
  existingNamesLower: Set<string>
): Promise<{finalName: string; wasRenamed: boolean}> {
  const {uniqueName, wasRenamed} = getUniqueTargetFileName(
    desiredTargetName,
    existingNamesLower
  );

  let movedViaNativeApi = false;
  if (typeof fileHandle.move === 'function') {
    try {
      await fileHandle.move(destDirHandle, uniqueName);
      movedViaNativeApi = true;
    } catch {
      // Fallback to copy + removeEntry
    }
  }

  if (!movedViaNativeApi) {
    const file = await fileHandle.getFile();
    const targetHandle = await destDirHandle.getFileHandle(uniqueName, {
      create: true,
    });
    const writable = await targetHandle.createWritable();
    try {
      await writable.write(file);
    } finally {
      await writable.close();
    }
    await sourceParentHandle.removeEntry(sourceFileName);
  }

  return {finalName: uniqueName, wasRenamed};
}

export async function previewFlattenSource(
  rootHandle: FileSystemDirectoryHandle,
  sourceHandle: FileSystemDirectoryHandle
): Promise<FlattenPreviewSummary> {
  if (await isSameDirectoryHandle(rootHandle, sourceHandle)) {
    throw new Error(
      'Impossible d’aplatir le dossier racine complet : sélectionnez un sous-dossier spécifique.'
    );
  }

  const existingOrganize = await resolveOrganizeSubfolders(rootHandle, false);
  if (
    existingOrganize &&
    ((await isSameDirectoryHandle(existingOrganize.organizeDir, sourceHandle)) ||
      (await isSameDirectoryHandle(existingOrganize.generalDir, sourceHandle)))
  ) {
    throw new Error(`Le dossier source fait déjà partie de « ${ORGANIZE_PATH_LABEL} ».`);
  }

  let courseFilesCount = 0;
  let subfolderCount = 0;
  let otherFilesCount = 0;

  const walk = async (dir: FileSystemDirectoryHandle) => {
    for await (const [entryName, entryHandle] of dir.entries()) {
      if (entryHandle.kind === 'file') {
        if (getCourseFileFormat(entryName)) {
          courseFilesCount++;
        } else {
          otherFilesCount++;
        }
      } else if (entryHandle.kind === 'directory') {
        if (
          (await isSameDirectoryHandle(rootHandle, entryHandle)) ||
          (existingOrganize &&
            ((await isSameDirectoryHandle(existingOrganize.organizeDir, entryHandle)) ||
              (await isSameDirectoryHandle(existingOrganize.generalDir, entryHandle))))
        ) {
          continue;
        }
        subfolderCount++;
        await walk(entryHandle as FileSystemDirectoryHandle);
      }
    }
  };

  await walk(sourceHandle);

  return {
    sourceName: sourceHandle.name,
    courseFilesCount,
    subfolderCount,
    otherFilesCount,
  };
}

export async function flattenFolderToOrganize(
  rootHandle: FileSystemDirectoryHandle,
  sourceHandle: FileSystemDirectoryHandle,
  options: {
    sourceIsInWorkspace: boolean;
    onProgress?: (info: {current: number; total: number; fileName: string}) => void;
  }
): Promise<FlattenExecutionResult> {
  const {sourceIsInWorkspace, onProgress} = options;

  const rootGranted = await verifyDirectoryPermission(rootHandle, true);
  if (!rootGranted) {
    throw new Error('Permission en écriture requise sur le dossier racine.');
  }

  const sourceGranted = await verifyDirectoryPermission(sourceHandle, true);
  if (!sourceGranted) {
    throw new Error('Permission en écriture requise sur le dossier source.');
  }

  if (await isSameDirectoryHandle(rootHandle, sourceHandle)) {
    throw new Error(
      'Impossible d’aplatir le dossier racine complet : sélectionnez un sous-dossier.'
    );
  }

  // Create "à organiser/Général" on demand when flattening
  const resolved = await resolveOrganizeSubfolders(rootHandle, true);
  if (!resolved) {
    throw new Error(`Impossible d’accéder au dossier « ${ORGANIZE_PATH_LABEL} ».`);
  }
  const {organizeDir, generalDir} = resolved;

  if (
    (await isSameDirectoryHandle(organizeDir, sourceHandle)) ||
    (await isSameDirectoryHandle(generalDir, sourceHandle))
  ) {
    throw new Error(`Le dossier source fait déjà partie de « ${ORGANIZE_PATH_LABEL} ».`);
  }

  const existingNamesLower = new Set<string>();
  for await (const [existingName] of generalDir.entries()) {
    existingNamesLower.add(existingName.toLowerCase());
  }

  interface CollectedFile {
    fileHandle: FileSystemFileHandle;
    parentHandle: FileSystemDirectoryHandle;
    fileName: string;
  }

  interface CollectedDir {
    dirHandle: FileSystemDirectoryHandle;
    parentHandle: FileSystemDirectoryHandle | null;
    dirName: string;
    depth: number;
  }

  const filesToMove: CollectedFile[] = [];
  const dirsVisited: CollectedDir[] = [
    {
      dirHandle: sourceHandle,
      parentHandle: sourceIsInWorkspace ? rootHandle : null,
      dirName: sourceHandle.name,
      depth: 0,
    },
  ];

  const collectRecursive = async (
    dir: FileSystemDirectoryHandle,
    depth: number
  ) => {
    for await (const [entryName, entryHandle] of dir.entries()) {
      if (entryHandle.kind === 'file') {
        if (getCourseFileFormat(entryName)) {
          filesToMove.push({
            fileHandle: entryHandle as FileSystemFileHandle,
            parentHandle: dir,
            fileName: entryName,
          });
        }
      } else if (entryHandle.kind === 'directory') {
        if (
          (await isSameDirectoryHandle(rootHandle, entryHandle)) ||
          (await isSameDirectoryHandle(organizeDir, entryHandle)) ||
          (await isSameDirectoryHandle(generalDir, entryHandle))
        ) {
          continue;
        }
        const subDir = entryHandle as FileSystemDirectoryHandle;
        dirsVisited.push({
          dirHandle: subDir,
          parentHandle: dir,
          dirName: entryName,
          depth: depth + 1,
        });
        await collectRecursive(subDir, depth + 1);
      }
    }
  };

  await collectRecursive(sourceHandle, 0);

  let movedCount = 0;
  let renamedDuplicatesCount = 0;

  for (let i = 0; i < filesToMove.length; i++) {
    const item = filesToMove[i];
    onProgress?.({
      current: i + 1,
      total: filesToMove.length,
      fileName: item.fileName,
    });

    const {wasRenamed} = await moveFileHandleWithDuplicateCheck(
      item.fileHandle,
      item.parentHandle,
      item.fileName,
      generalDir,
      item.fileName,
      existingNamesLower
    );

    movedCount++;
    if (wasRenamed) {
      renamedDuplicatesCount++;
    }
  }

  dirsVisited.sort((a, b) => b.depth - a.depth);

  let deletedFoldersCount = 0;
  const keptFolders: string[] = [];

  for (const dirEntry of dirsVisited) {
    if (dirEntry.depth === 0 && !sourceIsInWorkspace) {
      continue;
    }
    if (!dirEntry.parentHandle) continue;

    let hasAnyEntry = false;
    let hasDirectFile = false;
    for await (const [, childHandle] of dirEntry.dirHandle.entries()) {
      hasAnyEntry = true;
      if (childHandle.kind === 'file') {
        hasDirectFile = true;
      }
    }

    if (!hasAnyEntry) {
      try {
        await dirEntry.parentHandle.removeEntry(dirEntry.dirName);
        deletedFoldersCount++;
      } catch {
        keptFolders.push(dirEntry.dirName);
      }
    } else if (hasDirectFile) {
      keptFolders.push(dirEntry.dirName);
    }
  }

  return {
    movedCount,
    renamedDuplicatesCount,
    deletedFoldersCount,
    keptFolders,
    organizeFolderName: organizeDir.name,
    generalFolderName: generalDir.name,
  };
}

/**
 * Scans files currently inside "à organiser" (read-only: never creates empty folders)
 * for previewing in the "À organiser" tab.
 */
export async function scanOrganizePreviewItems(
  rootHandle: FileSystemDirectoryHandle,
  parseFn: (
    fileName: string,
    mimeType?: string
  ) => {
    ueCode: string;
    subject: string;
    professor: string;
    targetName: string;
    displayTitle?: string;
  }
): Promise<
  Array<{
    id: string;
    fileHandle: FileSystemFileHandle;
    sourceDirHandle: FileSystemDirectoryHandle;
    isFromOrganize: boolean;
    size: number;
    originalName: string;
    targetName: string;
    displayTitle?: string;
    ueCode: string;
    subject: string;
    professor: string;
  }>
> {
  const organizeDir = await findOrCreateDirectoryNormalized(
    rootHandle,
    ORGANIZE_ROOT_NAME,
    false
  );
  if (!organizeDir) return [];

  const collected: Array<{
    id: string;
    fileHandle: FileSystemFileHandle;
    sourceDirHandle: FileSystemDirectoryHandle;
    isFromOrganize: boolean;
    size: number;
    originalName: string;
    targetName: string;
    displayTitle?: string;
    ueCode: string;
    subject: string;
    professor: string;
  }> = [];

  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [entryName, entryHandle] of dir.entries()) {
      if (entryHandle.kind === 'file') {
        if (!getCourseFileFormat(entryName)) continue;
        const fileHandle = entryHandle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const parsed = parseFn(entryName, file.type);
        collected.push({
          id: `${prefix}${entryName}`,
          fileHandle,
          sourceDirHandle: dir,
          isFromOrganize: true,
          size: file.size,
          originalName: entryName,
          targetName: parsed.targetName,
          displayTitle: parsed.displayTitle,
          ueCode: parsed.ueCode,
          subject: parsed.subject,
          professor: parsed.professor,
        });
      } else if (entryHandle.kind === 'directory' && !isHiddenDotFolder(entryName)) {
        await walk(entryHandle as FileSystemDirectoryHandle, `${prefix}${entryName}/`);
      }
    }
  };

  await walk(organizeDir, `${organizeDir.name}/`);
  collected.sort((a, b) =>
    a.originalName.localeCompare(b.originalName, 'fr', {numeric: true})
  );
  return collected;
}

/**
 * Global recursive workspace sort:
 * 1. Scans EVERY folder and subfolder starting from workspace root
 *    (Matière/Professeur, nested subfolders, à organiser, à organiser/Général, root files),
 *    ignoring ONLY hidden folders starting with '.'.
 * 2. Recalculates Matière / Professeur strictly from the user's editable format.
 *    Leaves files untouched if already in the exact target folder with unchanged filename.
 *    Otherwise creates target folders ({ create: true }, Windows-safe names) and moves file.
 * 3. Performs bottom-up empty folder cleanup across the ENTIRE workspace with ZERO exceptions
 *    (including Général and à organiser if empty).
 */
export async function sortEntireWorkspace(
  rootHandle: FileSystemDirectoryHandle,
  parseFn: (
    fileName: string,
    mimeType?: string
  ) => {
    subject: string;
    professor: string;
    targetName: string;
  },
  overridesByFileKey?: Map<
    string,
    {subject: string; professor: string; targetName: string}
  >
): Promise<GlobalSortResult> {
  const granted = await verifyDirectoryPermission(rootHandle, true);
  if (!granted) {
    throw new Error('Permission en écriture requise sur le dossier racine.');
  }

  interface WorkspaceCourseFile {
    key: string;
    fileHandle: FileSystemFileHandle;
    sourceDirHandle: FileSystemDirectoryHandle;
    fileName: string;
    mimeType: string;
  }

  // 1. Full recursive scan of the entire workspace (ignoring only .* hidden directories)
  const allFiles: WorkspaceCourseFile[] = [];

  const scanRecursive = async (
    dir: FileSystemDirectoryHandle,
    prefix: string
  ): Promise<void> => {
    for await (const [entryName, entryHandle] of dir.entries()) {
      if (entryHandle.kind === 'file') {
        if (!getCourseFileFormat(entryName)) continue;
        const fileHandle = entryHandle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        allFiles.push({
          key: `${prefix}${entryName}`,
          fileHandle,
          sourceDirHandle: dir,
          fileName: entryName,
          mimeType: file.type,
        });
      } else if (entryHandle.kind === 'directory') {
        if (isHiddenDotFolder(entryName)) continue;
        await scanRecursive(
          entryHandle as FileSystemDirectoryHandle,
          `${prefix}${entryName}/`
        );
      }
    }
  };

  await scanRecursive(rootHandle, '');

  // 2. Smart move phase
  const destFolderNamesCache = new Map<
    string,
    {dir: FileSystemDirectoryHandle; namesLower: Set<string>}
  >();

  let movedCount = 0;
  let unchangedCount = 0;
  let renamedDuplicatesCount = 0;
  let failedCount = 0;

  for (const item of allFiles) {
    try {
      const override = overridesByFileKey?.get(item.key);
      const parsed = override ?? parseFn(item.fileName, item.mimeType);

      const safeSubject = sanitizePathSegment(parsed.subject, 'Non classé');
      const safeProf = sanitizePathSegment(
        parsed.professor,
        'Professeur non précisé'
      );
      const fallbackExt = getCourseFileFormat(item.fileName, item.mimeType) ?? 'pdf';
      const safeFile = sanitizeCourseFileName(parsed.targetName, fallbackExt);

      const cacheKey = `${safeSubject.toLowerCase()}::${safeProf.toLowerCase()}`;
      let destEntry = destFolderNamesCache.get(cacheKey);
      if (!destEntry) {
        const subjectDir = await findOrCreateDirectoryCaseInsensitive(
          rootHandle,
          safeSubject,
          'Non classé'
        );
        const profDir = await findOrCreateDirectoryCaseInsensitive(
          subjectDir,
          safeProf,
          'Professeur non précisé'
        );
        const namesLower = new Set<string>();
        for await (const [existingName] of profDir.entries()) {
          namesLower.add(existingName.toLowerCase());
        }
        destEntry = {dir: profDir, namesLower};
        destFolderNamesCache.set(cacheKey, destEntry);
      }

      const inSameFolder = await isSameDirectoryHandle(
        item.sourceDirHandle,
        destEntry.dir
      );

      if (inSameFolder) {
        if (safeFile === item.fileName) {
          unchangedCount++;
          continue;
        }

        if (safeFile.toLowerCase() === item.fileName.toLowerCase()) {
          if (typeof item.fileHandle.move === 'function') {
            await item.fileHandle.move(destEntry.dir, safeFile);
            movedCount++;
          } else {
            unchangedCount++;
          }
          continue;
        }

        destEntry.namesLower.delete(item.fileName.toLowerCase());
        const {wasRenamed} = await moveFileHandleWithDuplicateCheck(
          item.fileHandle,
          item.sourceDirHandle,
          item.fileName,
          destEntry.dir,
          safeFile,
          destEntry.namesLower
        );
        movedCount++;
        if (wasRenamed) renamedDuplicatesCount++;
        continue;
      }

      const {wasRenamed} = await moveFileHandleWithDuplicateCheck(
        item.fileHandle,
        item.sourceDirHandle,
        item.fileName,
        destEntry.dir,
        safeFile,
        destEntry.namesLower
      );
      movedCount++;
      if (wasRenamed) renamedDuplicatesCount++;
    } catch (err) {
      console.error(`Échec du déplacement pour ${item.fileName}:`, err);
      failedCount++;
    }
  }

  // 3. Complete bottom-up empty folder deletion across the ENTIRE workspace (ZERO exceptions)
  interface DirNode {
    dirHandle: FileSystemDirectoryHandle;
    parentHandle: FileSystemDirectoryHandle;
    dirName: string;
    depth: number;
  }

  const allDirs: DirNode[] = [];

  const collectAllDirs = async (
    dir: FileSystemDirectoryHandle,
    depth: number
  ): Promise<void> => {
    for await (const [entryName, entryHandle] of dir.entries()) {
      if (entryHandle.kind !== 'directory') continue;
      if (isHiddenDotFolder(entryName)) continue;

      const subDir = entryHandle as FileSystemDirectoryHandle;
      allDirs.push({
        dirHandle: subDir,
        parentHandle: dir,
        dirName: entryName,
        depth,
      });
      await collectAllDirs(subDir, depth + 1);
    }
  };

  await collectAllDirs(rootHandle, 1);

  // Deepest directories first -> guarantees "à organiser/Général" and nested subfolders
  // are deleted before "à organiser" / parent Matière folders
  allDirs.sort((a, b) => b.depth - a.depth);

  let deletedFoldersCount = 0;

  for (const node of allDirs) {
    let hasAnyEntry = false;
    for await (const _ of node.dirHandle.entries()) {
      hasAnyEntry = true;
      break;
    }
    if (!hasAnyEntry) {
      try {
        await node.parentHandle.removeEntry(node.dirName);
        deletedFoldersCount++;
      } catch {
        // ignore if locked by OS
      }
    }
  }

  return {
    movedCount,
    unchangedCount,
    renamedDuplicatesCount,
    deletedFoldersCount,
    failedCount,
    totalScannedCount: allFiles.length,
  };
}

export interface RenameFolderResult {
  oldName: string;
  newName: string;
  movedFilesCount: number;
}

async function moveDirectoryContentsRecursive(
  srcDir: FileSystemDirectoryHandle,
  destDir: FileSystemDirectoryHandle
): Promise<number> {
  const entries: Array<[string, FileSystemHandle]> = [];
  for await (const entry of srcDir.entries()) {
    entries.push(entry);
  }

  const existingNamesLower = new Set<string>();
  for await (const [existingName] of destDir.entries()) {
    existingNamesLower.add(existingName.toLowerCase());
  }

  let movedCount = 0;

  for (const [entryName, entryHandle] of entries) {
    if (entryHandle.kind === 'file') {
      await moveFileHandleWithDuplicateCheck(
        entryHandle as FileSystemFileHandle,
        srcDir,
        entryName,
        destDir,
        entryName,
        existingNamesLower
      );
      movedCount++;
    } else if (entryHandle.kind === 'directory') {
      const subSrc = entryHandle as FileSystemDirectoryHandle;
      const subDest = await destDir.getDirectoryHandle(entryName, {create: true});
      movedCount += await moveDirectoryContentsRecursive(subSrc, subDest);

      let hasRemaining = false;
      for await (const _ of subSrc.entries()) {
        hasRemaining = true;
        break;
      }
      if (!hasRemaining) {
        await srcDir.removeEntry(entryName);
      }
    }
  }

  return movedCount;
}

/**
 * Safely renames a Matière or Professeur folder on disk:
 * 1. Creates the new folder via parentHandle.getDirectoryHandle(cleanedName, { create: true }).
 * 2. Recursively moves all files and subfolders into the new folder.
 * 3. Removes the old folder only once completely emptied.
 * Handles case-only renames on case-insensitive filesystems (Windows/macOS) via a temporary folder.
 */
export async function renameWorkspaceDirectory(
  rootHandle: FileSystemDirectoryHandle,
  params: {
    kind: 'subject' | 'professor';
    subjectName: string;
    professorName?: string;
    newName: string;
  }
): Promise<RenameFolderResult> {
  const granted = await verifyDirectoryPermission(rootHandle, true);
  if (!granted) {
    throw new Error('Permission en écriture requise sur le dossier racine.');
  }

  const safeNewName = sanitizePathSegment(params.newName, '');
  if (!safeNewName) {
    throw new Error('Le nouveau nom de dossier est invalide ou vide.');
  }
  if (isHiddenDotFolder(safeNewName)) {
    throw new Error('Le nom du dossier ne peut pas commencer par un point.');
  }

  let parentHandle: FileSystemDirectoryHandle;
  let oldName: string;

  if (params.kind === 'subject') {
    parentHandle = rootHandle;
    oldName = params.subjectName;
  } else {
    let currentDir: FileSystemDirectoryHandle;
    try {
      currentDir = await rootHandle.getDirectoryHandle(params.subjectName, {
        create: false,
      });
    } catch {
      throw new Error(`Le dossier matière « ${params.subjectName} » est introuvable sur le disque.`);
    }

    const segments = (params.professorName ?? '')
      .split(' / ')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      throw new Error('Dossier professeur cible non précisé.');
    }

    for (let i = 0; i < segments.length - 1; i++) {
      try {
        currentDir = await currentDir.getDirectoryHandle(segments[i], {
          create: false,
        });
      } catch {
        throw new Error(`Sous-dossier « ${segments[i]} » introuvable sur le disque.`);
      }
    }

    parentHandle = currentDir;
    oldName = segments[segments.length - 1];
  }

  if (safeNewName === oldName) {
    return {oldName, newName: safeNewName, movedFilesCount: 0};
  }

  let oldDirHandle: FileSystemDirectoryHandle;
  try {
    oldDirHandle = await parentHandle.getDirectoryHandle(oldName, {create: false});
  } catch {
    throw new Error(`Le dossier « ${oldName} » est introuvable sur le disque.`);
  }

  const targetDirHandle = await parentHandle.getDirectoryHandle(safeNewName, {
    create: true,
  });

  const isSameDir = await isSameDirectoryHandle(oldDirHandle, targetDirHandle);
  let movedFilesCount = 0;

  if (isSameDir) {
    // Case-only rename on Windows/macOS case-insensitive filesystem: move through temp dir
    const tmpName = `.foliocours_tmp_${Date.now()}`;
    const tmpDir = await parentHandle.getDirectoryHandle(tmpName, {create: true});
    movedFilesCount = await moveDirectoryContentsRecursive(oldDirHandle, tmpDir);

    let oldHasRemaining = false;
    for await (const _ of oldDirHandle.entries()) {
      oldHasRemaining = true;
      break;
    }
    if (!oldHasRemaining) {
      await parentHandle.removeEntry(oldName);
    }

    const finalDir = await parentHandle.getDirectoryHandle(safeNewName, {
      create: true,
    });
    await moveDirectoryContentsRecursive(tmpDir, finalDir);

    let tmpHasRemaining = false;
    for await (const _ of tmpDir.entries()) {
      tmpHasRemaining = true;
      break;
    }
    if (!tmpHasRemaining) {
      await parentHandle.removeEntry(tmpName);
    }
  } else {
    movedFilesCount = await moveDirectoryContentsRecursive(
      oldDirHandle,
      targetDirHandle
    );

    let oldHasRemaining = false;
    for await (const _ of oldDirHandle.entries()) {
      oldHasRemaining = true;
      break;
    }
    if (!oldHasRemaining) {
      await parentHandle.removeEntry(oldName);
    }
  }

  return {
    oldName,
    newName: safeNewName,
    movedFilesCount,
  };
}
