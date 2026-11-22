import React, {useEffect, useState} from 'react';
import {AlertTriangle, CheckCircle2, CloudUpload, RefreshCw, Trash2, X} from 'lucide-react';
import type {DriveMirrorProgress} from '../services/googleDrive';
import type {DriveBackupPlan} from '../types/course';

interface DriveBackupConfirmModalProps {
  isOpen: boolean;
  plan: DriveBackupPlan | null;
  hasClientId: boolean;
  isAnalyzing: boolean;
  isUploading: boolean;
  progress: DriveMirrorProgress | null;
  resultMessage: string | null;
  errorMessage: string | null;
  onConfirmUpload: () => void;
  onRetryAnalyze: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function getPhaseLabel(phase: DriveMirrorProgress['phase']): string {
  switch (phase) {
    case 'scan':
      return 'Analyse';
    case 'upload':
      return 'Envoi';
    case 'delete':
      return 'Suppression';
    case 'cleanup':
      return 'Nettoyage dossiers';
    case 'index':
      return 'Mise à jour index';
  }
}

export const DriveBackupConfirmModal: React.FC<DriveBackupConfirmModalProps> = ({
  isOpen,
  plan,
  hasClientId,
  isAnalyzing,
  isUploading,
  progress,
  resultMessage,
  errorMessage,
  onConfirmUpload,
  onRetryAnalyze,
  onOpenSettings,
  onClose,
}) => {
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  useEffect(() => {
    if (!isOpen || isUploading || resultMessage) {
      setConfirmBulkDelete(false);
    }
  }, [isOpen, isUploading, resultMessage, plan]);

  if (!isOpen) return null;

  const isBusy = isAnalyzing || isUploading;
  const deleteCount = plan?.toDelete.length ?? 0;
  const uploadCount = plan?.toUpload.length ?? 0;

  const handlePrimaryAction = () => {
    if (!plan) return;
    if (deleteCount > 5 && !confirmBulkDelete) {
      setConfirmBulkDelete(true);
      return;
    }
    setConfirmBulkDelete(false);
    onConfirmUpload();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={() => !isBusy && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-800 bg-[#0F172A] shadow-2xl overflow-hidden flex flex-col max-h-[84vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CloudUpload className="w-4 h-4 text-amber-400" />
            <h2 className="font-display text-base font-semibold text-slate-100">
              Synchronisation miroir Google Drive
            </h2>
          </div>
          {!isBusy && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {!hasClientId ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Aucun <span className="font-mono text-amber-300">Client ID</span> Google Cloud n’est encore configuré. Renseignez-le dans les paramètres (aide en 4 étapes incluse) pour activer la synchronisation miroir dans{' '}
                <span className="font-mono text-slate-200">Sauvegarde_Cours</span>.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
              >
                Ouvrir les paramètres Google Drive
              </button>
            </div>
          ) : isAnalyzing ? (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-center">
              <RefreshCw className="w-6 h-6 text-amber-400 animate-spin" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-100">
                  Inventaire comparatif en cours…
                </p>
                <p className="text-xs text-slate-400">
                  Lecture récursive de <span className="font-mono text-slate-300">Sauvegarde_Cours</span> sur Google Drive et comparaison avec vos fichiers locaux.
                </p>
              </div>
            </div>
          ) : resultMessage ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-emerald-200">
                  Synchronisation miroir terminée
                </p>
                <p className="text-xs text-emerald-300/90">{resultMessage}</p>
              </div>
            </div>
          ) : !plan ? (
            <div className="space-y-3">
              {errorMessage && (
                <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                  {errorMessage}
                </p>
              )}
              <button
                type="button"
                onClick={onRetryAnalyze}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Relancer l’analyse Drive</span>
              </button>
            </div>
          ) : (
            <>
              <div className="text-xs text-slate-300 leading-relaxed space-y-1">
                <p>
                  Dossier cible sur Drive :{' '}
                  <span className="font-mono text-slate-100">
                    Sauvegarde_Cours / Matière / Professeur
                  </span>
                </p>
                <p className="font-mono tabular-nums text-slate-400">
                  {uploadCount} à envoyer ({formatBytes(plan.totalBytes)}) · {deleteCount} obsolète{deleteCount > 1 ? 's' : ''} à supprimer · {plan.unchangedCount} à jour
                </p>
                <p className="text-[11px] text-slate-400">
                  Les dossiers devenus vides sur Drive seront automatiquement nettoyés et <span className="font-mono text-amber-300">search_index.json</span> sera actualisé.
                </p>
              </div>

              {confirmBulkDelete && deleteCount > 5 && (
                <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3.5 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs">
                    <p className="font-semibold text-amber-200">
                      {deleteCount} anciens fichiers vont être supprimés sur Drive, continuer ?
                    </p>
                    <p className="text-amber-300/80">
                      Ces fichiers ne sont plus présents à cet emplacement sur votre PC (supprimés, renommés ou déplacés lors du tri).
                    </p>
                  </div>
                </div>
              )}

              {uploadCount === 0 && deleteCount === 0 ? (
                <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-4 text-xs text-slate-300">
                  Votre sauvegarde Google Drive est déjà un miroir exact de votre dossier PC. Vous pouvez tout de même nettoyer d’éventuels dossiers vides et actualiser <span className="font-mono text-slate-100">search_index.json</span>.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-[#0B1120] divide-y divide-slate-800/70">
                  {plan.toUpload.map((item) => (
                    <div
                      key={`up:${item.doc.relativePath}`}
                      className="px-3 py-2 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="text-slate-200 truncate">{item.doc.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {item.doc.relativePath}
                        </p>
                      </div>
                      <span
                        className={`font-mono text-[11px] shrink-0 ${
                          item.action === 'modified' ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        {item.action === 'modified' ? 'Mise à jour (PATCH)' : 'Nouveau'}
                      </span>
                    </div>
                  ))}
                  {plan.toDelete.map((item) => (
                    <div
                      key={`del:${item.driveFileId}`}
                      className="px-3 py-2 flex items-center justify-between gap-3 text-xs bg-rose-950/15"
                    >
                      <div className="min-w-0">
                        <p className="text-rose-200 truncate">{item.name}</p>
                        <p className="text-[11px] text-rose-400/70 truncate">
                          {item.relativePath}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-rose-400 shrink-0">
                        <Trash2 className="w-3 h-3" />
                        <span>Supprimer</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {progress && isUploading && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-amber-300">
                    <span className="truncate">
                      {getPhaseLabel(progress.phase)} : {progress.fileName}
                    </span>
                    <span className="font-mono tabular-nums shrink-0 ml-2">
                      {progress.current}/{progress.total}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-150"
                      style={{
                        width: `${Math.round(
                          (progress.current / Math.max(1, progress.total)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {errorMessage && (
                <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                  {errorMessage}
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-800 bg-[#0B1120] flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              if (confirmBulkDelete) {
                setConfirmBulkDelete(false);
              } else {
                onClose();
              }
            }}
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            {resultMessage ? 'Fermer' : confirmBulkDelete ? 'Retour' : 'Annuler'}
          </button>
          {hasClientId && !resultMessage && !isAnalyzing && plan && (
            <button
              type="button"
              disabled={isUploading}
              onClick={handlePrimaryAction}
              className={`rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50 cursor-pointer ${
                confirmBulkDelete
                  ? 'bg-rose-500 text-white hover:bg-rose-400'
                  : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
              }`}
            >
              {isUploading
                ? 'Synchronisation en cours…'
                : confirmBulkDelete
                ? `Continuer et supprimer (${deleteCount})`
                : uploadCount > 0 || deleteCount > 0
                ? 'Lancer la synchronisation miroir'
                : 'Actualiser l’index et nettoyer'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
