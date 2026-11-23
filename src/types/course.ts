export type AppMode = 'local' | 'cloud';
export type CourseFileFormat = 'pdf' | 'docx' | 'odt';

export interface CourseDocument {
  /** Relative path from root directory, e.g. "Génétique/Pr. Page/UE4 - Pr. Page - Ronéo 3.pdf" */
  relativePath: string;
  name: string;
  format?: CourseFileFormat;
  subject: string;
  professor: string;
  size: number;
  lastModified: number;
  pageCount: number;
  indexedAt?: number;
  source?: AppMode;
  handle?: FileSystemFileHandle;
  driveFileId?: string;
  driveParentFolderId?: string;
  driveModifiedTime?: string;
}

export interface StoredDocumentMeta {
  relativePath: string;
  name: string;
  subject: string;
  professor: string;
  size: number;
  lastModified: number;
  pageCount: number;
  indexedAt: number;
}

export interface StoredPageText {
  id: string; // `${docPath}::${pageNumber}`
  docPath: string;
  pageNumber: number;
  text: string;
}

export interface CloudSearchIndexDocument {
  relativePath: string;
  name: string;
  subject: string;
  professor: string;
  pageCount: number;
  pages: Array<{p: number; t: string}>;
}

export interface CloudSearchIndexPayload {
  version: 1;
  generatedAt: number;
  driveFileId?: string;
  driveModifiedTime?: string;
  titleFormat?: TitleFormatSettings;
  documents: CloudSearchIndexDocument[];
}

export interface CloudConfigPayload {
  version: 1;
  updatedAt: number;
  titleFormat: TitleFormatSettings;
}

export interface ProfessorGroup {
  name: string;
  documents: CourseDocument[];
}

export interface SubjectGroup {
  name: string;
  professors: ProfessorGroup[];
  totalCount: number;
}

export type RuleMatchTarget = 'any' | 'ue' | 'subject' | 'professor' | 'filename';

export interface SortRule {
  id: string;
  pattern: string;
  matchTarget: RuleMatchTarget;
  subject: string;
  professor: string;
  enabled: boolean;
}

export interface TitleFormatSettings {
  inputTemplate: string;
  outputTemplate: string;
  renameOnDisk: boolean;
  replaceUnderscoresWithSpaces?: boolean;
  hideExtension?: boolean;
}

export interface ImportQueueItem {
  id: string;
  file?: File;
  fileHandle?: FileSystemFileHandle;
  sourceDirHandle?: FileSystemDirectoryHandle;
  isFromOrganize?: boolean;
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
  status: 'pending' | 'writing' | 'done' | 'error';
  error?: string;
}

export interface SearchResult {
  docPath: string;
  fileName: string;
  subject: string;
  professor: string;
  pageNumber: number;
  snippet: string;
  matchType: 'filename' | 'content';
  score?: number;
  matchLevel?: 1 | 2 | 3 | 4;
}

export interface DriveSyncRecord {
  driveFileId: string;
  size: number;
  lastModified: number;
  syncedAt: number;
}

export interface DriveBackupPlanItem {
  doc: CourseDocument;
  action: 'new' | 'modified' | 'unchanged';
  existingDriveFileId?: string;
}

export interface DriveDeletePlanItem {
  driveFileId: string;
  name: string;
  relativePath: string;
  size: number;
  parentId: string;
}

export interface DriveBackupPlan {
  rootFolderId: string | null;
  toUpload: DriveBackupPlanItem[];
  toDelete: DriveDeletePlanItem[];
  unchangedCount: number;
  totalBytes: number;
}

export interface IndexingProgress {
  active: boolean;
  current: number;
  total: number;
  currentFileName: string;
}

export type WorkspaceTab = 'library' | 'import' | 'search';
export type MobileTab = 'courses' | 'search' | 'sync';
