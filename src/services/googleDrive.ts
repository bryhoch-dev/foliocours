import type {
  CloudSearchIndexPayload,
  CourseDocument,
  DriveBackupPlan,
  DriveBackupPlanItem,
  DriveDeletePlanItem,
  DriveSyncRecord,
} from '../types/course';
import {exportSearchIndexForCloud} from './db';
import {getCourseFileFormat} from './fileFormats';

const CLIENT_ID_STORAGE_KEY = 'foliocours_drive_client_id';
const SYNC_CACHE_STORAGE_KEY = 'foliocours_drive_sync_cache';
const SESSION_STORAGE_KEY = 'foliocours_drive_session';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_BACKUP_FOLDER_NAME = 'Sauvegarde_Cours';
const SEARCH_INDEX_FILENAME = 'search_index.json';

export interface StoredDriveSession {
  accessToken: string;
  expiresAt: number;
  userEmail: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: {prompt?: string; hint?: string}) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: {type?: string; message?: string}) => void;
          }) => GoogleTokenClient;
          revoke?: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

export function getSavedDriveClientId(): string {
  return localStorage.getItem(CLIENT_ID_STORAGE_KEY) || '';
}

export function saveDriveClientId(clientId: string): void {
  localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId.trim());
}

export function getDriveSyncCache(): Record<string, DriveSyncRecord> {
  try {
    const raw = localStorage.getItem(SYNC_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveDriveSyncCache(cache: Record<string, DriveSyncRecord>): void {
  localStorage.setItem(SYNC_CACHE_STORAGE_KEY, JSON.stringify(cache));
}

export function clearDriveSyncCache(): void {
  localStorage.removeItem(SYNC_CACHE_STORAGE_KEY);
}

export function getStoredDriveSession(): StoredDriveSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDriveSession>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : '',
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0,
      userEmail: typeof parsed.userEmail === 'string' ? parsed.userEmail : '',
    };
  } catch {
    return null;
  }
}

function saveStoredDriveSession(session: StoredDriveSession): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function invalidateStoredAccessTokenKeepEmail(): void {
  const existing = getStoredDriveSession();
  if (!existing) return;
  if (existing.userEmail) {
    saveStoredDriveSession({
      accessToken: '',
      expiresAt: 0,
      userEmail: existing.userEmail,
    });
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export function getStoredDriveEmail(): string {
  return getStoredDriveSession()?.userEmail || '';
}

export function getMemoryAccessToken(): string | null {
  const session = getStoredDriveSession();
  if (!session || !session.accessToken) return null;
  if (Date.now() >= session.expiresAt - 30_000) {
    return null;
  }
  return session.accessToken;
}

export function disconnectGoogleDrive(): void {
  const session = getStoredDriveSession();
  localStorage.removeItem(SESSION_STORAGE_KEY);
  if (session?.accessToken && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(session.accessToken);
    } catch {
      // Ignore revoke error when offline
    }
  }
}

let gisLoadPromise: Promise<void> | null = null;

export function loadGoogleIdentityServices(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    if (!navigator.onLine) {
      gisLoadPromise = null;
      reject(new Error('Connexion Internet requise pour charger Google Identity Services.'));
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), {once: true});
      existing.addEventListener(
        'error',
        () => {
          gisLoadPromise = null;
          reject(new Error('Impossible de charger le script Google Identity Services.'));
        },
        {once: true}
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoadPromise = null;
      reject(new Error('Impossible de charger Google Identity Services.'));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

async function fetchDriveUserEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
      {
        headers: {Authorization: `Bearer ${accessToken}`},
      }
    );
    if (!res.ok) return '';
    const data = (await res.json()) as {user?: {emailAddress?: string}};
    return data.user?.emailAddress || '';
  } catch {
    return '';
  }
}

