import React, {useEffect, useMemo, useRef, useState} from 'react';
import {RotateCcw, Sparkles, Tag} from 'lucide-react';
import type {SortRule, TitleFormatSettings} from '../types/course';
import {
  DEFAULT_TITLE_FORMAT_SETTINGS,
  formatCourseDisplayTitle,
  normalizeTitleFormatSettings,
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
  rules?: SortRule[];
  displayOnly?: boolean;
}

const INPUT_TAGS = ['{Matière}', '{Prof}', '{Type}', '{Numéro}', '{Titre}', '{Ignorer}'] as const;
const OUTPUT_TAGS = [
  '{Titre}',
  '{Matière}',
  '{Prof}',
  '{Type}',
  '{Numéro}',
  '{NomOriginal}',
] as const;

const PRESET_EXAMPLES = [
  '{Matière} - {Prof} - {Titre}',
  '{Matière}_{Prof}_{Titre}',
] as const;

const FALLBACK_SAMPLE = 'Génétique - Pr. Page - CM_4_Réplication_ADN.pdf';

export const CourseTitleFormatSection: React.FC<CourseTitleFormatSectionProps> = ({
  value,
  onChange,
  sampleFilename,
  rules,
  displayOnly = false,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const outputRef = useRef<HTMLInputElement | null>(null);

  const normalizedValue = useMemo(
    () => normalizeTitleFormatSettings(value),
    [value]
  );

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
    const current = normalizedValue[field];

    if (!el || typeof el.selectionStart !== 'number') {
      const sep =
        current.trim().length > 0 ? (field === 'inputTemplate' ? ' - ' : ' ') : '';
      onChange({...normalizedValue, [field]: `${current}${sep}${tag}`});
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd ?? start;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const nextText = `${before}${tag}${after}`;

    onChange({...normalizedValue, [field]: nextText});

    requestAnimationFrame(() => {
      el.focus();
      const caretPos = start + tag.length;
      el.setSelectionRange(caretPos, caretPos);
    });
  };

  const activeSample =
    testFilename.trim() || sampleFilename?.trim() || FALLBACK_SAMPLE;

  const preview = useMemo(() => {
    const parsed = parseCourseFilename(activeSample, normalizedValue, undefined, rules);
    const renderedDisplay = formatCourseDisplayTitle(activeSample, normalizedValue, {
      rules,
    });
    const safeSubject = sanitizePathSegment(parsed.subject, 'Non classé');
    const safeProf = sanitizePathSegment(
      parsed.professor,
      'Professeur non précisé'
    );
    const ext = getCourseFileFormat(activeSample) ?? 'pdf';
    const safeFile = sanitizeCourseFileName(parsed.targetName, ext);
    return {
      ...parsed,
      renderedDisplay,
      safeSubject,
      safeProf,
      targetPath: `${safeSubject}/${safeProf}/${safeFile}`,
    };
  }, [activeSample, normalizedValue, rules]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-100">
            {displayOnly
              ? 'Format d’affichage des cours'
              : 'Format des noms & affichage des cours'}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Sauvegardé dans{' '}
            <span className="font-mono text-slate-300">localStorage</span> et synchronisé avec Google Drive.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange({...DEFAULT_TITLE_FORMAT_SETTINGS})}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Réinitialiser</span>
        </button>
      </div>

      {/* 1. Format éditable pour le tri (entrée - PC uniquement) */}
      {!displayOnly && (
        <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3.5 space-y-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="foliocours-input-template"
                className="block text-xs font-medium text-slate-200"
              >
                Modèle de lecture des noms de fichiers (tri)
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {PRESET_EXAMPLES.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() =>
                      onChange({...normalizedValue, inputTemplate: preset})
                    }
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-mono transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      normalizedValue.inputTemplate === preset
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
              value={normalizedValue.inputTemplate}
              onChange={(e) =>
                onChange({...normalizedValue, inputTemplate: e.target.value})
              }
              placeholder="{Matière} - {Prof} - {Titre}"
              className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-3 py-2 text-xs font-mono text-slate-100 focus:border-amber-500/60 focus:outline-none"
            />
            <p className="text-[11px] text-slate-500">
              Saisissez librement vos séparateurs (ex.{' '}
              <span className="font-mono text-slate-300"> - </span> ou{' '}
              <span className="font-mono text-slate-300">_</span>). La balise{' '}
              <span className="font-mono text-slate-300">{'{Titre}'}</span> capture aussi d’éventuels séparateurs supplémentaires.
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
      )}

      {/* 2. Format d'affichage des cours (PC et Mobile) */}
      <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3.5 space-y-3">
        <div className="space-y-1.5">
          <label
            htmlFor={
              displayOnly
                ? 'foliocours-output-template-mobile'
                : 'foliocours-output-template'
            }
            className="block text-xs font-medium text-slate-200"
          >
            Format d’affichage des cours (PC & Mobile)
          </label>
          <input
            id={
              displayOnly
                ? 'foliocours-output-template-mobile'
                : 'foliocours-output-template'
            }
            ref={outputRef}
            type="text"
            value={normalizedValue.outputTemplate}
            onChange={(e) =>
              onChange({...normalizedValue, outputTemplate: e.target.value})
            }
            placeholder="{Titre}"
            className="w-full min-h-[38px] rounded-md border border-slate-800 bg-[#0F172A] px-3 py-1.5 text-xs font-mono text-slate-100 focus:border-amber-500/60 focus:outline-none"
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
              className="rounded-md border border-slate-700 bg-[#0F172A] px-2.5 py-1 text-[11px] font-mono text-amber-300 hover:border-amber-500/50 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Options de mise en forme rapide */}
        <div className="pt-2 border-t border-slate-800/80 space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={normalizedValue.replaceUnderscoresWithSpaces !== false}
              onChange={(e) =>
                onChange({
                  ...normalizedValue,
                  replaceUnderscoresWithSpaces: e.target.checked,
                })
              }
              className="mt-0.5 h-4 w-4 accent-amber-500 cursor-pointer shrink-0"
            />
            <span className="text-xs text-slate-200 leading-snug">
              Remplacer les tirets bas (<span className="font-mono text-slate-300">_</span>) par des espaces
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={normalizedValue.hideExtension !== false}
              onChange={(e) =>
                onChange({
                  ...normalizedValue,
                  hideExtension: e.target.checked,
                })
              }
              className="mt-0.5 h-4 w-4 accent-amber-500 cursor-pointer shrink-0"
            />
            <span className="text-xs text-slate-200 leading-snug">
              Masquer l’extension du fichier (<span className="font-mono text-slate-300">.pdf</span>,{' '}
              <span className="font-mono text-slate-300">.docx</span>,{' '}
              <span className="font-mono text-slate-300">.odt</span>)
            </span>
          </label>

          {!displayOnly && (
            <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={normalizedValue.renameOnDisk}
                onChange={(e) =>
                  onChange({
                    ...normalizedValue,
                    renameOnDisk: e.target.checked,
                  })
                }
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
          )}
        </div>
      </div>

      {/* 3. Aperçu en temps réel */}
      <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Aperçu en temps réel</span>
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
            htmlFor={
              displayOnly
                ? 'foliocours-format-preview-input-mobile'
                : 'foliocours-format-preview-input'
            }
            className="block text-[11px] text-slate-400"
          >
            {sampleFilename && !userEditedSample
              ? 'Exemple avec un nom de fichier brut réel (modifiable) :'
              : 'Nom de fichier brut :'}
          </label>
          <input
            id={
              displayOnly
                ? 'foliocours-format-preview-input-mobile'
                : 'foliocours-format-preview-input'
            }
            type="text"
            value={testFilename}
            onChange={(e) => {
              setUserEditedSample(true);
              setTestFilename(e.target.value);
            }}
            className="w-full rounded-md border border-slate-800 bg-[#0F172A] px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-amber-500/60 focus:outline-none"
          />
        </div>

        <div className="rounded-md border border-slate-800/90 bg-[#0F172A] px-3 py-2.5 text-xs space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-slate-500 shrink-0">Fichier brut :</span>
            <span className="font-mono text-[11px] text-slate-400 truncate" title={activeSample}>
              {activeSample}
            </span>
          </div>
          <div className="pt-1 border-t border-slate-800/70">
            <span className="block text-[11px] text-slate-400">
              Affichage dans la liste (PC & Mobile) :
            </span>
            <span
              className="block text-sm font-semibold text-amber-300 truncate mt-0.5"
              title={preview.renderedDisplay}
            >
              {preview.renderedDisplay}
            </span>
          </div>
          {!displayOnly && (
            <div className="pt-1.5 border-t border-slate-800/70 space-y-1">
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-400">
                <span>
                  Matière : <strong className="font-medium text-slate-200">{preview.safeSubject}</strong>
                </span>
                <span>
                  Prof : <strong className="font-medium text-slate-200">{preview.safeProf}</strong>
                </span>
              </div>
              <span
                className="block font-mono text-[11px] text-emerald-300 truncate"
                title={preview.targetPath}
              >
                Tri → {preview.targetPath}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
