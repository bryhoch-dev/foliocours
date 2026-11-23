import React, {useEffect, useState} from 'react';
import {Check, Copy, Database, KeyRound, LogOut, RefreshCw, Trash2, X} from 'lucide-react';
import {
  clearAllOfflineCloudCache,
  getCloudCacheStats,
  getIndexStats,
} from '../services/db';
import {
  authenticateGoogleDrive,
  clearDriveSyncCache,
  disconnectGoogleDrive,
  getMemoryAccessToken,
  getSavedDriveClientId,
  getStoredDriveEmail,
  saveDriveClientId,
} from '../services/googleDrive';
import type {AppMode, SortRule, TitleFormatSettings} from '../types/course';
import {DEFAULT_TITLE_FORMAT_SETTINGS} from '../services/parser';
import {CourseTitleFormatSection} from './CourseTitleFormatSection';
import {PWAInstallButton} from './PWAInstallButton';

interface SettingsAndDriveModalProps {
  isOpen: boolean;
  mode: AppMode;
  hasRootFolder: boolean;
  rules?: SortRule[];
  titleFormat?: TitleFormatSettings;
  sampleFilename?: string | null;
  onChangeTitleFormat?: (settings: TitleFormatSettings) => void;
  onClose: () => void;
  onReindexAll: () => void;
  onClearIndex: () => Promise<void>;
  onCloudIndexCleared?: () => void;
  onCloudAuthChanged?: (connected: boolean) => void;
}

