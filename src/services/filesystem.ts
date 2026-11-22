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

/**
 * Scans <Root>/<Matière>/<Professeur>/*.{pdf,docx,odt} (and gracefully handles 1-level or root files)
 * without reading binary payloads into RAM.
 */
export async function scanRootDirectory(
  rootHandle: FileSystemDirectoryHandle,
  indexedMap: Map<string, StoredDocumentMeta>
): Promise<CourseDocument[]> {
  const docs: CourseDocument[] = [];

  for await (const [entryName, entryHandle] of rootHandle.entries()) {
    if (entryHandle.kind === 'file') {
      const format = getCourseFileFormat(entryName);
      if (format) {
        const fileHandle = entryHandle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const relativePath = entryName;
        const indexed = indexedMap.get(relativePath);
        docs.push({
          relativePath,
          name: entryName,
          format,
          subject: ORGANIZE_ROOT_NAME,
          professor: 'Racine',
          size: file.size,
          lastModified: file.lastModified,
          pageCount: indexed?.pageCount ?? 0,
          indexedAt: indexed?.indexedAt,
          handle: fileHandle,
        });
      }
      continue;
    }

    if (entryHandle.kind === 'directory') {
      if (isExcludedSystemFolder(entryName)) continue;
      const subjectName = entryName;
      const subjectHandle = entryHandle as FileSystemDirectoryHandle;

      for await (const [subName, subHandle] of subjectHandle.entries()) {
        if (subHandle.kind === 'file') {
          const format = getCourseFileFormat(subName);
          if (format) {
            const fileHandle = subHandle as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            const relativePath = `${subjectName}/${subName}`;
            const indexed = indexedMap.get(relativePath);
            docs.push({
              relativePath,
              name: subName,
              format,
              subject: subjectName,
              professor: ORGANIZE_GENERAL_NAME,
              size: file.size,
              lastModified: file.lastModified,
              pageCount: indexed?.pageCount ?? 0,
              indexedAt: indexed?.indexedAt,
              handle: fileHandle,
            });
          }
          continue;
        }

        if (subHandle.kind === 'directory') {
          const professorName = subName;
          const profHandle = subHandle as FileSystemDirectoryHandle;

          for await (const [fileName, fileEntry] of profHandle.entries()) {
            if (fileEntry.kind === 'file') {
              const format = getCourseFileFormat(fileName);
              if (format) {
                const fileHandle = fileEntry as FileSystemFileHandle;
                const file = await fileHandle.getFile();
                const relativePath = `${subjectName}/${professorName}/${fileName}`;
                const indexed = indexedMap.get(relativePath);
                docs.push({
                  relativePath,
                  name: fileName,
                  format,
                  subject: subjectName,
                  professor: professorName,
                  size: file.size,
                  lastModified: file.lastModified,
                  pageCount: indexed?.pageCount ?? 0,
                  indexedAt: indexed?.indexedAt,
                  handle: fileHandle,
                });
              }
            }
          }
        }
      }
    }
  }

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

export async function writeSortedPdfToDisk(
  rootHandle: FileSystemDirectoryHandle,
  subject: string,
  professor: string,
  targetName: string,
  file: File
): Promise<{relativePath: string; fileHandle: FileSystemFileHandle}> {
  const safeSubject = sanitizePathSegment(subject, 'Non classé');
  const safeProf = sanitizePathSegment(professor, 'Professeur non précisé');
  const fallbackExt = getCourseFileFormat(file.name, file.type) ?? 'pdf';
  const safeFile = sanitizeCourseFileName(targetName, fallbackExt);

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
  const fileHandle = await profDir.getFileHandle(safeFile, {create: true});

  const writable = await fileHandle.createWritable();
  try {
    await writable.write(file);
  } finally {
    await writable.close();
  }

  return {
    relativePath: `${subjectDir.name}/${profDir.name}/${safeFile}`,
    fileHandle,
  };
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

export function isGeneralFolderName(name: string): boolean {
  return normalizeFolderForMatch(name) === 'general';
}

export function isExcludedSystemFolder(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.startsWith('.') || trimmed.toLowerCase() === 'sauvegarde_cours';
}

/**
 * Finds an existing directory ignoring case and accents (e.g. "à organiser", "À organiser", "a organiser",
 * or "Général", "général", "General"), or creates it if missing.
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
 * Checks existing directories case-insensitively first, then creates systematically via getDirectoryHandle(..., { create: true })
 * after stripping Windows-forbidden characters and extra whitespace.
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
 * Resolves "à organiser" and its subfolder "Général" (case- and accent-insensitive),
 * creating either if missing.
 */
export async function resolveOrganizeSubfolders(
  rootHandle: FileSystemDirectoryHandle,
  createIfMissing = true
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

export async function resolveClassifyDirectory(
  rootHandle: FileSystemDirectoryHandle,
  createIfMissing = true
): Promise<FileSystemDirectoryHandle | null> {
  const resolved = await resolveOrganizeSubfolders(rootHandle, createIfMissing);
  return resolved ? resolved.generalDir : null;
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

export interface SortClassifyResult {
  newlyClassifiedCount: number;
  relocatedSortedCount: number;
  movedCount: number;
  unchangedCount: number;
  renamedDuplicatesCount: number;
  deletedFoldersCount: number;
  failedCount: number;
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

  // Snapshot existing file names in "à organiser/Général" to prevent any overwrite
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

  // 1. Move all supported course files into "à organiser/Général"
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

  // 2. Delete empty folders from deepest subfolder up to root (WITHOUT recursive: true)
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
 * Scans all .pdf, .docx, and .odt files inside "à organiser/Général" (including nested subfolders)
 * and "à organiser" root, plus optionally (when includeAlreadySorted = true) all existing
 * Matière / Professeur folders at the workspace root (ignoring .* and Sauvegarde_Cours).
 */
export async function scanClassifyFolderItems(
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
    courseType?: string;
    courseNumber?: string;
    matchedRulePattern?: string;
  },
  options?: {includeAlreadySorted?: boolean}
): Promise<Array<{
  id: string;
  fileHandle: FileSystemFileHandle;
  sourceDirHandle: FileSystemDirectoryHandle;
  isFromOrganize: boolean;
  size: number;
  originalName: string;
  targetName: string;
  displayTitle?: string;
  courseType?: string;
  courseNumber?: string;
  ueCode: string;
  subject: string;
  professor: string;
  matchedRulePattern?: string;
}>> {
  const includeAlreadySorted = options?.includeAlreadySorted ?? false;
  const resolved = await resolveOrganizeSubfolders(rootHandle, true);
  if (!resolved) return [];
  const {organizeDir, generalDir} = resolved;

  const collected: Array<{
    id: string;
    fileHandle: FileSystemFileHandle;
    sourceDirHandle: FileSystemDirectoryHandle;
    isFromOrganize: boolean;
    size: number;
    originalName: string;
    targetName: string;
    displayTitle?: string;
    courseType?: string;
    courseNumber?: string;
    ueCode: string;
    subject: string;
    professor: string;
    matchedRulePattern?: string;
  }> = [];

  const pushFile = async (
    dir: FileSystemDirectoryHandle,
    entryName: string,
    fileHandle: FileSystemFileHandle,
    prefix: string,
    isFromOrganize: boolean,
    currentFolder?: {subject?: string; professor?: string}
  ) => {
    const format = getCourseFileFormat(entryName);
    if (!format) return;
    const file = await fileHandle.getFile();
    const parsed = parseFn(entryName, file.type);

    let resolvedSubject = parsed.subject;
    let resolvedProfessor = parsed.professor;
    if (!isFromOrganize && resolvedSubject === 'Non classé' && !parsed.matchedRulePattern && currentFolder?.subject) {
      resolvedSubject = currentFolder.subject;
      if (resolvedProfessor === 'Professeur non précisé' && currentFolder.professor) {
        resolvedProfessor = currentFolder.professor;
      }
    }

    collected.push({
      id: `${prefix}${entryName}`,
      fileHandle,
      sourceDirHandle: dir,
      isFromOrganize,
      size: file.size,
      originalName: entryName,
      targetName: parsed.targetName,
      displayTitle: parsed.displayTitle,
      courseType: parsed.courseType,
      courseNumber: parsed.courseNumber,
      ueCode: parsed.ueCode,
      subject: resolvedSubject,
      professor: resolvedProfessor,
      matchedRulePattern: parsed.matchedRulePattern,
    });
  };

  // 1. Direct files placed at root of "à organiser"
  for await (const [entryName, entryHandle] of organizeDir.entries()) {
    if (entryHandle.kind === 'file') {
      await pushFile(
        organizeDir,
        entryName,
        entryHandle as FileSystemFileHandle,
        `${organizeDir.name}/`,
        true
      );
    }
  }

  // 2. All files inside "à organiser/Général" (recursively)
  const walkOrganizeSubdir = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [entryName, entryHandle] of dir.entries()) {
      if (entryHandle.kind === 'file') {
        await pushFile(dir, entryName, entryHandle as FileSystemFileHandle, prefix, true);
      } else if (entryHandle.kind === 'directory') {
        await walkOrganizeSubdir(
          entryHandle as FileSystemDirectoryHandle,
          `${prefix}${entryName}/`
        );
      }
    }
  };

  await walkOrganizeSubdir(generalDir, `${organizeDir.name}/${generalDir.name}/`);

  // 3. Optionally scan all existing Matière / Professeur folders at workspace root
  if (includeAlreadySorted) {
    const walkSortedTree = async (
      dir: FileSystemDirectoryHandle,
      prefix: string,
      subjectName: string,
      professorName?: string
    ) => {
      for await (const [entryName, entryHandle] of dir.entries()) {
        if (entryHandle.kind === 'file') {
          await pushFile(dir, entryName, entryHandle as FileSystemFileHandle, prefix, false, {
            subject: subjectName,
            professor: professorName,
          });
        } else if (entryHandle.kind === 'directory') {
          if (isExcludedSystemFolder(entryName)) continue;
          await walkSortedTree(
            entryHandle as FileSystemDirectoryHandle,
            `${prefix}${entryName}/`,
            subjectName,
            professorName ?? entryName
          );
        }
      }
    };

    for await (const [entryName, entryHandle] of rootHandle.entries()) {
      if (entryHandle.kind !== 'directory') continue;
      if (isExcludedSystemFolder(entryName)) continue;
      if (await isSameDirectoryHandle(organizeDir, entryHandle)) continue;
      if (isOrganizeRootFolderName(entryName)) continue;

      await walkSortedTree(
        entryHandle as FileSystemDirectoryHandle,
        `${entryName}/`,
        entryName
      );
    }
  }

  collected.sort((a, b) =>
    a.originalName.localeCompare(b.originalName, 'fr', {numeric: true})
  );
  return collected;
}

/**
 * Smart global sort:
 * - Leaves already-sorted files untouched if destination folder & filename didn't change.
 * - Moves changed or newly organized files to <Root>/<Matière>/<Professeur>/<targetName>
 *   (creating folders systematically with { create: true } and Windows-safe names).
 * - Cleans up empty Professeur / Matière folders bottom-up (without recursive: true),
 *   always preserving "à organiser" and "à organiser/Général".
 */
export async function sortClassifyFolderItems(
  rootHandle: FileSystemDirectoryHandle,
  items: Array<{
    id: string;
    fileHandle?: FileSystemFileHandle;
    sourceDirHandle?: FileSystemDirectoryHandle;
    isFromOrganize?: boolean;
    originalName: string;
    targetName: string;
    subject: string;
    professor: string;
    status: string;
  }>,
  callbacks?: {
    onItemStatus?: (id: string, status: 'writing' | 'done' | 'error', error?: string) => void;
    cleanupEmptySortedFolders?: boolean;
  }
): Promise<SortClassifyResult> {
  const granted = await verifyDirectoryPermission(rootHandle, true);
  if (!granted) {
    throw new Error('Permission en écriture requise sur le dossier racine.');
  }

  const destFolderNamesCache = new Map<
    string,
    {dir: FileSystemDirectoryHandle; namesLower: Set<string>}
  >();

  let newlyClassifiedCount = 0;
  let relocatedSortedCount = 0;
  let unchangedCount = 0;
  let renamedDuplicatesCount = 0;
  let failedCount = 0;

  for (const item of items) {
    if (item.status === 'done' || !item.fileHandle || !item.sourceDirHandle) continue;

    callbacks?.onItemStatus?.(item.id, 'writing');
    try {
      const safeSubject = sanitizePathSegment(item.subject, 'Non classé');
      const safeProf = sanitizePathSegment(item.professor, 'Professeur non précisé');
      const fallbackExt = getCourseFileFormat(item.originalName) ?? 'pdf';
      const safeFile = sanitizeCourseFileName(item.targetName, fallbackExt);

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
        if (safeFile === item.originalName) {
          unchangedCount++;
          callbacks?.onItemStatus?.(item.id, 'done');
          continue;
        }

        // Physical rename inside the same folder
        if (safeFile.toLowerCase() === item.originalName.toLowerCase()) {
          if (typeof item.fileHandle.move === 'function') {
            await item.fileHandle.move(destEntry.dir, safeFile);
            if (item.isFromOrganize !== false) newlyClassifiedCount++;
            else relocatedSortedCount++;
          } else {
            unchangedCount++;
          }
          callbacks?.onItemStatus?.(item.id, 'done');
          continue;
        }

        destEntry.namesLower.delete(item.originalName.toLowerCase());
        const {wasRenamed} = await moveFileHandleWithDuplicateCheck(
          item.fileHandle,
          item.sourceDirHandle,
          item.originalName,
          destEntry.dir,
          safeFile,
          destEntry.namesLower
        );
        if (item.isFromOrganize !== false) newlyClassifiedCount++;
        else relocatedSortedCount++;
        if (wasRenamed) renamedDuplicatesCount++;
        callbacks?.onItemStatus?.(item.id, 'done');
        continue;
      }

      const {wasRenamed} = await moveFileHandleWithDuplicateCheck(
        item.fileHandle,
        item.sourceDirHandle,
        item.originalName,
        destEntry.dir,
        safeFile,
        destEntry.namesLower
      );

      if (item.isFromOrganize !== false) newlyClassifiedCount++;
      else relocatedSortedCount++;
      if (wasRenamed) renamedDuplicatesCount++;
      callbacks?.onItemStatus?.(item.id, 'done');
    } catch (err) {
      failedCount++;
      callbacks?.onItemStatus?.(
        item.id,
        'error',
        err instanceof Error ? err.message : 'Erreur lors du déplacement du fichier.'
      );
    }
  }

  let deletedFoldersCount = 0;

  // 1. Clean up any nested subfolders strictly deeper inside "à organiser/Général"
  //    (always preserve "à organiser" and "à organiser/Général" themselves)
  const resolved = await resolveOrganizeSubfolders(rootHandle, false);
  if (resolved) {
    const cleanEmptyNested = async (
      dir: FileSystemDirectoryHandle,
      parent: FileSystemDirectoryHandle | null,
      dirName: string,
      isProtectedRoot: boolean
    ) => {
      for await (const [childName, childHandle] of dir.entries()) {
        if (childHandle.kind === 'directory') {
          await cleanEmptyNested(
            childHandle as FileSystemDirectoryHandle,
            dir,
            childName,
            false
          );
        }
      }
      if (!isProtectedRoot && parent) {
        let empty = true;
        for await (const _ of dir.entries()) {
          empty = false;
          break;
        }
        if (empty) {
          try {
            await parent.removeEntry(dirName);
            deletedFoldersCount++;
          } catch {
            // ignore
          }
        }
      }
    };
    await cleanEmptyNested(
      resolved.generalDir,
      resolved.organizeDir,
      resolved.generalDir.name,
      true
    );
  }

  // 2. Bottom-up cleanup of empty Professeur & Matière folders (WITHOUT recursive: true)
  const shouldCleanSorted =
    callbacks?.cleanupEmptySortedFolders ??
    items.some((i) => i.isFromOrganize === false);

  if (shouldCleanSorted) {
    interface DirNode {
      dirHandle: FileSystemDirectoryHandle;
      parentHandle: FileSystemDirectoryHandle;
      dirName: string;
      depth: number;
    }

    const dirsToCheck: DirNode[] = [];

    const collectDirs = async (
      dir: FileSystemDirectoryHandle,
      parent: FileSystemDirectoryHandle,
      dirName: string,
      depth: number
    ) => {
      dirsToCheck.push({dirHandle: dir, parentHandle: parent, dirName, depth});
      for await (const [childName, childHandle] of dir.entries()) {
        if (childHandle.kind === 'directory' && !isExcludedSystemFolder(childName)) {
          await collectDirs(
            childHandle as FileSystemDirectoryHandle,
            dir,
            childName,
            depth + 1
          );
        }
      }
    };

    for await (const [entryName, entryHandle] of rootHandle.entries()) {
      if (entryHandle.kind !== 'directory') continue;
      if (isExcludedSystemFolder(entryName)) continue;
      if (resolved && (await isSameDirectoryHandle(resolved.organizeDir, entryHandle))) {
        continue;
      }
      if (isOrganizeRootFolderName(entryName)) continue;

      await collectDirs(
        entryHandle as FileSystemDirectoryHandle,
        rootHandle,
        entryName,
        1
      );
    }

    dirsToCheck.sort((a, b) => b.depth - a.depth);

    for (const node of dirsToCheck) {
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
          // ignore if locked or non-empty
        }
      }
    }
  }

  return {
    newlyClassifiedCount,
    relocatedSortedCount,
    movedCount: newlyClassifiedCount + relocatedSortedCount,
    unchangedCount,
    renamedDuplicatesCount,
    deletedFoldersCount,
    failedCount,
  };
}
