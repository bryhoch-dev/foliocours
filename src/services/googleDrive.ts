import type {
  CloudSearchIndexPayload,
  CourseDocument,
  DriveBackupPlan,
  DriveBackupPlanItem,
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
  forceConsent = false
): Promise<string> {
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

  await loadGoogleIdentityServices();

  const knownEmail = getStoredDriveEmail();
  let tokenResult: {accessToken: string; expiresInSec: number} | null = null;

  // Step 2: Silent background renewal when we already know the user's email
  if (!forceConsent && knownEmail) {
    try {
      tokenResult = await requestGisToken(trimmed, {
        prompt: '',
        hint: knownEmail,
        timeoutMs: 8000,
      });
    } catch {
      // Silent renewal failed -> fall through to interactive popup
      tokenResult = null;
    }
  }

  // Step 3: Interactive popup fallback
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

  return {toUpload, unchangedCount, totalBytes};
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
  const parentClause = parentId ? ` and '${escapeDriveQueryValue(parentId)}' in parents` : '';
  const q = `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`;
  const files = await listDriveFilesPaginated(
    accessToken,
    q,
    'nextPageToken, files(id, name)'
  );
  return files[0]?.id ?? null;
}

async function findOrCreateDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<string> {
  const existingId = await findDriveFolder(accessToken, folderName, parentId);
  if (existingId) return existingId;

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
): Promise<string> {
  const metadata = existingFileId ? {name: fileName} : {name: fileName, parents: [parentId]};

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], {type: 'application/json'}));
  form.append('file', blob);

  const endpoint = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';

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

  const data = (await res.json()) as {id: string};
  return data.id;
}

export async function executeDriveBackup(
  accessToken: string,
  plan: DriveBackupPlan,
  onProgress?: (info: {current: number; total: number; fileName: string}) => void
): Promise<{uploaded: number; skippedExisting: number; indexUpdated: boolean}> {
  const folderCache = new Map<string, string>();
  const syncCache = getDriveSyncCache();

  const rootFolderId = await findOrCreateDriveFolder(accessToken, ROOT_BACKUP_FOLDER_NAME);
  let uploaded = 0;
  let skippedExisting = 0;

  for (let i = 0; i < plan.toUpload.length; i++) {
    const item = plan.toUpload[i];
    const {doc} = item;
    if (!doc.handle) continue;

    onProgress?.({
      current: i + 1,
      total: plan.toUpload.length,
      fileName: doc.name,
    });

    let subjectId = folderCache.get(`S:${doc.subject}`);
    if (!subjectId) {
      subjectId = await findOrCreateDriveFolder(accessToken, doc.subject, rootFolderId);
      folderCache.set(`S:${doc.subject}`, subjectId);
    }

    const profKey = `P:${doc.subject}/${doc.professor}`;
    let profId = folderCache.get(profKey);
    if (!profId) {
      profId = await findOrCreateDriveFolder(accessToken, doc.professor, subjectId);
      folderCache.set(profKey, profId);
    }

    const file = await doc.handle.getFile();
    let targetId = item.existingDriveFileId;

    if (!targetId) {
      const remoteExisting = await findExistingDriveFileInFolder(accessToken, doc.name, profId);
      if (remoteExisting) {
        if (
          remoteExisting.size &&
          Number(remoteExisting.size) === file.size &&
          item.action === 'new'
        ) {
          syncCache[doc.relativePath] = {
            driveFileId: remoteExisting.id,
            size: file.size,
            lastModified: file.lastModified,
            syncedAt: Date.now(),
          };
          saveDriveSyncCache(syncCache);
          skippedExisting++;
          continue;
        }
        targetId = remoteExisting.id;
      }
    }

    const driveFileId = await uploadOrUpdateDriveBlob(
      accessToken,
      doc.name,
      file,
      profId,
      targetId
    );
    syncCache[doc.relativePath] = {
      driveFileId,
      size: file.size,
      lastModified: file.lastModified,
      syncedAt: Date.now(),
    };
    saveDriveSyncCache(syncCache);
    uploaded++;
  }

  // Upload or update lightweight `search_index.json` at root of `Sauvegarde_Cours`
  let indexUpdated = false;
  try {
    onProgress?.({
      current: plan.toUpload.length,
      total: plan.toUpload.length,
      fileName: SEARCH_INDEX_FILENAME,
    });
    const payload = await exportSearchIndexForCloud();
    if (payload.documents.length > 0) {
      const jsonBlob = new Blob([JSON.stringify(payload)], {
        type: 'application/json',
      });
      const existingIndex = await findExistingDriveFileInFolder(
        accessToken,
        SEARCH_INDEX_FILENAME,
        rootFolderId
      );
      await uploadOrUpdateDriveBlob(
        accessToken,
        SEARCH_INDEX_FILENAME,
        jsonBlob,
        rootFolderId,
        existingIndex?.id
      );
      indexUpdated = true;
    }
  } catch (err) {
    console.warn('Impossible de téléverser search_index.json:', err);
  }

  return {uploaded, skippedExisting, indexUpdated};
}

