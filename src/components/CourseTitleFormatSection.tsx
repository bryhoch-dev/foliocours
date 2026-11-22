import React, {useEffect, useMemo, useRef, useState} from 'react';
import {RotateCcw, Sparkles, Tag} from 'lucide-react';
import type {TitleFormatSettings} from '../types/course';
import {
  DEFAULT_TITLE_FORMAT_SETTINGS,
  parseCourseFilename,
} from '../services/parser';
import {
  sanitizeCourseFileName,
  sanitizePathSegment,
} from '../services/filesystem';
import {getCourseFileFormat} from '../services/fileFormats';

interface CourseTitleFormatSectionProps {
  value: TitleFormatSettings;
  onChange: (next: TitleFormatSettings) => void;
  sampleFilename?: string | null;
}

const INPUT_TAGS = ['{Matière}', '{Prof}', '{Titre}', '{Ignorer}'] as const;
const OUTPUT_TAGS = ['{Titre}', '{Matière}', '{Prof}', '{NomOriginal}'] as const;

const PRESET_EXAMPLES = [
  '{Matière} - {Prof} - {Titre}',
  '{Matière}_{Prof}_{Titre}',
] as const;

const FALLBACK_SAMPLE = 'Génétique - Pr. Page - CM 4 - Réplication ADN.pdf';

