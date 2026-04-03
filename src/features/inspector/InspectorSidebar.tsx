import { useEffect, useState } from 'react';

import { CARD_TYPE_META } from '../../lib/workspace';
import { CARD_TYPES, type Card, type CardType } from '../../types/workspace';

interface InspectorSidebarProps {
  activeCard: Card | null;
  relatedCards: Card[];
  selectedCount: number;
  onFocusRelatedCard: (cardId: string) => void;
  onGenerateOutput: () => void;
  onGroupSelection: () => void;
  onSetCardType: (cardId: string, type: CardType) => void;
  onSummarizeCard: (cardId: string) => void;
  onUpdateCard: (cardId: string, updates: Partial<Card>) => void;
  onUpdateTags: (cardId: string, rawTags: string) => void;
}

export function InspectorSidebar({
  activeCard,
  relatedCards,
  selectedCount,
  onFocusRelatedCard,
  onGenerateOutput,
  onGroupSelection,
  onSetCardType,
  onSummarizeCard,
  onUpdateCard,
  onUpdateTags,
}: InspectorSidebarProps) {
  const [tagsInput, setTagsInput] = useState('');

  useEffect(() => {
    setTagsInput(activeCard?.tags.join(', ') ?? '');
  }, [activeCard?.id, activeCard?.tags]);

  if (!activeCard) {
    return (
      <div className="panel-surface flex h-full min-h-0 flex-col justify-between rounded-[30px] p-6">
        <div className="space-y-4">
          <div className="inline-flex rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
            Inspector
          </div>
          <div>
            <h2 className="text-[28px] font-semibold tracking-tight text-slate-950">
              Select a card
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Edit titles, content, tags, and card type in the inspector. Selection-based actions stay available once cards are highlighted on the canvas.
            </p>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/80 bg-white/80 p-5 shadow-[0_22px_46px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Current selection
          </div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            {selectedCount}
          </div>
          <div className="mt-1 text-sm text-slate-500">cards selected</div>
        </div>
      </div>
    );
  }

  const meta = CARD_TYPE_META[activeCard.type];

  return (
    <div className="panel-surface soft-scrollbar flex h-full min-h-0 flex-col gap-6 overflow-auto rounded-[30px] p-6">
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide ${meta.pillClassName}`}>
              {meta.label}
            </div>
            <div className="mt-3">
              <h2 className="text-[28px] font-semibold tracking-tight text-slate-950">
                Card inspector
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Selected cards: {selectedCount}. Update the active card here while preserving linked context on the canvas.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/80 bg-white/80 p-5 shadow-[0_22px_46px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Title
          </label>
          <input
            value={activeCard.title}
            onChange={(event) => onUpdateCard(activeCard.id, { title: event.target.value })}
            className="mt-3 w-full border-none bg-transparent text-[24px] font-semibold tracking-tight text-slate-950 outline-none placeholder:text-slate-300"
            placeholder="Card title"
          />

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-600">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                Type
              </span>
              <select
                value={activeCard.type}
                onChange={(event) => onSetCardType(activeCard.id, event.target.value as CardType)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none"
              >
                {CARD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {CARD_TYPE_META[type].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm text-slate-600">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                Source Reference
              </span>
              <input
                value={activeCard.sourceReference}
                onChange={(event) =>
                  onUpdateCard(activeCard.id, { sourceReference: event.target.value })
                }
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none placeholder:text-slate-300"
                placeholder="Source, URL, or provenance"
              />
            </label>
          </div>

          <label className="mt-5 block space-y-2 text-sm text-slate-600">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Tags
            </span>
            <input
              value={tagsInput}
              onChange={(event) => {
                setTagsInput(event.target.value);
                onUpdateTags(activeCard.id, event.target.value);
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none placeholder:text-slate-300"
              placeholder="comma, separated, tags"
            />
          </label>

          <label className="mt-5 block space-y-2 text-sm text-slate-600">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Content
            </span>
            <textarea
              value={activeCard.content}
              onChange={(event) => onUpdateCard(activeCard.id, { content: event.target.value })}
              className="min-h-[220px] w-full rounded-[24px] border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-300"
              placeholder="Write or refine the card content"
            />
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            Preview
          </label>
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            onClick={() => onSummarizeCard(activeCard.id)}
          >
            Summarize
          </button>
        </div>
        <div className="rounded-[24px] border border-white/80 bg-white/80 p-4 text-sm leading-6 text-slate-600 shadow-[0_22px_46px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          {activeCard.previewText}
        </div>
      </section>

      <section className="space-y-3">
        <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          Related Cards
        </label>
        <div className="space-y-2">
          {relatedCards.length ? (
            relatedCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className="flex w-full items-center justify-between rounded-[22px] border border-white/80 bg-white/80 px-4 py-3 text-left shadow-[0_18px_42px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl transition hover:border-slate-200"
                onClick={() => onFocusRelatedCard(card.id)}
              >
                <div>
                  <div className="text-sm font-medium text-slate-800">{card.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{CARD_TYPE_META[card.type].label}</div>
                </div>
                <span className="text-xs text-slate-400">{card.id}</span>
              </button>
            ))
          ) : (
            <div className="rounded-[22px] border border-dashed border-slate-200 bg-white/60 px-4 py-4 text-sm text-slate-500">
              No linked or clustered cards yet.
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <label className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          Actions
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className="rounded-[22px] border border-white/80 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-[0_18px_42px_-36px_rgba(15,23,42,0.35)] transition hover:border-slate-200 hover:text-slate-950"
            onClick={onGroupSelection}
          >
            Group with similar
          </button>
          <button
            type="button"
            className="rounded-[22px] border border-slate-950 bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-[0_18px_42px_-34px_rgba(15,23,42,0.5)] transition hover:bg-slate-800"
            onClick={onGenerateOutput}
          >
            Convert selection into output
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(['source', 'claim', 'note', 'insight'] as const).map((type) => {
            const typeMeta = CARD_TYPE_META[type];

            return (
              <button
                key={type}
                type="button"
                className={`rounded-[20px] border px-3 py-2.5 text-sm font-medium transition ${typeMeta.pillClassName}`}
                onClick={() => onSetCardType(activeCard.id, type)}
              >
                Mark as {typeMeta.label}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

