import React, {useEffect, useMemo, useRef, useState} from 'react';
import {RotateCcw, Sparkles, Tag} from 'lucide-react';
import type {SeparatorPreset, SortRule, TitleFormatSettings} from '../types/course';
import {
  DEFAULT_TITLE_FORMAT_SETTINGS,
  getActiveSeparator,
  parseCourseFilename,
} from '../services/parser';
import {ORGANIZE_PATH_LABEL} from '../services/filesystem';

interface CourseTitleFormatSectionProps {
  value: TitleFormatSettings;
  onChange: (next: TitleFormatSettings) => void;
  rules: SortRule[];
  sampleOrganizeFilename?: string | null;
}

const INPUT_TAGS = ['{Matière}', '{Prof}', '{Type}', '{Numéro}', '{Titre}'] as const;
const OUTPUT_TAGS = [
  '{Matière}',
  '{Prof}',
  '{Type}',
  '{Numéro}',
  '{Titre}',
  '{NomOriginal}',
] as const;

const SEPARATOR_OPTIONS: Array<{value: SeparatorPreset; label: string}> = [
  {value: '_', label: 'Tiret bas ( _ )'},
  {value: '-', label: 'Tiret simple ( - )'},
  {value: ' - ', label: 'Tiret espacé ( - )'},
  {value: 'custom', label: 'Personnalisé…'},
];

function getDefaultTestFilename(sep: string): string {
  return `Génétique${sep}Pr. Page${sep}CM 4 - Expression des gènes.pdf`;
}

