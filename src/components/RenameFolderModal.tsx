import React, {useEffect, useRef, useState} from 'react';
import {FolderPen, X} from 'lucide-react';
import {sanitizePathSegment} from '../services/filesystem';

export interface RenameFolderTarget {
  kind: 'subject' | 'professor';
  subjectName: string;
  professorName?: string;
}

interface RenameFolderModalProps {
  target: RenameFolderTarget | null;
  isRenaming: boolean;
  onConfirm: (target: RenameFolderTarget, newName: string) => Promise<void>;
  onClose: () => void;
}

export const RenameFolderModal: React.FC<RenameFolderModalProps> = ({
  target,
  isRenaming,
  onConfirm,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const currentFolderName = target
    ? target.kind === 'subject'
      ? target.subjectName
      : target.professorName?.split(' / ').pop() ?? ''
    : '';

  const [draftName, setDraftName] = useState(currentFolderName);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setDraftName(currentFolderName);
      setErrorMsg(null);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [target, currentFolderName]);

  if (!target) return null;

  const sanitizedPreview = sanitizePathSegment(draftName, '');
  const isUnchanged = sanitizedPreview === currentFolderName;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sanitizedPreview) {
      setErrorMsg('Veuillez saisir un nom de dossier valide.');
      return;
    }
    if (sanitizedPreview.startsWith('.')) {
      setErrorMsg('Le nom du dossier ne peut pas commencer par un point.');
      return;
    }
    if (isUnchanged) {
      onClose();
      return;
    }

    setErrorMsg(null);
    try {
      await onConfirm(target, sanitizedPreview);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Impossible de renommer ce dossier.'
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={() => !isRenaming && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-800 bg-[#0F172A] shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FolderPen className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="font-display text-sm font-semibold text-slate-100 truncate">
                {target.kind === 'subject'
                  ? 'Renommer le dossier Matière'
                  : 'Renommer le dossier Professeur'}
              </h2>
              {target.kind === 'professor' && (
                <p className="text-[11px] text-slate-400 truncate">
                  Dans : {target.subjectName}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={isRenaming}
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="foliocours-rename-folder-input"
                className="block text-xs font-medium text-slate-200"
              >
                Nouveau nom du dossier
              </label>
              <input
                id="foliocours-rename-folder-input"
                ref={inputRef}
                type="text"
                value={draftName}
                disabled={isRenaming}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-[#0B1120] px-3 py-2 text-sm text-slate-100 focus:border-amber-500/60 focus:outline-none disabled:opacity-50"
              />
              {sanitizedPreview && sanitizedPreview !== draftName.trim() && (
                <p className="text-[11px] text-slate-400">
                  Nom enregistré sur disque :{' '}
                  <span className="font-mono text-slate-200">{sanitizedPreview}</span>
                </p>
              )}
            </div>

            {sanitizedPreview && !isUnchanged && (
              <div className="rounded-lg border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-xs text-slate-300 space-y-1">
                <p className="text-[11px] text-slate-400">
                  Règle de tri synchronisée automatiquement :
                </p>
                <p className="font-mono text-amber-300 truncate">
                  {currentFolderName} → {sanitizedPreview}
                </p>
                <p className="text-[11px] text-slate-500 leading-snug">
                  Les prochains tris dirigeront directement les nouveaux fichiers portant « {currentFolderName} » vers « {sanitizedPreview} ».
                </p>
              </div>
            )}

            {errorMsg && (
              <p className="text-xs text-rose-400 leading-snug">{errorMsg}</p>
            )}
          </div>

          <div className="px-5 py-3.5 border-t border-slate-800 bg-[#0B1120] flex items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={isRenaming}
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-45 cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isRenaming || !sanitizedPreview}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 cursor-pointer"
            >
              {isRenaming ? 'Renommage en cours…' : 'Renommer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
