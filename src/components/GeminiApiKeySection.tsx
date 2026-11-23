import React, {useEffect, useState} from 'react';
import {Check, Eye, EyeOff, Sparkles, Trash2} from 'lucide-react';
import {
  getSavedGeminiApiKey,
  hasEnvFallbackGeminiKey,
  saveGeminiApiKey,
} from '../services/gemini';

interface GeminiApiKeySectionProps {
  compact?: boolean;
}

export const GeminiApiKeySection: React.FC<GeminiApiKeySectionProps> = ({
  compact = false,
}) => {
  const [apiKeyDraft, setApiKeyDraft] = useState(getSavedGeminiApiKey);
  const [showKey, setShowKey] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const hasEnvFallback = hasEnvFallbackGeminiKey();

  useEffect(() => {
    setApiKeyDraft(getSavedGeminiApiKey());
  }, []);

  const handleSave = () => {
    saveGeminiApiKey(apiKeyDraft);
    setSavedNotice(
      apiKeyDraft.trim()
        ? 'Clé API Google Gemini enregistrée localement.'
        : 'Clé API locale effacée.'
    );
    setTimeout(() => setSavedNotice(null), 2600);
  };

  const handleClear = () => {
    setApiKeyDraft('');
    saveGeminiApiKey('');
    setSavedNotice('Clé API locale supprimée.');
    setTimeout(() => setSavedNotice(null), 2600);
  };

  const hasSavedLocal = getSavedGeminiApiKey().trim().length > 0;

  return (
    <section className={compact ? 'space-y-2.5' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <h3 className="font-display text-sm font-semibold text-slate-100 truncate">
            Clé API Google Gemini
          </h3>
        </div>
        <span
          className={`text-xs font-medium shrink-0 ${
            hasSavedLocal
              ? 'text-emerald-400'
              : hasEnvFallback
              ? 'text-sky-400'
              : 'text-slate-400'
          }`}
        >
          {hasSavedLocal
            ? 'Configurée (local)'
            : hasEnvFallback
            ? 'Variable Vercel active'
            : 'Non configurée'}
        </span>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        Requise pour générer les quiz de dossier et expliquer des passages dans le lecteur (modèle{' '}
        <span className="font-mono text-slate-300">gemini-2.5-flash</span>). Stockée uniquement dans ce navigateur.
      </p>

      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKeyDraft}
            onChange={(e) => setApiKeyDraft(e.target.value)}
            placeholder={
              hasEnvFallback
                ? 'Clé d’environnement active (optionnel : remplacer ici)'
                : 'AIzaSy...'
            }
            autoComplete="off"
            spellCheck={false}
            aria-label="Clé API Google Gemini"
            className={`w-full rounded-lg border border-slate-800 bg-[#0B1120] pl-3 pr-9 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:border-amber-500/60 focus:outline-none ${
              compact ? 'min-h-[42px]' : 'py-2'
            }`}
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? 'Masquer la clé API' : 'Afficher la clé API'}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>

        <button
          type="button"
          onClick={handleSave}
          className={`rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-medium text-slate-100 hover:bg-slate-700 cursor-pointer shrink-0 inline-flex items-center gap-1.5 ${
            compact ? 'min-h-[42px]' : 'py-2'
          }`}
        >
          <Check className="w-3.5 h-3.5 text-amber-400" />
          <span>Enregistrer</span>
        </button>

        {apiKeyDraft.trim() && (
          <button
            type="button"
            onClick={handleClear}
            title="Supprimer la clé enregistrée"
            aria-label="Supprimer la clé enregistrée"
            className={`rounded-lg border border-slate-800 bg-[#0B1120] px-2.5 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 cursor-pointer shrink-0 inline-flex items-center justify-center ${
              compact ? 'min-h-[42px]' : 'py-2'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {savedNotice && <p className="text-xs text-emerald-400">{savedNotice}</p>}
    </section>
  );
};
