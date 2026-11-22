import React, {useState} from 'react';
import {CheckCircle2, Download, X} from 'lucide-react';
import {usePWAInstall} from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  showFallbackHint?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
  showFallbackHint = false,
}) => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    if (showFallbackHint) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 shrink-0">
          <CheckCircle2 className="w-4 h-4" />
          <span>Installée</span>
        </span>
      );
    }
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        title="Installer FolioCours en fenêtre dédiée"
        className={`inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 text-slate-100 hover:bg-slate-800 hover:border-amber-500/50 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          compact ? 'px-3 py-1.5 text-xs font-medium' : 'px-4 py-2 text-sm font-medium'
        }`}
      >
        <Download className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span>Installer</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Installer</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-slate-100">
                  Installer sur iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-slate-300 leading-relaxed">
                <li>1. Appuyez sur le bouton Partager dans la barre Safari.</li>
                <li>2. Faites défiler et sélectionnez « Sur l’écran d’accueil ».</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-amber-500 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 transition-colors"
              >
                Compris
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  if (showFallbackHint) {
    return (
      <span className="text-[11px] text-slate-400 text-right max-w-[200px] leading-snug">
        Ouvrez hors iframe (ou sur <span className="font-mono text-slate-300">localhost:8000</span>) puis utilisez l’icône d’installation dans la barre d’adresse Chrome / Opera.
      </span>
    );
  }

  return null;
};