function requestGisToken(
  clientId: string,
  options: {prompt: string; hint?: string; timeoutMs?: number}
): Promise<{accessToken: string; expiresInSec: number}> {
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    return Promise.reject(
      new Error('Google Identity Services indisponible dans ce contexte.')
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Délai de renouvellement silencieux dépassé.'));
        }
      }, options.timeoutMs);
    }

    const finishResolve = (val: {accessToken: string; expiresInSec: number}) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(val);
    };

    const finishReject = (err: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    };

    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      ...(options.hint ? {hint: options.hint} : {}),
      callback: (response: GoogleTokenResponse) => {
        if (response.error || !response.access_token) {
          finishReject(
            new Error(
              response.error_description ||
                response.error ||
                'Autorisation Google Drive refusée ou annulée.'
            )
          );
          return;
        }
        finishResolve({
          accessToken: response.access_token,
          expiresInSec: response.expires_in ?? 3600,
        });
      },
      error_callback: (err) => {
        finishReject(
          new Error(err.message || 'Erreur lors de l’authentification Google.')
        );
      },
    });

    tokenClient.requestAccessToken({
      prompt: options.prompt,
      ...(options.hint ? {hint: options.hint} : {}),
    });
  });
}

/**
 * Obtains a valid Google Drive OAuth access token:
 * 1) Reuses persisted localStorage token if still valid.
 * 2) Attempts silent background renewal (`prompt: ''`, `hint: userEmail`) if previously signed in.
 * 3) Opens the interactive popup only if silent renewal fails or no session exists yet.
 */
export async function authenticateGoogleDrive(
  clientId: string,
  optionsOrForceConsent: boolean | {forceConsent?: boolean; silentOnly?: boolean} = false
): Promise<string> {
  const forceConsent =
    typeof optionsOrForceConsent === 'boolean'
      ? optionsOrForceConsent
      : !!optionsOrForceConsent.forceConsent;
  const silentOnly =
    typeof optionsOrForceConsent === 'object' && !!optionsOrForceConsent.silentOnly;

  if (!forceConsent) {
    const validToken = getMemoryAccessToken();
    if (validToken) {
      return validToken;
    }
  }

  const trimmed = clientId.trim();
  if (!trimmed) {
    throw new Error(
      'Veuillez renseigner votre Client ID Google Cloud dans les paramètres avant de vous connecter.'
    );
  }

  if (!window.google?.accounts?.oauth2) {
    await loadGoogleIdentityServices();
  }

  const knownEmail = getStoredDriveEmail();
  let tokenResult: {accessToken: string; expiresInSec: number} | null = null;

  // Step 2: Silent background renewal (`prompt: ''`)
  if (!forceConsent) {
    try {
      tokenResult = await requestGisToken(trimmed, {
        prompt: '',
        ...(knownEmail ? {hint: knownEmail} : {}),
        timeoutMs: 8000,
      });
    } catch {
      // Silent renewal failed
      tokenResult = null;
    }
  }

  if (!tokenResult && silentOnly) {
    throw new Error('Renouvellement silencieux Google Drive requis.');
  }

  // Step 3: Interactive popup fallback (only for explicit user action)
  if (!tokenResult) {
    tokenResult = await requestGisToken(trimmed, {
      prompt: forceConsent ? 'consent' : knownEmail ? 'select_account' : 'consent',
      hint: knownEmail || undefined,
    });
  }

  const expiresAt = Date.now() + tokenResult.expiresInSec * 1000;
  const resolvedEmail =
    (await fetchDriveUserEmail(tokenResult.accessToken)) || knownEmail;

  saveStoredDriveSession({
    accessToken: tokenResult.accessToken,
    expiresAt,
    userEmail: resolvedEmail,
  });

  return tokenResult.accessToken;
}

export interface RemoteDriveFolderNode {
  id: string;
  name: string;
  relativePath: string;
  parentId: string;
  depth: number;
  childFolderIds: Set<string>;
  childFileIds: Set<string>;
  otherFileCount: number;
}

export interface RemoteDriveFileNode {
  id: string;
  name: string;
  relativePath: string;
  parentId: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  modifiedTimeMs: number;
}

export interface RemoteDriveInventory {
  rootFolderId: string;
  folderById: Map<string, RemoteDriveFolderNode>;
  folderIdByPath: Map<string, string>;
  filesByPath: Map<string, RemoteDriveFileNode>;
  duplicateFiles: RemoteDriveFileNode[];
  searchIndexFileId: string | null;
  searchIndexModifiedTime: string | null;
}

