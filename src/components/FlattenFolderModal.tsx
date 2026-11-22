import React, {useEffect, useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderArchive,
  FolderOpen,
  FolderSearch,
  HardDrive,
  X,
} from 'lucide-react';
import {
  flattenFolderToOrganize,
  listWorkspaceSubfolders,
  ORGANIZE_FOLDER_NAME,
  pickRootDirectory,
  previewFlattenSource,
  type FlattenExecutionResult,
  type FlattenPreviewSummary,
} from '../services/filesystem';

interface FlattenFolderModalProps {
  isOpen: boolean;
  rootHandle: FileSystemDirectoryHandle | null;
  onClose: () => void;
  onComplete: (result: FlattenExecutionResult, sourceName: string) => Promise<void>;
}

type SourceOption = 'workspace' | 'external';
type ModalStep = 'select' | 'confirm' | 'running' | 'done';

export const FlattenFolderModal: React.FC<FlattenFolderModalProps> = ({
  isOpen,
  rootHandle,
  onClose,
  onComplete,
}) => {
  const [step, setStep] = useState<ModalStep>('select');
  const [sourceOption, setSourceOption] = useState<SourceOption>('workspace');
  const [workspaceFolders, setWorkspaceFolders] = useState<string[]>([]);
  const [selectedWorkspaceFolder, setSelectedWorkspaceFolder] = useState('');
  const [externalHandle, setExternalHandle] =
    useState<FileSystemDirectoryHandle | null>(null);

  const [resolvedHandle, setResolvedHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [preview, setPreview] = useState<FlattenPreviewSummary | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null);
  const [result, setResult] = useState<FlattenExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !rootHandle) return;
    setStep('select');
    setPreview(null);
    setResolvedHandle(null);
    setExternalHandle(null);
    setProgress(null);
    setResult(null);
    setError(null);

    listWorkspaceSubfolders(rootHandle)
      .then((folders) => {
        setWorkspaceFolders(folders);
        if (folders.length > 0) {
          setSelectedWorkspaceFolder(folders[0]);
          setSourceOption('workspace');
        } else {
          setSelectedWorkspaceFolder('');
          setSourceOption('external');
        }
      })
      .catch(() => {
        setWorkspaceFolders([]);
        setSourceOption('external');
      });
  }, [isOpen, rootHandle]);

  if (!isOpen || !rootHandle) return null;

  const handlePickExternalFolder = async () => {
    setError(null);
    try {
      const picked = await pickRootDirectory();
      setExternalHandle(picked);
      setSourceOption('external');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(
        err instanceof Error ? err.message : 'Impossible d’ouvrir ce dossier.'
      );
    }
  };

  const handlePrepareConfirm = async () => {
    setError(null);
    setIsAnalyzing(true);
    try {
      let targetDir: FileSystemDirectoryHandle | null = null;
      if (sourceOption === 'workspace') {
        if (!selectedWorkspaceFolder) {
          throw new Error('Veuillez sélectionner un dossier dans votre espace de travail.');
        }
        targetDir = await rootHandle.getDirectoryHandle(selectedWorkspaceFolder, {
          create: false,
        });
      } else {
        if (!externalHandle) {
          throw new Error('Veuillez sélectionner un dossier sur votre ordinateur.');
        }
        targetDir = externalHandle;
      }

      const summary = await previewFlattenSource(rootHandle, targetDir);
      setResolvedHandle(targetDir);
      setPreview(summary);
      setStep('confirm');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Impossible d’analyser ce dossier.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmExecute = async () => {
    if (!resolvedHandle || !preview) return;
    setError(null);
    setStep('running');
    setProgress({current: 0, total: preview.courseFilesCount, fileName: ''});

    try {
      const execResult = await flattenFolderToOrganize(rootHandle, resolvedHandle, {
        sourceIsInWorkspace: sourceOption === 'workspace',
        onProgress: setProgress,
      });
      setResult(execResult);
      setStep('done');
      await onComplete(execResult, preview.sourceName);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erreur lors du déplacement des fichiers.'
      );
      setStep('confirm');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={() => {
        if (step !== 'running') onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-800 bg-[#0F172A] shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <FolderArchive className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-slate-100 truncate">
                Récupérer et aplatir un dossier
              </h2>
              <p className="text-xs text-slate-400">
                Déplace tous les cours (.pdf, .docx, .odt) vers « {ORGANIZE_FOLDER_NAME} »
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={step === 'running'}
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {step === 'select' && (
            <>
              <div className="space-y-3">
                {/* Choice 1: Workspace folder */}
                <label
                  className={`block rounded-xl border p-3.5 transition-colors cursor-pointer ${
                    sourceOption === 'workspace'
                      ? 'border-amber-500/60 bg-amber-500/10'
                      : 'border-slate-800 bg-[#0B1120] hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="flattenSource"
                      checked={sourceOption === 'workspace'}
                      onChange={() => setSourceOption('workspace')}
                      className="mt-0.5 accent-amber-500"
                    />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="text-xs font-semibold text-slate-100">
                          1. Choisir un dossier déjà dans mon espace de travail
                        </span>
                      </div>
                      {workspaceFolders.length > 0 ? (
                        <select
                          value={selectedWorkspaceFolder}
                          onFocus={() => setSourceOption('workspace')}
                          onChange={(e) => {
                            setSourceOption('workspace');
                            setSelectedWorkspaceFolder(e.target.value);
                          }}
                          className="w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2 text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none"
                        >
                          {workspaceFolders.map((folder) => (
                            <option key={folder} value={folder}>
                              {folder}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          Aucun autre sous-dossier racine présent actuellement (hors « {ORGANIZE_FOLDER_NAME} »).
                        </p>
                      )}
                    </div>
                  </div>
                </label>

                {/* Choice 2: External PC folder */}
                <div
                  onClick={() => setSourceOption('external')}
                  className={`rounded-xl border p-3.5 transition-colors cursor-pointer ${
                    sourceOption === 'external'
                      ? 'border-amber-500/60 bg-amber-500/10'
                      : 'border-slate-800 bg-[#0B1120] hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="flattenSource"
                      checked={sourceOption === 'external'}
                      onChange={() => setSourceOption('external')}
                      className="mt-0.5 accent-amber-500"
                    />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="text-xs font-semibold text-slate-100">
                          2. Sélectionner un autre dossier sur mon ordinateur
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handlePickExternalFolder();
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer shrink-0"
                        >
                          <FolderSearch className="w-3.5 h-3.5 text-amber-400" />
                          <span>
                            {externalHandle ? 'Changer de dossier…' : 'Parcourir sur le PC…'}
                          </span>
                        </button>
                        {externalHandle && (
                          <span className="text-xs font-mono text-amber-300 truncate">
                            {externalHandle.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 'confirm' && preview && (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1.5 text-xs text-slate-200 leading-relaxed">
                  <p className="font-semibold text-amber-200">
                    Confirmer l’extraction depuis « {preview.sourceName} » ?
                  </p>
                  <p className="text-slate-300">
                    Les fichiers de cours trouvés seront déplacés physiquement vers{' '}
                    <span className="font-mono text-amber-300">{ORGANIZE_FOLDER_NAME}/</span>.
                    Les doublons seront automatiquement renommés (ex.{' '}
                    <span className="font-mono">CM1 (2).pdf</span>).
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3.5 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Cours à déplacer (.pdf, .docx, .odt)</span>
                  <span className="font-mono tabular-nums font-semibold text-amber-300">
                    {preview.courseFilesCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Sous-dossiers explorés</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {preview.subfolderCount}
                  </span>
                </div>
                {preview.otherFilesCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Autres fichiers (images, ZIP…) conservés</span>
                    <span className="font-mono tabular-nums text-emerald-300">
                      {preview.otherFilesCount}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Les sous-dossiers devenus totalement vides seront supprimés de bas en haut (sans suppression récursive).{' '}
                {sourceOption === 'workspace'
                  ? `Si « ${preview.sourceName} » devient entièrement vide, il sera également retiré.`
                  : 'Tout dossier contenant d’autres fichiers sera conservé intact.'}
              </p>
            </div>
          )}

          {step === 'running' && progress && (
            <div className="py-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-200">
                <span className="truncate">
                  Déplacement : {progress.fileName || 'Analyse…'}
                </span>
                <span className="font-mono tabular-nums text-amber-300 shrink-0 ml-2">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-150"
                  style={{
                    width: `${
                      progress.total > 0
                        ? Math.round((progress.current / progress.total) * 100)
                        : 100
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {step === 'done' && result && preview && (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs text-emerald-100">
                  <p className="font-semibold">
                    Extraction terminée depuis « {preview.sourceName} »
                  </p>
                  <p className="text-emerald-200/90">
                    {result.movedCount} fichier{result.movedCount > 1 ? 's' : ''} déplacé
                    {result.movedCount > 1 ? 's' : ''} vers « {ORGANIZE_FOLDER_NAME} »
                    {result.renamedDuplicatesCount > 0
                      ? ` (dont ${result.renamedDuplicatesCount} doublon${
                          result.renamedDuplicatesCount > 1 ? 's' : ''
                        } renommé${result.renamedDuplicatesCount > 1 ? 's' : ''})`
                      : ''}
                    .
                  </p>
                  <p className="text-emerald-200/90">
                    {result.deletedFoldersCount} dossier
                    {result.deletedFoldersCount > 1 ? 's' : ''} vide
                    {result.deletedFoldersCount > 1 ? 's' : ''} supprimé
                    {result.deletedFoldersCount > 1 ? 's' : ''}.
                  </p>
                </div>
              </div>

              {result.keptFolders.length > 0 && (
                <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3 text-xs text-slate-300 space-y-1">
                  <p className="font-medium text-amber-300">
                    {result.keptFolders.length} dossier
                    {result.keptFolders.length > 1 ? 's' : ''} conservé
                    {result.keptFolders.length > 1 ? 's' : ''} (contenaient d’autres fichiers) :
                  </p>
                  <p className="font-mono text-[11px] text-slate-400 break-words">
                    {result.keptFolders.join(', ')}
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-[#0B1120] flex items-center justify-end gap-2.5">
          {step === 'select' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={
                  isAnalyzing ||
                  (sourceOption === 'workspace' && !selectedWorkspaceFolder) ||
                  (sourceOption === 'external' && !externalHandle)
                }
                onClick={() => void handlePrepareConfirm()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-45 cursor-pointer"
              >
                {isAnalyzing ? 'Analyse…' : 'Continuer'}
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep('select');
                }}
                className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Retour
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExecute()}
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
              >
                Confirmer et aplatir
              </button>
            </>
          )}

          {step === 'done' && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 cursor-pointer"
            >
              Fermer
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