/**
 * Reads `Sauvegarde_Cours / Matière / Professeur` directly from Google Drive API v3
 * without downloading any PDF binaries.
 */
export async function fetchCloudDriveLibrary(accessToken: string): Promise<{
  hasBackupFolder: boolean;
  documents: CourseDocument[];
  searchIndexFileId: string | null;
}> {
  const rootFolderId = await findDriveFolder(accessToken, ROOT_BACKUP_FOLDER_NAME);
  if (!rootFolderId) {
    return {hasBackupFolder: false, documents: [], searchIndexFileId: null};
  }

  const level1Entries = await listChildrenByParentIds(accessToken, [rootFolderId]);
  const subjectFolders = level1Entries.filter(
    (f) => f.mimeType === 'application/vnd.google-apps.folder'
  );
  const indexEntry = level1Entries.find((f) => f.name === SEARCH_INDEX_FILENAME) ?? null;

  const docs: CourseDocument[] = [];

  for (const entry of level1Entries) {
    if (entry.mimeType === 'application/vnd.google-apps.folder') continue;
    const format = getCourseFileFormat(entry.name, entry.mimeType);
    if (format) {
      docs.push({
        relativePath: entry.name,
        name: entry.name,
        format,
        subject: 'à organiser',
        professor: 'Racine',
        size: Number(entry.size || 0),
        lastModified: entry.modifiedTime ? Date.parse(entry.modifiedTime) : 0,
        pageCount: 0,
        source: 'cloud',
        driveFileId: entry.id,
        driveParentFolderId: rootFolderId,
      });
    }
  }

  const subjectMap = new Map<string, string>();
  for (const s of subjectFolders) {
    subjectMap.set(s.id, s.name);
  }

  const level2Entries = await listChildrenByParentIds(
    accessToken,
    subjectFolders.map((s) => s.id)
  );
  const professorFolders: Array<{id: string; name: string; subjectName: string}> = [];

  for (const entry of level2Entries) {
    const parentId = entry.parents?.[0];
    const subjectName = (parentId && subjectMap.get(parentId)) || 'Matière';

    if (entry.mimeType === 'application/vnd.google-apps.folder') {
      professorFolders.push({id: entry.id, name: entry.name, subjectName});
    } else {
      const format = getCourseFileFormat(entry.name, entry.mimeType);
      if (format) {
        docs.push({
          relativePath: `${subjectName}/${entry.name}`,
          name: entry.name,
          format,
          subject: subjectName,
          professor: 'Général',
          size: Number(entry.size || 0),
          lastModified: entry.modifiedTime ? Date.parse(entry.modifiedTime) : 0,
          pageCount: 0,
          source: 'cloud',
          driveFileId: entry.id,
          driveParentFolderId: parentId || rootFolderId,
        });
      }
    }
  }

  const profMap = new Map<string, {name: string; subjectName: string}>();
  for (const p of professorFolders) {
    profMap.set(p.id, {name: p.name, subjectName: p.subjectName});
  }

  const level3Entries = await listChildrenByParentIds(
    accessToken,
    professorFolders.map((p) => p.id)
  );

  for (const entry of level3Entries) {
    if (entry.mimeType === 'application/vnd.google-apps.folder') continue;
    const format = getCourseFileFormat(entry.name, entry.mimeType);
    if (!format) continue;

    const parentId = entry.parents?.[0];
    const profInfo = parentId ? profMap.get(parentId) : undefined;
    const subjectName = profInfo?.subjectName || 'Matière';
    const professorName = profInfo?.name || 'Professeur';

    docs.push({
      relativePath: `${subjectName}/${professorName}/${entry.name}`,
      name: entry.name,
      format,
      subject: subjectName,
      professor: professorName,
      size: Number(entry.size || 0),
      lastModified: entry.modifiedTime ? Date.parse(entry.modifiedTime) : 0,
      pageCount: 0,
      source: 'cloud',
      driveFileId: entry.id,
      driveParentFolderId: parentId || rootFolderId,
    });
  }

  docs.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'fr', {numeric: true}));

  return {
    hasBackupFolder: true,
    documents: docs,
    searchIndexFileId: indexEntry?.id ?? null,
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
 * Fetches a single PDF on-demand into memory (`Uint8Array`) without writing anything locally.
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
    throw new Error(`Impossible de récupérer ce PDF depuis Google Drive (${res.status}).`);
  }
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}
