import React from 'react';
import {CheckCircle2, CloudUpload, X} from 'lucide-react';
import type {DriveBackupPlan} from '../types/course';

interface DriveBackupConfirmModalProps {
  isOpen: boolean;
  plan: DriveBackupPlan | null;
  hasClientId: boolean;
  isUploading: boolean;
  progress: {current: number; total: number; fileName: string} | null;
  resultMessage: string | null;
  errorMessage: string | null;
  onConfirmUpload: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export const DriveBackupConfirmModal: React.FC<DriveBackupConfirmModalProps> = ({
  isOpen,
  plan,
  hasClientId,
  isUploading,
  progress,
  resultMessage,
  errorMessage,
  onConfirmUpload,
  onOpenSettings,
  onClose,
}) => {
  if (!isOpen || !plan) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={() => !isUploading && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-800 bg-[#0F172A] shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CloudUpload className="w-4 h-4 text-amber-400" />
            <h2 className="font-display text-base font-semibold text-slate-100">
              Sauvegarde sur Google Drive
            </h2>
          </div>
          {!isUploading && (
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
                Aucun <span className="font-mono text-amber-300">Client ID</span> Google Cloud n’est encore configuré. Renseignez-le dans les paramètres (aide en 4 étapes incluse) pour activer la sauvegarde différentielle dans{' '}
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
          ) : resultMessage ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-emerald-200">
                  Sauvegarde terminée
                </p>
                <p className="text-xs text-emerald-300/90">{resultMessage}</p>
              </div>
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
                  {plan.toUpload.length} fichier{plan.toUpload.length > 1 ? 's' : ''} à téléverser ({formatBytes(plan.totalBytes)}) · {plan.unchangedCount} déjà à jour
                </p>
                <p className="text-[11px] text-slate-400">
                  L’index léger <span className="font-mono text-amber-300">search_index.json</span> sera également mis à jour à la racine pour la recherche rapide sur mobile.
                </p>
              </div>

              {plan.toUpload.length === 0 ? (
                <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-4 text-xs text-slate-300">
                  Tous vos PDF locaux sont déjà sauvegardés et identiques sur Google Drive. Vous pouvez tout de même actualiser <span className="font-mono text-slate-100">search_index.json</span> pour votre smartphone.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-[#0B1120] divide-y divide-slate-800/70">
                  {plan.toUpload.map((item) => (
                    <div
                      key={item.doc.relativePath}
                      className="px-3 py-2 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="text-slate-200 truncate">{item.doc.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {item.doc.subject} / {item.doc.professor}
                        </p>
                      </div>
                      <span
                        className={`font-mono text-[11px] shrink-0 ${
                          item.action === 'modified' ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        {item.action === 'modified' ? 'Modifié' : 'Nouveau'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {progress && isUploading && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-amber-300">
                    <span className="truncate">Envoi : {progress.fileName}</span>
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
            disabled={isUploading}
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            {resultMessage ? 'Fermer' : 'Annuler'}
          </button>
          {hasClientId && !resultMessage && (
            <button
              type="button"
              disabled={isUploading}
              onClick={onConfirmUpload}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
            >
              {isUploading
                ? 'Sauvegarde en cours…'
                : plan.toUpload.length > 0
                ? 'Confirmer et sauvegarder'
                : 'Mettre à jour search_index.json'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
