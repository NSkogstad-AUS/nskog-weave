import type { ChangeEvent } from 'react';

import { CARD_TYPE_META } from '../../lib/workspace';
import { CARD_TYPES, type CardType, type ToolMode } from '../../types/workspace';

interface LeftToolbarProps {
  toolMode: ToolMode;
  searchQuery: string;
  filteredTypes: CardType[];
  selectedCount: number;
  totalCount: number;
  visibleCount: number;
  canCreateCluster: boolean;
  canGenerateOutput: boolean;
  canLinkSelection: boolean;
  onAddCard: (type: CardType) => void;
  onCreateCluster: () => void;
  onGenerateOutput: () => void;
  onLinkSelection: () => void;
  onResetDemo: () => void;
  onSearchChange: (value: string) => void;
  onToggleType: (type: CardType) => void;
  onToolModeChange: (mode: ToolMode) => void;
}

function actionButtonClassName(disabled = false) {
  return `flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
    disabled
      ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
      : 'border-white/70 bg-white text-slate-700 shadow-[0_22px_42px_-34px_rgba(15,23,42,0.35)] hover:border-slate-200 hover:text-slate-950'
  }`;
}

export function LeftToolbar({
  toolMode,
  searchQuery,
  filteredTypes,
  selectedCount,
  totalCount,
  visibleCount,
  canCreateCluster,
  canGenerateOutput,
  canLinkSelection,
  onAddCard,
  onCreateCluster,
  onGenerateOutput,
  onLinkSelection,
  onResetDemo,
  onSearchChange,
  onToggleType,
  onToolModeChange,
}: LeftToolbarProps) {
  return (
    <div className="panel-surface soft-scrollbar flex h-full min-h-0 flex-col gap-6 overflow-auto rounded-[30px] p-5">
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
              Weave
            </div>
            <div>
              <h1 className="text-[30px] font-semibold tracking-tight text-slate-950">
                Visual thinking workspace
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Organize messy information on a premium canvas, connect signals, and generate structured outputs.
              </p>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/80 bg-white/78 px-4 py-3 text-right shadow-[0_20px_46px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Workspace</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
              {visibleCount}
            </div>
            <div className="text-xs text-slate-500">{totalCount} cards total</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-[24px] border border-white/80 bg-white/75 p-1.5 shadow-[0_20px_46px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          {(['select', 'pan'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`rounded-[18px] px-4 py-2.5 text-sm font-medium transition ${
                toolMode === mode
                  ? 'bg-slate-950 text-white shadow-[0_18px_36px_-28px_rgba(15,23,42,0.6)]'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
              onClick={() => onToolModeChange(mode)}
            >
              {mode === 'select' ? 'Select' : 'Pan'}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          Search
        </label>
        <div className="rounded-[24px] border border-white/80 bg-white/78 p-3 shadow-[0_20px_46px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          <input
            value={searchQuery}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)}
            placeholder="Search titles, notes, tags, content"
            className="w-full border-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Filter Types
          </label>
          <span className="text-xs text-slate-500">{selectedCount} selected</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {CARD_TYPES.map((type) => {
            const meta = CARD_TYPE_META[type];
            const enabled = filteredTypes.includes(type);

            return (
              <button
                key={type}
                type="button"
                className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition ${
                  enabled
                    ? meta.pillClassName
                    : 'border-slate-200 bg-white/60 text-slate-400'
                }`}
                onClick={() => onToggleType(type)}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          Add Cards
        </label>
        <div className="grid grid-cols-2 gap-2">
          {CARD_TYPES.map((type) => {
            const meta = CARD_TYPE_META[type];

            return (
              <button
                key={type}
                type="button"
                className="rounded-[22px] border border-white/75 bg-white/85 px-4 py-3 text-left shadow-[0_20px_46px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl transition hover:border-slate-200"
                onClick={() => onAddCard(type)}
              >
                <div className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${meta.pillClassName}`}>
                  {meta.shortLabel}
                </div>
                <div className="mt-2 text-sm font-medium text-slate-800">{meta.label}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          Selection Actions
        </label>
        <div className="space-y-2">
          <button
            type="button"
            disabled={!canLinkSelection}
            className={actionButtonClassName(!canLinkSelection)}
            onClick={onLinkSelection}
          >
            <span>Link selected cards</span>
            <span className="text-xs text-slate-400">2 cards</span>
          </button>

          <button
            type="button"
            disabled={!canCreateCluster}
            className={actionButtonClassName(!canCreateCluster)}
            onClick={onCreateCluster}
          >
            <span>Create cluster</span>
            <span className="text-xs text-slate-400">Group related items</span>
          </button>

          <button
            type="button"
            disabled={!canGenerateOutput}
            className={actionButtonClassName(!canGenerateOutput)}
            onClick={onGenerateOutput}
          >
            <span>Generate output</span>
            <span className="text-xs text-slate-400">Mock AI brief</span>
          </button>
        </div>
      </section>

      <section className="mt-auto space-y-3">
        <div className="rounded-[24px] border border-white/80 bg-white/78 p-4 shadow-[0_20px_46px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Canvas Tips
          </div>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
            <li>Drag a card to reposition it.</li>
            <li>Shift-drag the canvas to extend a marquee selection.</li>
            <li>Use the Link button on a card, then click a second card.</li>
          </ul>
        </div>

        <button
          type="button"
          className="rounded-[22px] border border-slate-200 bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-[0_24px_48px_-34px_rgba(15,23,42,0.55)] transition hover:bg-slate-800"
          onClick={onResetDemo}
        >
          Reset demo workspace
        </button>
      </section>
    </div>
  );
}