export const SettingsAndDriveModal: React.FC<SettingsAndDriveModalProps> = ({
  isOpen,
  mode,
  hasRootFolder,
  rules,
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
  sampleFilename,
  onChangeTitleFormat,
  onClose,
  onReindexAll,
  onClearIndex,
  onCloudIndexCleared,
  onCloudAuthChanged,
}) => {
  const [clientId, setClientId] = useState(getSavedDriveClientId);
  const [isConnected, setIsConnected] = useState(() => !!getMemoryAccessToken());
  const [userEmail, setUserEmail] = useState(getStoredDriveEmail);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [copiedOrigin, setCopiedOrigin] = useState(false);
  const [stats, setStats] = useState<{documentCount: number; pageCount: number}>({
    documentCount: 0,
    pageCount: 0,
  });
  const [cloudCacheStats, setCloudCacheStats] = useState<{
    cachedFileCount: number;
    cachedBytes: number;
    indexDocCount: number;
  }>({cachedFileCount: 0, cachedBytes: 0, indexDocCount: 0});

  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000';

  useEffect(() => {
    if (isOpen) {
      setClientId(getSavedDriveClientId());
      setIsConnected(!!getMemoryAccessToken());
      setUserEmail(getStoredDriveEmail());
      setAuthStatus(null);
      setAuthError(null);
      getIndexStats().then(setStats).catch(() => {});
      getCloudCacheStats()
        .then(setCloudCacheStats)
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveClientId = () => {
    saveDriveClientId(clientId);
    setAuthStatus('Client ID enregistré localement.');
    setAuthError(null);
  };

  const handleTestGoogleSignIn = async () => {
    setAuthError(null);
    setAuthStatus(null);
    saveDriveClientId(clientId);
    setIsConnecting(true);
    try {
      await authenticateGoogleDrive(clientId, true);
      setIsConnected(true);
      setUserEmail(getStoredDriveEmail());
      onCloudAuthChanged?.(true);
      setAuthStatus('Session Google Drive enregistrée et active.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Échec de connexion Google.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnectGoogleDrive();
    setIsConnected(false);
    setUserEmail('');
    onCloudAuthChanged?.(false);
    setAuthStatus('Session Google déconnectée.');
  };

  const handleCopyOrigin = async () => {
    try {
      await navigator.clipboard.writeText(currentOrigin);
      setCopiedOrigin(true);
      setTimeout(() => setCopiedOrigin(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-800 bg-[#0F172A] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">
              Paramètres & Sauvegarde Google Drive
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Format des titres, configuration OAuth 2.0 (Google Identity Services), index IndexedDB et PWA.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {onChangeTitleFormat && (
            <div className="pb-5 border-b border-slate-800">
              <CourseTitleFormatSection
                value={titleFormat}
                onChange={onChangeTitleFormat}
                sampleFilename={sampleFilename}
                rules={rules}
              />
            </div>
          )}

          {/* Google Drive Client ID & OAuth Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Google Drive API v3 (scope drive.file)
                </h3>
              </div>
              <span
                className={`text-xs font-medium ${
                  isConnected ? 'text-emerald-400' : userEmail ? 'text-amber-300' : 'text-slate-400'
                }`}
              >
                {isConnected
                  ? userEmail
                    ? `Connecté (${userEmail})`
                    : 'Connecté (session persistée)'
                  : userEmail
                  ? `Renouvellement auto (${userEmail})`
                  : 'Non connecté'}
              </span>
            </div>

            <div className="space-y-2">
              <label className="block text-xs text-slate-300">
                Client ID Google Cloud (OAuth 2.0 Web)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="1234567890-abcdefg.apps.googleusercontent.com"
                  className="flex-1 rounded-lg border border-slate-800 bg-[#0B1120] px-3 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-amber-500/60 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveClientId}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer shrink-0"
                >
                  Enregistrer
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleTestGoogleSignIn}
                disabled={isConnecting || !clientId.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 cursor-pointer"
              >
                <span>
                  {isConnecting
                    ? 'Ouverture Google…'
                    : isConnected
                    ? 'Renouveler la session Google'
                    : 'Se connecter avec Google'}
                </span>
              </button>

              {isConnected && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Déconnecter</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  clearDriveSyncCache();
                  setAuthStatus(
                    'Historique de synchronisation effacé : la prochaine sauvegarde revérifiera tous les fichiers.'
                  );
                }}
                className="text-xs text-slate-400 hover:text-slate-200 underline-offset-4 hover:underline ml-auto cursor-pointer"
              >
                Réinitialiser le cache Drive
              </button>
            </div>

            {authStatus && <p className="text-xs text-emerald-400">{authStatus}</p>}
            {authError && <p className="text-xs text-rose-400">{authError}</p>}

            {/* 4-Step Guide */}
            <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-slate-200">
                  Aide en 4 étapes — Obtenir votre Client ID Google Cloud
                </h4>
                <button
                  type="button"
                  onClick={handleCopyOrigin}
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-300 hover:text-amber-200 cursor-pointer"
                  title="Copier l’origine actuelle"
                >
                  {copiedOrigin ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Copié</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>{currentOrigin}</span>
                    </>
                  )}
                </button>
              </div>
              <ol className="space-y-1.5 text-xs text-slate-400 leading-relaxed">
                <li>
                  <strong className="text-slate-200">1.</strong> Créez un projet dans Google Cloud Console puis activez{' '}
                  <span className="text-slate-200">Google Drive API</span> dans « API et services ».
                </li>
                <li>
                  <strong className="text-slate-200">2.</strong> Configurez l’écran de consentement OAuth (type Externe, ajoutez votre e-mail en utilisateur test et le scope{' '}
                  <span className="font-mono text-slate-300">drive.file</span>).
                </li>
                <li>
                  <strong className="text-slate-200">3.</strong> Créez un identifiant{' '}
                  <span className="text-slate-200">ID client OAuth → Application Web</span> et ajoutez{' '}
                  <span className="font-mono text-slate-300">http://localhost:8000</span> (ainsi que votre origine actuelle) dans « Origines JavaScript autorisées ».
                </li>
                <li>
                  <strong className="text-slate-200">4.</strong> Copiez le Client ID terminé par{' '}
                  <span className="font-mono text-slate-300">.apps.googleusercontent.com</span> ci-dessus et cliquez sur « Enregistrer ».
                </li>
              </ol>
            </div>
          </section>

          {/* IndexedDB Low-RAM Index Management */}
          <section className="pt-4 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-400" />
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Index plein texte (PC & Cloud)
                </h3>
              </div>
              <span className="font-mono tabular-nums text-xs text-slate-400">
                Local : {stats.documentCount} ({stats.pageCount} p.) · Hors-ligne Cloud : {cloudCacheStats.cachedFileCount} cours ({(cloudCacheStats.cachedBytes / (1024 * 1024)).toFixed(1)} Mo) · Index : {cloudCacheStats.indexDocCount}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  onReindexAll();
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {mode === 'cloud'
                    ? 'Actualiser l’index Cloud Drive'
                    : hasRootFolder
                    ? 'Réindexer le dossier local'
                    : 'Indexer mes cours locaux'}
                </span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  await onClearIndex();
                  setStats({documentCount: 0, pageCount: 0});
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/10 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vider l’index local</span>
              </button>

              <button
                type="button"
                disabled={
                  cloudCacheStats.cachedFileCount === 0 &&
                  cloudCacheStats.indexDocCount === 0
                }
                onClick={async () => {
                  await clearAllOfflineCloudCache();
                  setCloudCacheStats({
                    cachedFileCount: 0,
                    cachedBytes: 0,
                    indexDocCount: 0,
                  });
                  setAuthStatus('Cache hors-ligne (index et fichiers Cloud) vidé.');
                  onCloudIndexCleared?.();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-45 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vider le cache hors-ligne</span>
              </button>
            </div>
          </section>

          {/* PWA Install section */}
          <section className="pt-4 border-t border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Application installable (PWA)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Installez FolioCours en fenêtre dédiée sans barre d’adresse sur PC ou smartphone.
              </p>
            </div>
            <PWAInstallButton showFallbackHint />
          </section>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-800 bg-[#0B1120] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