export interface DriveMirrorAnalysisResult {
  plan: DriveBackupPlan;
  inventory: RemoteDriveInventory | null;
}

export interface DriveMirrorProgress {
  phase: 'scan' | 'upload' | 'delete' | 'cleanup' | 'index';
  current: number;
  total: number;
  fileName: string;
}

export interface DriveMirrorSyncResult {
  uploaded: number;
  deleted: number;
  deletedFolders: number;
  indexUpdated: boolean;
}

/**
 * Legacy cache-only plan builder kept for compatibility if needed synchronously.
 */
export function buildDriveBackupPlan(documents: CourseDocument[]): DriveBackupPlan {
  const cache = getDriveSyncCache();
  const toUpload: DriveBackupPlanItem[] = [];
  let unchangedCount = 0;
  let totalBytes = 0;

  for (const doc of documents) {
    if (!doc.handle) continue;
    const prev = cache[doc.relativePath];
    if (!prev) {
      toUpload.push({doc, action: 'new'});
      totalBytes += doc.size;
    } else if (prev.size !== doc.size || prev.lastModified !== doc.lastModified) {
      toUpload.push({
        doc,
        action: 'modified',
        existingDriveFileId: prev.driveFileId,
      });
      totalBytes += doc.size;
    } else {
      unchangedCount++;
    }
  }

  return {rootFolderId: null, toUpload, toDelete: [], unchangedCount, totalBytes};
}

function escapeDriveQueryValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  modifiedTime?: string;
}

async function listDriveFilesPaginated(
  accessToken: string,
  query: string,
  fields = 'nextPageToken, files(id, name, mimeType, parents, size, modifiedTime)'
): Promise<DriveFileEntry[]> {
  const collected: DriveFileEntry[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', query);
    url.searchParams.set('fields', fields);
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('spaces', 'drive');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const res = await fetch(url.toString(), {
      headers: {Authorization: `Bearer ${accessToken}`},
    });

    if (res.status === 401) {
      invalidateStoredAccessTokenKeepEmail();
      throw new Error('Session Google expirée. Veuillez relancer l’action.');
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur Google Drive (${res.status}) : ${errText}`);
    }

    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: DriveFileEntry[];
    };
    if (data.files) {
      collected.push(...data.files);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return collected;
}

async function listChildrenByParentIds(
  accessToken: string,
  parentIds: string[],
  extraFilter = ''
): Promise<DriveFileEntry[]> {
  if (parentIds.length === 0) return [];
  const results: DriveFileEntry[] = [];
  const chunkSize = 20;

  for (let i = 0; i < parentIds.length; i += chunkSize) {
    const chunk = parentIds.slice(i, i + chunkSize);
    const parentExpr = chunk
      .map((id) => `'${escapeDriveQueryValue(id)}' in parents`)
      .join(' or ');
    const query = `(${parentExpr}) and trashed = false${extraFilter ? ` and ${extraFilter}` : ''}`;
    const entries = await listDriveFilesPaginated(accessToken, query);
    results.push(...entries);
  }

  return results;
}

async function findDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<string | null> {
  const escapedName = escapeDriveQueryValue(folderName);
  const parentClause = parentId
    ? ` and '${escapeDriveQueryValue(parentId)}' in parents`
    : ` and 'root' in parents`;
  const q = `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`;
  let files = await listDriveFilesPaginated(
    accessToken,
    q,
    'nextPageToken, files(id, name)'
  );
  if (files.length === 0 && !parentId) {
    const fallbackQ = `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    files = await listDriveFilesPaginated(
      accessToken,
      fallbackQ,
      'nextPageToken, files(id, name)'
    );
  }
  return files[0]?.id ?? null;
}

async function createDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<string> {
  const metadata: Record<string, unknown> = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (createRes.status === 401) {
    invalidateStoredAccessTokenKeepEmail();
    throw new Error('Session Google expirée. Veuillez relancer l’action.');
  }

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Impossible de créer le dossier "${folderName}" sur Drive : ${errText}`);
  }

  const created = (await createRes.json()) as {id: string};
  return created.id;
}

async function findOrCreateDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<string> {
  const existingId = await findDriveFolder(accessToken, folderName, parentId);
  if (existingId) return existingId;
  return createDriveFolder(accessToken, folderName, parentId);
}

async function findExistingDriveFileInFolder(
  accessToken: string,
  fileName: string,
  parentId: string
): Promise<{id: string; size?: string; modifiedTime?: string} | null> {
  const q = `name = '${escapeDriveQueryValue(fileName)}' and '${escapeDriveQueryValue(
    parentId
  )}' in parents and trashed = false`;
  const files = await listDriveFilesPaginated(
    accessToken,
    q,
    'nextPageToken, files(id, name, size, modifiedTime)'
  );
  return files[0] ?? null;
}

