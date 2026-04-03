import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { CARD_TYPE_META, getCardDimensions } from '../../lib/workspace';
import type { Card, Point } from '../../types/workspace';

interface CardNodeProps {
  card: Card;
  screenPosition: Point;
  zoom: number;
  isSelected: boolean;
  isActive: boolean;
  isLinkDraftSource: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, cardId: string) => void;
  onStartLink: (cardId: string) => void;
  onMeasure: (cardId: string, size: { width: number; height: number }) => void;
}

export function CardNode({
  card,
  screenPosition,
  zoom,
  isSelected,
  isActive,
  isLinkDraftSource,
  onPointerDown,
  onStartLink,
  onMeasure,
}: CardNodeProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const meta = CARD_TYPE_META[card.type];
  const defaultSize = getCardDimensions(card.type);

  useEffect(() => {
    if (!cardRef.current) {
      return;
    }

    const element = cardRef.current;
    const report = () => {
      onMeasure(card.id, {
        width: element.offsetWidth || defaultSize.width,
        height: element.offsetHeight || defaultSize.height,
      });
    };

    report();

    const observer = new ResizeObserver(() => {
      report();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [card.id, card.content, card.previewText, card.tags, defaultSize.height, defaultSize.width, onMeasure]);

  return (
    <div
      className="absolute origin-top-left"
      style={{
        transform: `translate(${screenPosition.x}px, ${screenPosition.y}px) scale(${zoom})`,
        width: `${defaultSize.width}px`,
        zIndex: isActive ? 60 : isSelected ? 50 : 20,
      }}
      onPointerDown={(event) => onPointerDown(event, card.id)}
    >
      <div
        ref={cardRef}
        className={`group overflow-hidden rounded-[30px] border bg-white/88 backdrop-blur-xl transition duration-200 ${
          isActive
            ? 'border-indigo-300 shadow-[0_28px_60px_-34px_rgba(99,102,241,0.55)]'
            : isSelected
              ? 'border-sky-200 shadow-[0_24px_48px_-32px_rgba(14,165,233,0.45)]'
              : 'border-white/70 shadow-[0_24px_50px_-34px_rgba(15,23,42,0.35)]'
        }`}
      >
        <div className={`h-24 bg-gradient-to-br ${meta.accentClassName}`} />

        <div className="-mt-14 px-5 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-2xl text-[11px] font-semibold tracking-[0.24em] ${meta.iconClassName}`}
              >
                {meta.shortLabel}
              </div>

              <div className="space-y-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide ${meta.pillClassName}`}
                >
                  {meta.label}
                </span>
                {card.clusterId ? (
                  <div className="text-[11px] font-medium text-slate-500">
                    Clustered
                  </div>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              className={`mt-1 inline-flex items-center rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                isLinkDraftSource
                  ? 'border-indigo-300 bg-indigo-100 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
              onClick={(event) => {
                event.stopPropagation();
                onStartLink(card.id);
              }}
            >
              {isLinkDraftSource ? 'Linking' : 'Link'}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <h3 className="text-[17px] font-semibold tracking-tight text-slate-950">
                {card.title}
              </h3>
              <p className="mt-3 line-clamp-4 text-[13.5px] leading-6 text-slate-600">
                {card.previewText}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {card.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
              <span className="truncate">
                {card.sourceReference || 'Internal workspace note'}
              </span>
              <span>{card.linkedCardIds.length} links</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

