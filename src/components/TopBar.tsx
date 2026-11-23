import React from 'react';
import {Cloud, CloudUpload, HardDrive, Loader2, RefreshCw, Search} from 'lucide-react';
import type {AppMode, WorkspaceTab} from '../types/course';
import {PWAInstallButton} from './PWAInstallButton';

interface TopBarProps {
  mode: AppMode;
  onChangeMode: (mode: AppMode) => void;
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOpenSearch: () => void;
  onOpenRules: () => void;
  onOpenSettings: () => void;
  onTriggerDriveBackup: () => void;
  onRefreshCloud: () => void;
  hasRootFolder: boolean;
  isBackingUp: boolean;
  isLoadingCloud: boolean;
  isCloudConnected: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  mode,
  onChangeMode,
  activeTab,
  onSelectTab,
  onOpenSearch,
  onOpenRules,
  onOpenSettings,
  onTriggerDriveBackup,
  onRefreshCloud,
  hasRootFolder,
  isBackingUp,
  isLoadingCloud,
  isCloudConnected,
}) => {
  return (
    <header className="hidden md:flex h-14 shrink-0 border-b border-slate-800/90 bg-[#0F172A] px-4 lg:px-6 items-center justify-between gap-6">
      {/* Zone 1: Brand mark & wordmark + Mode Switcher */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2.5 shrink-0">
          <svg
            className="w-6 h-6 shrink-0"
            viewBox="0 0 512 512"
            fill="none"
            aria-hidden="true"
          >
            <rect width="512" height="512" rx="112" fill="#1E293B" />
            <path d="M168 96H236V236L202 210L168 236V96Z" fill="#F59E0B" />
            <rect x="168" y="280" width="176" height="18" rx="9" fill="#E2E8F0" />
            <rect x="168" y="324" width="132" height="16" rx="8" fill="#64748B" />
          </svg>
          <span className="font-display text-base font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            FolioCours
          </span>
        </div>

        {/* Manual Mode Switcher (PC Local vs Cloud Drive) */}
        <div
          role="group"
          aria-label="Mode de source"
          className="inline-flex items-center rounded-lg border border-slate-800 bg-[#0B1120] p-0.5"
        >
          <button
            type="button"
            onClick={() => onChangeMode('local')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'local'
                ? 'bg-slate-800 text-amber-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 shrink-0" />
            <span>PC Local</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeMode('cloud')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'cloud'
                ? 'bg-slate-800 text-amber-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cloud className="w-3.5 h-3.5 shrink-0" />
            <span>Cloud Drive</span>
            {isLoadingCloud && (
              <Loader2
                className="w-3 h-3 animate-spin text-amber-400 shrink-0"
                aria-label="Synchronisation Drive en cours"
              />
            )}
          </button>
        </div>
      </div>

      {/* Zone 2: Single-line navigation + global search trigger */}
      <nav className="flex items-center gap-5 min-w-0">
        <button
          type="button"
          onClick={() => onSelectTab('library')}
          className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 border-b-2 ${
            activeTab === 'library'
              ? 'text-amber-400 border-amber-500'
              : 'text-slate-400 border-transparent hover:text-slate-100'
          }`}
        >
          Bibliothèque
        </button>
        {mode === 'local' && (
          <button
            type="button"
            onClick={() => onSelectTab('import')}
            className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 border-b-2 ${
              activeTab === 'import'
                ? 'text-amber-400 border-amber-500'
                : 'text-slate-400 border-transparent hover:text-slate-100'
            }`}
          >
            À organiser
          </button>
        )}
        {mode === 'local' && (
          <button
            type="button"
            onClick={onOpenRules}
            className="text-sm font-medium text-slate-400 hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 border-b-2 border-transparent"
          >
            Règles
          </button>
        )}
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-sm font-medium text-slate-400 hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer py-1 border-b-2 border-transparent"
        >
          Paramètres
        </button>

        <button
          type="button"
          onClick={onOpenSearch}
          className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-[#0B1120] px-3 py-1.5 text-xs text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-colors w-56 lg:w-64 cursor-pointer shrink-0"
        >
          <span className="flex items-center gap-2 truncate">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="truncate">Rechercher dans les cours…</span>
          </span>
          <kbd className="font-mono text-[11px] text-slate-500 shrink-0">Ctrl K</kbd>
        </button>
      </nav>

      {/* Zone 3: Install + Primary Google Drive Action */}
      <div className="flex items-center gap-2.5 shrink-0">
        <PWAInstallButton compact />
        {mode === 'local' ? (
          <button
            type="button"
            onClick={onTriggerDriveBackup}
            disabled={!hasRootFolder || isBackingUp}
            title={
              hasRootFolder
                ? 'Sauvegarder les fichiers nouveaux ou modifiés sur Google Drive'
                : 'Liez d’abord un dossier local'
            }
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CloudUpload className="w-3.5 h-3.5 shrink-0" />
            <span>{isBackingUp ? 'Sauvegarde…' : 'Sauvegarder sur Drive'}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onRefreshCloud}
            disabled={isLoadingCloud}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isLoadingCloud ? 'animate-spin' : ''}`} />
            <span>
              {isLoadingCloud
                ? 'Chargement…'
                : isCloudConnected
                ? 'Actualiser Drive'
                : 'Connecter Drive'}
            </span>
          </button>
        )}
      </div>
    </header>
  );
};