async function uploadOrUpdateDriveBlob(
  accessToken: string,
  fileName: string,
  blob: Blob,
  parentId: string,
  existingFileId?: string
): Promise<{id: string; modifiedTime?: string; size?: number}> {
  const metadata = existingFileId ? {name: fileName} : {name: fileName, parents: [parentId]};

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], {type: 'application/json'}));
  form.append('file', blob);

  const endpoint = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        existingFileId
      )}?uploadType=multipart&fields=id,modifiedTime,size`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime,size';

  const res = await fetch(endpoint, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {Authorization: `Bearer ${accessToken}`},
    body: form,
  });

  if (res.status === 401) {
    invalidateStoredAccessTokenKeepEmail();
    throw new Error('Session Google expirée. Veuillez relancer l’opération.');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Échec téléversement "${fileName}" : ${errText}`);
  }

  const data = (await res.json()) as {id: string; modifiedTime?: string; size?: string};
  return {
    id: data.id,
    modifiedTime: data.modifiedTime,
    size: data.size ? Number(data.size) : undefined,
  };
}

export async function deleteDriveFileOrFolder(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: {Authorization: `Bearer ${accessToken}`},
    }
  );

  if (res.status === 401) {
    invalidateStoredAccessTokenKeepEmail();
    throw new Error('Session Google expirée. Veuillez relancer l’opération.');
  }
  if (res.status === 404) {
    return;
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Impossible de supprimer l’élément sur Drive (${res.status}) : ${errText}`);
  }
}

/**
 * Recursively inventories all files and folders inside `Sauvegarde_Cours` on Google Drive.
 */
async function scanDriveBackupTree(
  accessToken: string,
  rootFolderId: string
): Promise<RemoteDriveInventory> {
  const folderById = new Map<string, RemoteDriveFolderNode>();
  const folderIdByPath = new Map<string, string>();
  const filesByPath = new Map<string, RemoteDriveFileNode>();
  const duplicateFiles: RemoteDriveFileNode[] = [];
  let searchIndexFileId: string | null = null;
  let searchIndexModifiedTime: string | null = null;

  const rootNode: RemoteDriveFolderNode = {
    id: rootFolderId,
    name: ROOT_BACKUP_FOLDER_NAME,
    relativePath: '',
    parentId: '',
    depth: 0,
    childFolderIds: new Set(),
    childFileIds: new Set(),
    otherFileCount: 0,
  };
  folderById.set(rootFolderId, rootNode);
  folderIdByPath.set('', rootFolderId);

  let currentQueue: RemoteDriveFolderNode[] = [rootNode];
  const visitedFolderIds = new Set<string>([rootFolderId]);

  while (currentQueue.length > 0) {
    const batchMap = new Map<string, RemoteDriveFolderNode>();
    for (const f of currentQueue) {
      batchMap.set(f.id, f);
    }

    const entries = await listChildrenByParentIds(
      accessToken,
      currentQueue.map((f) => f.id)
    );
    const nextQueue: RemoteDriveFolderNode[] = [];

    for (const entry of entries) {
      const parentId =
        entry.parents?.find((p) => batchMap.has(p)) ?? entry.parents?.[0];
      const parentNode = parentId ? batchMap.get(parentId) : undefined;
      if (!parentNode) continue;

      const relPath = parentNode.relativePath
        ? `${parentNode.relativePath}/${entry.name}`
        : entry.name;

      if (entry.mimeType === 'application/vnd.google-apps.folder') {
        if (visitedFolderIds.has(entry.id)) continue;
        visitedFolderIds.add(entry.id);

        const folderNode: RemoteDriveFolderNode = {
          id: entry.id,
          name: entry.name,
          relativePath: relPath,
          parentId: parentNode.id,
          depth: parentNode.depth + 1,
          childFolderIds: new Set(),
          childFileIds: new Set(),
          otherFileCount: 0,
        };
        folderById.set(entry.id, folderNode);
        parentNode.childFolderIds.add(entry.id);
        if (!folderIdByPath.has(relPath)) {
          folderIdByPath.set(relPath, entry.id);
        }
        nextQueue.push(folderNode);
      } else {
        if (parentNode.depth === 0 && entry.name === SEARCH_INDEX_FILENAME) {
          searchIndexFileId = entry.id;
          searchIndexModifiedTime = entry.modifiedTime ?? null;
          parentNode.otherFileCount++;
          continue;
        }

        const isCourseFile = getCourseFileFormat(entry.name, entry.mimeType) !== null;
        if (!isCourseFile) {
          parentNode.otherFileCount++;
          continue;
        }

        const modifiedTime = entry.modifiedTime || '';
        const remoteNode: RemoteDriveFileNode = {
          id: entry.id,
          name: entry.name,
          relativePath: relPath,
          parentId: parentNode.id,
          mimeType: entry.mimeType,
          size: Number(entry.size || 0),
          modifiedTime,
          modifiedTimeMs: modifiedTime ? Date.parse(modifiedTime) : 0,
        };

        parentNode.childFileIds.add(entry.id);

        const existing = filesByPath.get(relPath);
        if (existing) {
          // Keep the newest copy for potential PATCH, mark older duplicate for deletion
          if (remoteNode.modifiedTimeMs > existing.modifiedTimeMs) {
            duplicateFiles.push(existing);
            filesByPath.set(relPath, remoteNode);
          } else {
            duplicateFiles.push(remoteNode);
          }
        } else {
          filesByPath.set(relPath, remoteNode);
        }
      }
    }

    currentQueue = nextQueue;
  }

  return {
    rootFolderId,
    folderById,
    folderIdByPath,
    filesByPath,
    duplicateFiles,
    searchIndexFileId,
    searchIndexModifiedTime,
  };
}

/**
 * Builds a complete mirror synchronization plan between the local workspace
 * and `Sauvegarde_Cours` on Google Drive.
 */
export async function analyzeDriveMirrorPlan(
  accessToken: string,
  documents: CourseDocument[]
): Promise<DriveMirrorAnalysisResult> {
  const localByPath = new Map<string, CourseDocument>();
  for (const doc of documents) {
    if (!doc.handle) continue;
    localByPath.set(doc.relativePath, doc);
  }

  const rootFolderId = await findDriveFolder(accessToken, ROOT_BACKUP_FOLDER_NAME);
  if (!rootFolderId) {
    const toUpload: DriveBackupPlanItem[] = [];
    let totalBytes = 0;
    for (const doc of localByPath.values()) {
      toUpload.push({doc, action: 'new'});
      totalBytes += doc.size;
    }
    return {
      plan: {
        rootFolderId: null,
        toUpload,
        toDelete: [],
        unchangedCount: 0,
        totalBytes,
      },
      inventory: null,
    };
  }

  const inventory = await scanDriveBackupTree(accessToken, rootFolderId);
  const syncCache = getDriveSyncCache();

  const toUpload: DriveBackupPlanItem[] = [];
  const toDelete: DriveDeletePlanItem[] = [];
  let unchangedCount = 0;
  let totalBytes = 0;

  for (const doc of localByPath.values()) {
    const remote = inventory.filesByPath.get(doc.relativePath);
    if (!remote) {
      toUpload.push({doc, action: 'new'});
      totalBytes += doc.size;
      continue;
    }

    const sizeDiffers = remote.size !== doc.size;
    const localIsNewer =
      remote.modifiedTimeMs > 0 && doc.lastModified > remote.modifiedTimeMs;

    // Guard against minor PC-vs-Google clock skew if this exact file state was already uploaded to this Drive ID
    const cachedRecord = syncCache[doc.relativePath];
    const matchesSyncedClockSkewGuard =
      !sizeDiffers &&
      cachedRecord &&
      cachedRecord.driveFileId === remote.id &&
      cachedRecord.size === doc.size &&
      cachedRecord.lastModified === doc.lastModified;

    if (sizeDiffers || (localIsNewer && !matchesSyncedClockSkewGuard)) {
      toUpload.push({
        doc,
        action: 'modified',
        existingDriveFileId: remote.id,
      });
      totalBytes += doc.size;
    } else {
      unchangedCount++;
    }
  }

  for (const remote of inventory.filesByPath.values()) {
    if (!localByPath.has(remote.relativePath)) {
      toDelete.push({
        driveFileId: remote.id,
        name: remote.name,
        relativePath: remote.relativePath,
        size: remote.size,
        parentId: remote.parentId,
      });
    }
  }

  for (const dup of inventory.duplicateFiles) {
    toDelete.push({
      driveFileId: dup.id,
      name: dup.name,
      relativePath: dup.relativePath,
      size: dup.size,
      parentId: dup.parentId,
    });
  }

  toUpload.sort((a, b) =>
    a.doc.relativePath.localeCompare(b.doc.relativePath, 'fr', {numeric: true})
  );
  toDelete.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, 'fr', {numeric: true})
  );

  return {
    plan: {
      rootFolderId,
      toUpload,
      toDelete,
      unchangedCount,
      totalBytes,
    },
    inventory,
  };
}

/**
 * Executes full mirror synchronization (add/PATCH updates, DELETE obsolete files,
 * bottom-up empty folder cleanup on Drive, and search_index.json refresh).
 */
export async function executeDriveMirrorSync(
  accessToken: string,
  analysis: DriveMirrorAnalysisResult,
  options?: {
    deleteObsolete?: boolean;
    onProgress?: (info: DriveMirrorProgress) => void;
  }
): Promise<DriveMirrorSyncResult> {
  const {plan, inventory} = analysis;
  const deleteObsolete = options?.deleteObsolete ?? true;
  const onProgress = options?.onProgress;

  const syncCache = getDriveSyncCache();
  const rootFolderId =
    plan.rootFolderId ||
    (await findOrCreateDriveFolder(accessToken, ROOT_BACKUP_FOLDER_NAME));

  const folderIdByPath = new Map<string, string>(
    inventory ? inventory.folderIdByPath : [['', rootFolderId]]
  );
  folderIdByPath.set('', rootFolderId);

  const ensureDriveFolderChain = async (segments: string[]): Promise<string> => {
    let currentParentId = rootFolderId;
    let currentPath = '';

    for (const seg of segments) {
      currentPath = currentPath ? `${currentPath}/${seg}` : seg;
      let folderId = folderIdByPath.get(currentPath);
      if (!folderId) {
        folderId = await findOrCreateDriveFolder(accessToken, seg, currentParentId);
        folderIdByPath.set(currentPath, folderId);

        if (inventory && !inventory.folderById.has(folderId)) {
          const parentNode = inventory.folderById.get(currentParentId);
          const newNode: RemoteDriveFolderNode = {
            id: folderId,
            name: seg,
            relativePath: currentPath,
            parentId: currentParentId,
            depth: (parentNode?.depth ?? 0) + 1,
            childFolderIds: new Set(),
            childFileIds: new Set(),
            otherFileCount: 0,
          };
          inventory.folderById.set(folderId, newNode);
          parentNode?.childFolderIds.add(folderId);
        }
      }
      currentParentId = folderId;
    }

    return currentParentId;
  };

  let uploaded = 0;
  let deleted = 0;
  let deletedFolders = 0;

  // 1. Add new files & PATCH modified files
  for (let i = 0; i < plan.toUpload.length; i++) {
    const item = plan.toUpload[i];
    const {doc} = item;
    if (!doc.handle) continue;

    onProgress?.({
      phase: 'upload',
      current: i + 1,
      total: plan.toUpload.length,
      fileName: doc.name,
    });

    const segments = doc.relativePath.split('/').filter(Boolean);
    const folderSegments = segments.slice(0, -1);
    const parentFolderId = await ensureDriveFolderChain(folderSegments);

    const file = await doc.handle.getFile();
    let targetId =
      item.existingDriveFileId ?? inventory?.filesByPath.get(doc.relativePath)?.id;

    if (!targetId) {
      const remoteExisting = await findExistingDriveFileInFolder(
        accessToken,
        doc.name,
        parentFolderId
      );
      if (remoteExisting) {
        targetId = remoteExisting.id;
      }
    }

    const result = await uploadOrUpdateDriveBlob(
      accessToken,
      doc.name,
      file,
      parentFolderId,
      targetId
    );

    if (inventory) {
      inventory.folderById.get(parentFolderId)?.childFileIds.add(result.id);
    }

    syncCache[doc.relativePath] = {
      driveFileId: result.id,
      size: file.size,
      lastModified: file.lastModified,
      syncedAt: Date.now(),
    };
    saveDriveSyncCache(syncCache);
    uploaded++;
  }

  // 2. Delete obsolete files on Drive
  if (deleteObsolete && plan.toDelete.length > 0) {
    for (let i = 0; i < plan.toDelete.length; i++) {
      const item = plan.toDelete[i];
      onProgress?.({
        phase: 'delete',
        current: i + 1,
        total: plan.toDelete.length,
        fileName: item.name,
      });

      await deleteDriveFileOrFolder(accessToken, item.driveFileId);

      if (syncCache[item.relativePath]?.driveFileId === item.driveFileId) {
        delete syncCache[item.relativePath];
        saveDriveSyncCache(syncCache);
      }

      if (inventory) {
        inventory.folderById.get(item.parentId)?.childFileIds.delete(item.driveFileId);
      }
      deleted++;
    }
  }

  // 3. Clean up empty folders bottom-up on Drive
  if (inventory) {
    const candidateFolders = Array.from(inventory.folderById.values())
      .filter((f) => f.depth > 0)
      .sort((a, b) => b.depth - a.depth);

    const emptyFolders: RemoteDriveFolderNode[] = [];
    for (const folder of candidateFolders) {
      if (
        folder.childFileIds.size === 0 &&
        folder.childFolderIds.size === 0 &&
        folder.otherFileCount === 0
      ) {
        emptyFolders.push(folder);
        inventory.folderById.get(folder.parentId)?.childFolderIds.delete(folder.id);
      }
    }

    for (let i = 0; i < emptyFolders.length; i++) {
      const folder = emptyFolders[i];
      onProgress?.({
        phase: 'cleanup',
        current: i + 1,
        total: emptyFolders.length,
        fileName: folder.name,
      });
      await deleteDriveFileOrFolder(accessToken, folder.id);
      deletedFolders++;
    }
  }

  // 4. Upload or update `search_index.json` at root of `Sauvegarde_Cours`
  let indexUpdated = false;
  try {
    onProgress?.({
      phase: 'index',
      current: 1,
      total: 1,
      fileName: SEARCH_INDEX_FILENAME,
    });
    const payload = await exportSearchIndexForCloud();
    const existingIndexId =
      inventory?.searchIndexFileId ??
      (await findExistingDriveFileInFolder(accessToken, SEARCH_INDEX_FILENAME, rootFolderId))
        ?.id;

    if (payload.documents.length > 0 || existingIndexId) {
      const jsonBlob = new Blob([JSON.stringify(payload)], {
        type: 'application/json',
      });
      await uploadOrUpdateDriveBlob(
        accessToken,
        SEARCH_INDEX_FILENAME,
        jsonBlob,
        rootFolderId,
        existingIndexId
      );
      indexUpdated = true;
    }
  } catch (err) {
    console.warn('Impossible de téléverser search_index.json:', err);
  }

  return {uploaded, deleted, deletedFolders, indexUpdated};
}

/**
 * Fetches only the `modifiedTime` metadata of a Drive file (`fields=modifiedTime`).
 */
export async function fetchDriveFileModifiedTime(
  accessToken: string,
  fileId: string,
  signal?: AbortSignal
): Promise<string | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?fields=modifiedTime`,
    {
      headers: {Authorization: `Bearer ${accessToken}`},
      signal,
    }
  );
  if (res.status === 401) {
    invalidateStoredAccessTokenKeepEmail();
    throw new Error('Session Google expirée. Veuillez relancer l’action.');
  }
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `Impossible de vérifier les métadonnées Drive (${res.status}).`
    );
  }
  const data = (await res.json()) as {modifiedTime?: string};
  return data.modifiedTime ?? null;
}