export const CourseTitleFormatSection: React.FC<CourseTitleFormatSectionProps> = ({
  value,
  onChange,
  sampleFilename,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const outputRef = useRef<HTMLInputElement | null>(null);

  const [testFilename, setTestFilename] = useState<string>(() =>
    sampleFilename?.trim() ? sampleFilename : FALLBACK_SAMPLE
  );
  const [userEditedSample, setUserEditedSample] = useState(false);

  useEffect(() => {
    if (!userEditedSample) {
      if (sampleFilename?.trim()) {
        setTestFilename(sampleFilename);
      } else {
        setTestFilename(FALLBACK_SAMPLE);
      }
    }
  }, [sampleFilename, userEditedSample]);

  const insertTagAtCursor = (
    field: 'inputTemplate' | 'outputTemplate',
    tag: string
  ) => {
    const el = field === 'inputTemplate' ? inputRef.current : outputRef.current;
    const current = value[field];

    if (!el || typeof el.selectionStart !== 'number') {
      const sep = current.trim().length > 0 ? (field === 'inputTemplate' ? ' - ' : ' ') : '';
      onChange({...value, [field]: `${current}${sep}${tag}`});
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd ?? start;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const nextText = `${before}${tag}${after}`;

    onChange({...value, [field]: nextText});

    requestAnimationFrame(() => {
      el.focus();
      const caretPos = start + tag.length;
      el.setSelectionRange(caretPos, caretPos);
    });
  };

  const activeSample =
    testFilename.trim() || sampleFilename?.trim() || FALLBACK_SAMPLE;

  const preview = useMemo(() => {
    const parsed = parseCourseFilename(activeSample, value);
    const safeSubject = sanitizePathSegment(parsed.subject, 'Non classé');
    const safeProf = sanitizePathSegment(
      parsed.professor,
      'Professeur non précisé'
    );
    const ext = getCourseFileFormat(activeSample) ?? 'pdf';
    const safeFile = sanitizeCourseFileName(parsed.targetName, ext);
    return {
      ...parsed,
      safeSubject,
      safeProf,
      targetPath: `${safeSubject}/${safeProf}/${safeFile}`,
    };
  }, [activeSample, value]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-100">
            Format des noms de fichiers pour le tri
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Modèle 100 % éditable utilisé exclusivement par le tri global (sauvegardé dans{' '}
            <span className="font-mono text-slate-300">localStorage</span>).
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_TITLE_FORMAT_SETTINGS)}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Réinitialiser</span>
        </button>
      </div>

      {/* 1. Format éditable pour le tri (entrée) */}
      <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3.5 space-y-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="foliocours-input-template"
              className="block text-xs font-medium text-slate-200"
            >
              Modèle de lecture des noms de fichiers
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESET_EXAMPLES.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onChange({...value, inputTemplate: preset})}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-mono transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    value.inputTemplate === preset
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-slate-800 bg-[#0F172A] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <input
            id="foliocours-input-template"
            ref={inputRef}
            type="text"
            value={value.inputTemplate}
            onChange={(e) => onChange({...value, inputTemplate: e.target.value})}
            placeholder="{Matière} - {Prof} - {Titre}"
            className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-3 py-2 text-xs font-mono text-slate-100 focus:border-amber-500/60 focus:outline-none"
          />
          <p className="text-[11px] text-slate-500">
            Saisissez librement vos séparateurs (ex. <span className="font-mono text-slate-300"> - </span> ou{' '}
            <span className="font-mono text-slate-300">_</span>). La balise{' '}
            <span className="font-mono text-slate-300">{'{Titre}'}</span> capture aussi d’éventuels séparateurs supplémentaires dans le titre.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 mr-1">
            <Tag className="w-3 h-3 text-amber-400" />
            <span>Insérer une balise :</span>
          </span>
          {INPUT_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => insertTagAtCursor('inputTemplate', tag)}
              className="rounded-md border border-slate-700 bg-[#0F172A] px-2.5 py-1 text-[11px] font-mono text-amber-300 hover:border-amber-500/50 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Format d'affichage (sortie) */}
      <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3.5 space-y-3">
        <div className="space-y-1.5">
          <label
            htmlFor="foliocours-output-template"
            className="block text-xs font-medium text-slate-200"
          >
            Format d’affichage du titre (liste & lecteur)
          </label>
          <input
            id="foliocours-output-template"
            ref={outputRef}
            type="text"
            value={value.outputTemplate}
            onChange={(e) => onChange({...value, outputTemplate: e.target.value})}
            placeholder="{Titre}"
            className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-amber-500/60 focus:outline-none"
          />
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

      {/* 3. Testeur en direct */}
      <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Testeur en direct</span>
          </div>
          {sampleFilename && userEditedSample && (
            <button
              type="button"
              onClick={() => setUserEditedSample(false)}
              className="text-[11px] text-amber-300 hover:text-amber-200 underline-offset-4 hover:underline cursor-pointer"
            >
              Tester avec un vrai fichier du dossier
            </button>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="foliocours-format-preview-input"
            className="block text-[11px] text-slate-400"
          >
            {sampleFilename && !userEditedSample
              ? 'Pré-rempli avec un fichier de votre espace de travail (modifiable) :'
              : 'Nom de fichier à tester :'}
          </label>
          <input
            id="foliocours-format-preview-input"
            type="text"
            value={testFilename}
            onChange={(e) => {
              setUserEditedSample(true);
              setTestFilename(e.target.value);
            }}
            className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-amber-500/60 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
          <div className="rounded-md border border-slate-800/90 bg-[#0F172A] px-3 py-2">
            <span className="block text-[11px] text-slate-500">Matière détectée</span>
            <span
              className={`block font-medium truncate mt-0.5 ${
                preview.matchedTemplate ? 'text-amber-300' : 'text-slate-300'
              }`}
              title={preview.safeSubject}
            >
              {preview.safeSubject}
            </span>
          </div>
          <div className="rounded-md border border-slate-800/90 bg-[#0F172A] px-3 py-2">
            <span className="block text-[11px] text-slate-500">Professeur détecté</span>
            <span
              className="block font-medium text-slate-100 truncate mt-0.5"
              title={preview.safeProf}
            >
              {preview.safeProf}
            </span>
          </div>
        </div>

        <div className="rounded-md border border-slate-800/90 bg-[#0F172A] px-3 py-2 text-xs space-y-1">
          <span className="block text-[11px] text-slate-500">Chemin cible</span>
          <span
            className="block font-mono text-emerald-300 truncate"
            title={preview.targetPath}
          >
            {preview.targetPath}
          </span>
          <span className="block text-[11px] text-slate-400 truncate">
            Titre affiché : <strong className="font-medium text-slate-200">{preview.displayTitle}</strong>
          </span>
        </div>
      </div>
    </section>
  );
};