export const CourseTitleFormatSection: React.FC<CourseTitleFormatSectionProps> = ({
  value,
  onChange,
  rules,
  sampleOrganizeFilename,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const outputRef = useRef<HTMLInputElement | null>(null);

  const [customTestName, setCustomTestName] = useState<string>(() =>
    sampleOrganizeFilename?.trim()
      ? sampleOrganizeFilename
      : getDefaultTestFilename(getActiveSeparator(value))
  );
  const [userEditedSample, setUserEditedSample] = useState(false);

  // Sync automatically with the first file found in à organiser/Général if user hasn't typed a custom test name
  useEffect(() => {
    if (!userEditedSample) {
      if (sampleOrganizeFilename?.trim()) {
        setCustomTestName(sampleOrganizeFilename);
      } else {
        setCustomTestName(getDefaultTestFilename(getActiveSeparator(value)));
      }
    }
  }, [sampleOrganizeFilename, userEditedSample, value]);

  const insertTagAtCursor = (
    field: 'inputTemplate' | 'outputTemplate',
    tag: string
  ) => {
    const el = field === 'inputTemplate' ? inputRef.current : outputRef.current;
    const current = value[field];
    const sep = field === 'inputTemplate' ? getActiveSeparator(value) : ' ';

    if (!el || typeof el.selectionStart !== 'number') {
      const prefix = current.trim().length > 0 ? `${current}${sep}` : '';
      onChange({...value, [field]: `${prefix}${tag}`});
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd ?? start;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const needsLeadingSep =
      field === 'inputTemplate' && before.length > 0 && before.endsWith('}');
    const inserted = needsLeadingSep ? `${sep}${tag}` : tag;
    const nextText = `${before}${inserted}${after}`;

    onChange({...value, [field]: nextText});

    requestAnimationFrame(() => {
      el.focus();
      const caretPos = start + inserted.length;
      el.setSelectionRange(caretPos, caretPos);
    });
  };

  const activeSample =
    customTestName.trim() ||
    sampleOrganizeFilename?.trim() ||
    getDefaultTestFilename(getActiveSeparator(value));

  const preview = useMemo(
    () => parseCourseFilename(activeSample, rules, undefined, value),
    [activeSample, rules, value]
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Format du titre de cours
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Personnalisez la reconnaissance des noms de fichiers et l’affichage du titre (sauvegardé dans{' '}
            <span className="font-mono text-slate-300">localStorage</span>).
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_TITLE_FORMAT_SETTINGS)}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Format par défaut</span>
        </button>
      </div>

      {/* 1. Modèle de lecture (entrée) + Séparateur */}
      <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3.5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
          <div className="md:col-span-8 space-y-1.5">
            <label
              htmlFor="foliocours-input-template"
              className="block text-xs font-medium text-slate-200"
            >
              1. Modèle de lecture (entrée)
            </label>
            <input
              id="foliocours-input-template"
              ref={inputRef}
              type="text"
              value={value.inputTemplate}
              onChange={(e) => onChange({...value, inputTemplate: e.target.value})}
              placeholder="{Matière}_{Prof}_{Titre}"
              className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          <div className="md:col-span-4 space-y-1.5">
            <label
              htmlFor="foliocours-separator-preset"
              className="block text-xs font-medium text-slate-200"
            >
              Séparateur principal
            </label>
            <select
              id="foliocours-separator-preset"
              value={value.separatorPreset}
              onChange={(e) =>
                onChange({
                  ...value,
                  separatorPreset: e.target.value as SeparatorPreset,
                })
              }
              className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none"
            >
              {SEPARATOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {value.separatorPreset === 'custom' && (
              <input
                type="text"
                value={value.customSeparator}
                onChange={(e) => onChange({...value, customSeparator: e.target.value})}
                placeholder="ex. :: ou |"
                aria-label="Séparateur personnalisé"
                className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:border-amber-500/60 focus:outline-none"
              />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 mr-1">
            <Tag className="w-3 h-3 text-amber-400" />
            <span>Insérer :</span>
          </span>
          {INPUT_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => insertTagAtCursor('inputTemplate', tag)}
              className="rounded-md border border-slate-700 bg-[#0F172A] px-2 py-1 text-[11px] font-mono text-amber-300 hover:border-amber-500/50 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Modèle d'affichage du titre (sortie) */}
      <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3.5 space-y-3">
        <div className="space-y-1.5">
          <label
            htmlFor="foliocours-output-template"
            className="block text-xs font-medium text-slate-200"
          >
            2. Modèle d’affichage du titre (sortie)
          </label>
          <input
            id="foliocours-output-template"
            ref={outputRef}
            type="text"
            value={value.outputTemplate}
            onChange={(e) => onChange({...value, outputTemplate: e.target.value})}
            placeholder="{Titre} ou {Type} {Numéro} - {Titre}"
            className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-amber-500/60 focus:outline-none"
          />
          <p className="text-[11px] text-slate-500">
            Définit le titre affiché dans la liste des cours et en haut du lecteur (ex.{' '}
            <span className="font-mono text-slate-300">{'{Titre}'}</span> ou{' '}
            <span className="font-mono text-slate-300">{'{Type} {Numéro} - {Titre}'}</span>).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 mr-1">
            <Tag className="w-3 h-3 text-amber-400" />
            <span>Insérer :</span>
          </span>
          {OUTPUT_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => insertTagAtCursor('outputTemplate', tag)}
              className="rounded-md border border-slate-700 bg-[#0F172A] px-2 py-1 text-[11px] font-mono text-amber-300 hover:border-amber-500/50 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Physical disk rename option (unchecked by default) */}
        <label className="pt-2 border-t border-slate-800/80 flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={value.renameOnDisk}
            onChange={(e) => onChange({...value, renameOnDisk: e.target.checked})}
            className="mt-0.5 h-4 w-4 accent-amber-500 cursor-pointer shrink-0"
          />
          <span className="text-xs text-slate-200 leading-snug">
            Renommer aussi les fichiers sur le disque selon le format d’affichage lors du tri
            <span className="block text-[11px] text-slate-500 mt-0.5">
              L’extension d’origine (<span className="font-mono">.pdf</span>,{' '}
              <span className="font-mono">.docx</span>,{' '}
              <span className="font-mono">.odt</span>) est toujours conservée.
            </span>
          </span>
        </label>
      </div>

      {/* 3. Aperçu en temps réel */}
      <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Aperçu en temps réel</span>
          </div>
          {sampleOrganizeFilename && userEditedSample && (
            <button
              type="button"
              onClick={() => setUserEditedSample(false)}
              className="text-[11px] text-amber-300 hover:text-amber-200 underline-offset-4 hover:underline cursor-pointer"
            >
              Utiliser le 1er fichier de « {ORGANIZE_PATH_LABEL} »
            </button>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="foliocours-format-preview-input"
            className="block text-[11px] text-slate-400"
          >
            {sampleOrganizeFilename && !userEditedSample
              ? `Testé automatiquement sur le 1er fichier de « ${ORGANIZE_PATH_LABEL} » :`
              : 'Nom de fichier testé :'}
          </label>
          <input
            id="foliocours-format-preview-input"
            type="text"
            value={customTestName}
            onChange={(e) => {
              setUserEditedSample(true);
              setCustomTestName(e.target.value);
            }}
            className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-amber-500/60 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
          <div className="rounded-md border border-slate-800/90 bg-[#0F172A] px-2.5 py-2">
            <span className="block text-[11px] text-slate-500">Matière détectée</span>
            <span className="block font-medium text-amber-300 truncate mt-0.5" title={preview.subject}>
              {preview.subject}
            </span>
          </div>
          <div className="rounded-md border border-slate-800/90 bg-[#0F172A] px-2.5 py-2">
            <span className="block text-[11px] text-slate-500">Professeur détecté</span>
            <span className="block font-medium text-slate-100 truncate mt-0.5" title={preview.professor}>
              {preview.professor}
            </span>
          </div>
          <div className="rounded-md border border-slate-800/90 bg-[#0F172A] px-2.5 py-2">
            <span className="block text-[11px] text-slate-500">Titre affiché</span>
            <span className="block font-medium text-emerald-300 truncate mt-0.5" title={preview.displayTitle}>
              {preview.displayTitle}
            </span>
          </div>
        </div>

        {value.renameOnDisk && (
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 truncate">
            <span>Nom sur le disque :</span>
            <span className="font-mono text-slate-200 truncate" title={preview.targetName}>
              {preview.targetName}
            </span>
          </div>
        )}
      </div>
    </section>
  );
};
