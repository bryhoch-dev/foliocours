import React, {useMemo, useState} from 'react';
import {Plus, RotateCcw, Trash2, X} from 'lucide-react';
import type {RuleMatchTarget, SortRule, TitleFormatSettings} from '../types/course';
import {
  DEFAULT_SORT_RULES,
  DEFAULT_TITLE_FORMAT_SETTINGS,
  parseCourseFilename,
} from '../services/parser';
import {CourseTitleFormatSection} from './CourseTitleFormatSection';

interface RulesEditorModalProps {
  isOpen: boolean;
  rules: SortRule[];
  titleFormat?: TitleFormatSettings;
  sampleOrganizeFilename?: string | null;
  onSaveRules: (rules: SortRule[]) => void;
  onSaveTitleFormat?: (settings: TitleFormatSettings) => void;
  onClose: () => void;
}

export const RulesEditorModal: React.FC<RulesEditorModalProps> = ({
  isOpen,
  rules,
  titleFormat = DEFAULT_TITLE_FORMAT_SETTINGS,
  sampleOrganizeFilename,
  onSaveRules,
  onSaveTitleFormat,
  onClose,
}) => {
  const [draftRules, setDraftRules] = useState<SortRule[]>(rules);
  const [draftTitleFormat, setDraftTitleFormat] =
    useState<TitleFormatSettings>(titleFormat);
  const [testFilename, setTestFilename] = useState(
    sampleOrganizeFilename?.trim() || 'UE4_Pr. Page_Ronéo 3.pdf'
  );

  React.useEffect(() => {
    if (isOpen) {
      setDraftRules(rules);
      setDraftTitleFormat(titleFormat);
      if (sampleOrganizeFilename?.trim()) {
        setTestFilename(sampleOrganizeFilename);
      }
    }
  }, [isOpen, rules, titleFormat, sampleOrganizeFilename]);

  const previewResult = useMemo(
    () =>
      parseCourseFilename(
        testFilename || 'UE1_Dupont_Ronéo 1.pdf',
        draftRules,
        undefined,
        draftTitleFormat
      ),
    [testFilename, draftRules, draftTitleFormat]
  );

  if (!isOpen) return null;

  const handleAddRule = () => {
    const newRule: SortRule = {
      id: `rule-${Date.now()}`,
      pattern: '',
      matchTarget: 'any',
      subject: '',
      professor: '',
      enabled: true,
    };
    setDraftRules((prev) => [newRule, ...prev]);
  };

  const handleUpdate = (id: string, patch: Partial<SortRule>) => {
    setDraftRules((prev) => prev.map((r) => (r.id === id ? {...r, ...patch} : r)));
  };

  const handleDelete = (id: string) => {
    setDraftRules((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSave = () => {
    const cleaned = draftRules.filter((r) => r.pattern.trim().length > 0);
    onSaveRules(cleaned);
    onSaveTitleFormat?.(draftTitleFormat);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-slate-800 bg-[#0F172A] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">
              Règles de tri & Format du titre de cours
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Correspondances automatiques (<span className="font-mono text-slate-300">Matière / Professeur</span>) et modèles de nommage sauvegardés dans <span className="font-mono text-slate-300">localStorage</span>.
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

        {/* Live test simulator */}
        <div className="px-5 py-3 border-b border-slate-800/80 bg-[#0B1120] space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <label className="text-xs font-medium text-slate-300 shrink-0">
              Tester une règle :
            </label>
            <input
              type="text"
              value={testFilename}
              onChange={(e) => setTestFilename(e.target.value)}
              className="flex-1 rounded-md border border-slate-800 bg-[#0F172A] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
            <span>Destination :</span>
            <span className="font-medium text-amber-300">{previewResult.subject}</span>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-slate-200">{previewResult.professor}</span>
            <span aria-hidden="true">·</span>
            <span>Titre :</span>
            <span className="font-medium text-emerald-300">{previewResult.displayTitle}</span>
          </div>
        </div>

        {/* Scrollable body: Rules + Course Title Format */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleAddRule}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Ajouter une règle</span>
              </button>

              <button
                type="button"
                onClick={() => setDraftRules(DEFAULT_SORT_RULES)}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Réinitialiser les exemples</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {draftRules.map((rule) => (
                <div
                  key={rule.id}
                  className="rounded-lg border border-slate-800 bg-[#0B1120] p-3 grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end"
                >
                  <label className="md:col-span-3 block">
                    <span className="block text-[11px] text-slate-400 mb-1">
                      Si le nom contient
                    </span>
                    <input
                      type="text"
                      value={rule.pattern}
                      placeholder="ex. Page ou UE4"
                      onChange={(e) => handleUpdate(rule.id, {pattern: e.target.value})}
                      className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="md:col-span-2 block">
                    <span className="block text-[11px] text-slate-400 mb-1">Cible</span>
                    <select
                      value={rule.matchTarget}
                      onChange={(e) =>
                        handleUpdate(rule.id, {
                          matchTarget: e.target.value as RuleMatchTarget,
                        })
                      }
                      className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-2 py-1.5 text-xs text-slate-200 focus:border-amber-500/60 focus:outline-none"
                    >
                      <option value="any">Tout</option>
                      <option value="ue">Code UE</option>
                      <option value="professor">Professeur</option>
                      <option value="filename">Nom complet</option>
                    </select>
                  </label>

                  <label className="md:col-span-3 block">
                    <span className="block text-[11px] text-slate-400 mb-1">Matière</span>
                    <input
                      type="text"
                      value={rule.subject}
                      placeholder="ex. Génétique"
                      onChange={(e) => handleUpdate(rule.id, {subject: e.target.value})}
                      className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <label className="md:col-span-3 block">
                    <span className="block text-[11px] text-slate-400 mb-1">
                      Professeur (optionnel)
                    </span>
                    <input
                      type="text"
                      value={rule.professor}
                      placeholder="Laisser vide = auto"
                      onChange={(e) => handleUpdate(rule.id, {professor: e.target.value})}
                      className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none"
                    />
                  </label>

                  <div className="md:col-span-1 flex items-center justify-end gap-2 pb-1">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => handleUpdate(rule.id, {enabled: e.target.checked})}
                      title="Activer / désactiver la règle"
                      className="h-4 w-4 accent-amber-500 cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => handleDelete(rule.id)}
                      aria-label="Supprimer cette règle"
                      className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-5 border-t border-slate-800">
            <CourseTitleFormatSection
              value={draftTitleFormat}
              onChange={setDraftTitleFormat}
              rules={draftRules}
              sampleOrganizeFilename={sampleOrganizeFilename}
            />
          </div>
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
            Enregistrer les règles et le format
          </button>
        </div>
      </div>
    </div>
  );
};
