import React, {useState} from 'react';
import {Plus, Trash2, X} from 'lucide-react';
import type {RuleMatchTarget, SortRule, TitleFormatSettings} from '../types/course';
import {DEFAULT_TITLE_FORMAT_SETTINGS} from '../services/parser';
import {CourseTitleFormatSection} from './CourseTitleFormatSection';

interface RulesEditorModalProps {
  isOpen: boolean;
  rules?: SortRule[];
  titleFormat?: TitleFormatSettings;
  sampleFilename?: string | null;
  onSaveRules?: (rules: SortRule[]) => void;
  onSaveTitleFormat: (settings: TitleFormatSettings) => void;
  onClose: () => void;
}

export const RulesEditorModal: React.FC<RulesEditorModalProps> = ({
  isOpen,
  rules = [],
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
  sampleFilename,
  onSaveRules,
  onSaveTitleFormat,
  onClose,
}) => {
  const [draftTitleFormat, setDraftTitleFormat] =
    useState<TitleFormatSettings>(titleFormat);
  const [draftRules, setDraftRules] = useState<SortRule[]>(rules);

  React.useEffect(() => {
    if (isOpen) {
      setDraftTitleFormat(titleFormat);
      setDraftRules(rules);
    }
  }, [isOpen, titleFormat, rules]);

  if (!isOpen) return null;

  const handleAddRule = () => {
    setDraftRules((prev) => [
      ...prev,
      {
        id: `alias-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        pattern: '',
        matchTarget: 'subject',
        subject: '',
        professor: '',
        enabled: true,
      },
    ]);
  };

  const handleUpdateRule = (id: string, patch: Partial<SortRule>) => {
    setDraftRules((prev) =>
      prev.map((r) => (r.id === id ? {...r, ...patch} : r))
    );
  };

  const handleDeleteRule = (id: string) => {
    setDraftRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSave = () => {
    const cleanedRules = draftRules.filter((r) => r.pattern.trim().length > 0);
    onSaveRules?.(cleanedRules);
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
              Le tri global analyse tout l’espace de travail selon ce modèle et vos alias de dossiers.
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

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <CourseTitleFormatSection
            value={draftTitleFormat}
            onChange={setDraftTitleFormat}
            sampleFilename={sampleFilename}
            rules={draftRules}
          />

          {/* Alias Rules section (auto-populated on folder rename, editable manually) */}
          <section className="pt-5 border-t border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Règles d’alias & correspondances ({draftRules.length})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Créées automatiquement lors du renommage d’un dossier pour rediriger les prochains fichiers vers le nouveau nom.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddRule}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-300 transition-colors cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Ajouter un alias</span>
              </button>
            </div>

            {draftRules.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-[#0B1120] px-4 py-3 text-xs text-slate-400">
                Aucune règle d’alias enregistrée. Renommez un dossier dans l’arborescence ou cliquez sur « Ajouter un alias ».
              </p>
            ) : (
              <div className="space-y-2">
                {draftRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-lg border border-slate-800 bg-[#0B1120] p-3 grid grid-cols-1 sm:grid-cols-[auto_1fr_auto_1fr_1fr_auto] items-center gap-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) =>
                        handleUpdateRule(rule.id, {enabled: e.target.checked})
                      }
                      aria-label="Activer l'alias"
                      className="h-4 w-4 accent-amber-500 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={rule.pattern}
                      onChange={(e) =>
                        handleUpdateRule(rule.id, {pattern: e.target.value})
                      }
                      placeholder="Ancien nom / code"
                      className="rounded-md border border-slate-800 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500/60 focus:outline-none min-w-0"
                    />
                    <select
                      value={rule.matchTarget}
                      onChange={(e) =>
                        handleUpdateRule(rule.id, {
                          matchTarget: e.target.value as RuleMatchTarget,
                        })
                      }
                      aria-label="Cible"
                      className="rounded-md border border-slate-800 bg-[#0F172A] px-2 py-1.5 text-xs text-slate-300 focus:border-amber-500/60 focus:outline-none"
                    >
                      <option value="subject">Matière</option>
                      <option value="professor">Professeur</option>
                      <option value="any">Tout le nom</option>
                    </select>
                    <input
                      type="text"
                      value={rule.subject}
                      onChange={(e) =>
                        handleUpdateRule(rule.id, {subject: e.target.value})
                      }
                      placeholder="Nouvelle matière"
                      className="rounded-md border border-slate-800 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500/60 focus:outline-none min-w-0"
                    />
                    <input
                      type="text"
                      value={rule.professor}
                      onChange={(e) =>
                        handleUpdateRule(rule.id, {professor: e.target.value})
                      }
                      placeholder="Nouveau professeur"
                      className="rounded-md border border-slate-800 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-amber-500/60 focus:outline-none min-w-0"
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteRule(rule.id)}
                      title="Supprimer cet alias"
                      aria-label="Supprimer cet alias"
                      className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer justify-self-end"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
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
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
};
