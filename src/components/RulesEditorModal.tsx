import React, {useState} from 'react';
import {X} from 'lucide-react';
import type {TitleFormatSettings} from '../types/course';
import {DEFAULT_TITLE_FORMAT_SETTINGS} from '../services/parser';
import {CourseTitleFormatSection} from './CourseTitleFormatSection';

interface RulesEditorModalProps {
  isOpen: boolean;
  titleFormat?: TitleFormatSettings;
  sampleFilename?: string | null;
  onSaveTitleFormat: (settings: TitleFormatSettings) => void;
  onClose: () => void;
}

export const RulesEditorModal: React.FC<RulesEditorModalProps> = ({
  isOpen,
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
  sampleFilename,
  onSaveTitleFormat,
  onClose,
}) => {
  const [draftTitleFormat, setDraftTitleFormat] =
    useState<TitleFormatSettings>(titleFormat);

  React.useEffect(() => {
    if (isOpen) {
      setDraftTitleFormat(titleFormat);
    }
  }, [isOpen, titleFormat]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveTitleFormat(draftTitleFormat);
    onClose();
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
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">
              Règles de tri & Format des noms de fichiers
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Le tri global analyse tout l’espace de travail exclusivement selon ce modèle.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <CourseTitleFormatSection
            value={draftTitleFormat}
            onChange={setDraftTitleFormat}
            sampleFilename={sampleFilename}
          />
        </div>

        <div className="px-5 py-3.5 border-t border-slate-800 bg-[#0B1120] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
          >
            Enregistrer le format
          </button>
        </div>
      </div>
    </div>
  );
};