/**
 * Reads `Sauvegarde_Cours / ...` recursively from Google Drive API v3
 * without downloading any document binaries.
 */
export async function fetchCloudDriveLibrary(accessToken: string): Promise<{
  hasBackupFolder: boolean;
  documents: CourseDocument[];
  searchIndexFileId: string | null;
  searchIndexModifiedTime: string | null;
}> {
  const rootFolderId = await findDriveFolder(accessToken, ROOT_BACKUP_FOLDER_NAME);
  if (!rootFolderId) {
    return {
      hasBackupFolder: false,
      documents: [],
      searchIndexFileId: null,
      searchIndexModifiedTime: null,
    };
  }

  const inventory = await scanDriveBackupTree(accessToken, rootFolderId);
  const docs: CourseDocument[] = [];

  for (const remote of inventory.filesByPath.values()) {
    const format = getCourseFileFormat(remote.name, remote.mimeType);
    if (!format) continue;

    const parts = remote.relativePath.split('/').filter(Boolean);
    const dirSegments = parts.slice(0, -1);
    const subject = dirSegments[0] ?? 'à organiser';
    const professor =
      dirSegments.length === 0
        ? 'Racine'
        : dirSegments.length === 1
        ? 'Général'
        : dirSegments.slice(1).join(' / ');

    docs.push({
      relativePath: remote.relativePath,
      name: remote.name,
      format,
      subject,
      professor,
      size: remote.size,
      lastModified: remote.modifiedTimeMs,
      pageCount: 0,
      source: 'cloud',
      driveFileId: remote.id,
      driveParentFolderId: remote.parentId,
      driveModifiedTime: remote.modifiedTime || undefined,
    });
  }

  docs.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'fr', {numeric: true}));

  return {
    hasBackupFolder: true,
    documents: docs,
    searchIndexFileId: inventory.searchIndexFileId,
    searchIndexModifiedTime: inventory.searchIndexModifiedTime,
  };
}

/**
 * Downloads only the lightweight `search_index.json` file from Google Drive.
 */
export async function downloadCloudSearchIndex(
  accessToken: string,
  fileId: string
): Promise<CloudSearchIndexPayload> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: {Authorization: `Bearer ${accessToken}`},
    }
  );
  if (res.status === 401) {
    invalidateStoredAccessTokenKeepEmail();
    throw new Error('Session Google expirée. Veuillez relancer l’action.');
  }
  if (!res.ok) {
    throw new Error(`Impossible de télécharger l’index de recherche (${res.status}).`);
  }
  return (await res.json()) as CloudSearchIndexPayload;
}

/**
 * Fetches a single document on-demand into memory (`Uint8Array`) without writing to disk.
 */
export async function fetchCloudPdfBytes(
  accessToken: string,
  fileId: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: {Authorization: `Bearer ${accessToken}`},
      signal,
    }
  );
  if (res.status === 401) {
    invalidateStoredAccessTokenKeepEmail();
    throw new Error('Session Google expirée. Veuillez relancer l’ouverture du cours.');
  }
  if (!res.ok) {
    throw new Error(`Impossible de récupérer ce fichier depuis Google Drive (${res.status}).`);
  }
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}
