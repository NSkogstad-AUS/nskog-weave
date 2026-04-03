import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

import { CardNode } from './CardNode';
import { ConnectorLayer } from './ConnectorLayer';
import {
  CARD_TYPE_META,
  clamp,
  getCardBounds,
  getCardDimensions,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../../lib/workspace';
import type {
  Card,
  Link,
  Point,
  ToolMode,
  Viewport,
} from '../../types/workspace';

interface CanvasBoardProps {
  cards: Card[];
  allCards: Card[];
  links: Link[];
  viewport: Viewport;
  toolMode: ToolMode;
  selectedCardIds: string[];
  activeCardId: string | null;
  linkDraftFromId: string | null;
  onCanvasSizeChange: (size: { width: number; height: number }) => void;
  onClearSelection: () => void;
  onCompleteLink: (sourceCardId: string, targetCardId: string) => void;
  onFocusCard: (cardId: string, append?: boolean) => void;
  onCancelLinkDraft: () => void;
  onSetCardPositions: (positions: Record<string, Point>) => void;
  onSetSelection: (cardIds: string[], activeCardId: string | null) => void;
  onSetViewport: (viewport: Viewport) => void;
  onStartLink: (cardId: string) => void;
}

type CanvasInteraction =
  | {
      kind: 'pan';
      origin: Point;
      startViewport: Viewport;
    }
  | {
      kind: 'drag';
      origin: Point;
      basePositions: Record<string, Point>;
      draggedCardIds: string[];
    }
  | {
      kind: 'marquee';
      origin: Point;
      current: Point;
      additive: boolean;
      initialSelection: string[];
    };

function normalizeRectangle(start: Point, end: Point) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

function rectanglesIntersect(
  left: ReturnType<typeof normalizeRectangle>,
  right: ReturnType<typeof normalizeRectangle>,
) {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

export function CanvasBoard({
  cards,
  allCards,
  links,
  viewport,
  toolMode,
  selectedCardIds,
  activeCardId,
  linkDraftFromId,
  onCanvasSizeChange,
  onClearSelection,
  onCompleteLink,
  onFocusCard,
  onCancelLinkDraft,
  onSetCardPositions,
  onSetSelection,
  onSetViewport,
  onStartLink,
}: CanvasBoardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [cardSizes, setCardSizes] = useState<Record<string, { width: number; height: number }>>(
    {},
  );
  const [interaction, setInteraction] = useState<CanvasInteraction | null>(null);
  const [pointerScreen, setPointerScreen] = useState<Point | null>(null);
  const selectedIdSet = new Set(selectedCardIds);
  const visibleIdSet = new Set(cards.map((card) => card.id));

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      onCanvasSizeChange({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [onCanvasSizeChange]);

  useEffect(() => {
    if (!interaction) {
      return;
    }

    const movePointer = (event: PointerEvent) => {
      const localPoint = getLocalPoint(event.clientX, event.clientY);

      if (!localPoint) {
        return;
      }

      setPointerScreen(localPoint);

      if (interaction.kind === 'pan') {
        onSetViewport({
          ...interaction.startViewport,
          x: interaction.startViewport.x + (localPoint.x - interaction.origin.x),
          y: interaction.startViewport.y + (localPoint.y - interaction.origin.y),
        });

        return;
      }

      if (interaction.kind === 'drag') {
        const nextPositions: Record<string, Point> = {};
        const deltaX = (localPoint.x - interaction.origin.x) / viewport.zoom;
        const deltaY = (localPoint.y - interaction.origin.y) / viewport.zoom;

        interaction.draggedCardIds.forEach((cardId) => {
          const basePosition = interaction.basePositions[cardId];

          nextPositions[cardId] = {
            x: basePosition.x + deltaX,
            y: basePosition.y + deltaY,
          };
        });

        onSetCardPositions(nextPositions);
        return;
      }

      const nextInteraction = {
        ...interaction,
        current: localPoint,
      } satisfies CanvasInteraction;
      const marqueeRect = normalizeRectangle(interaction.origin, localPoint);
      const intersectingIds = cards
        .filter((card) => {
          const size = cardSizes[card.id] ?? getCardDimensions(card.type);
          const screenRect = {
            left: card.position.x * viewport.zoom + viewport.x,
            top: card.position.y * viewport.zoom + viewport.y,
            right: card.position.x * viewport.zoom + viewport.x + size.width * viewport.zoom,
            bottom: card.position.y * viewport.zoom + viewport.y + size.height * viewport.zoom,
          };

          return rectanglesIntersect(marqueeRect, screenRect);
        })
        .map((card) => card.id);

      onSetSelection(
        interaction.additive
          ? Array.from(new Set([...interaction.initialSelection, ...intersectingIds]))
          : intersectingIds,
        intersectingIds[intersectingIds.length - 1] ?? null,
      );
      setInteraction(nextInteraction);
    };

    const endPointer = (event: PointerEvent) => {
      const localPoint = getLocalPoint(event.clientX, event.clientY);
      const releasePoint = localPoint ?? interaction.origin;
      const movedEnough =
        Math.hypot(releasePoint.x - interaction.origin.x, releasePoint.y - interaction.origin.y) > 6;

      if (interaction.kind === 'marquee' && !movedEnough && !interaction.additive) {
        onClearSelection();
      }

      setInteraction(null);
    };

    window.addEventListener('pointermove', movePointer);
    window.addEventListener('pointerup', endPointer);

    return () => {
      window.removeEventListener('pointermove', movePointer);
      window.removeEventListener('pointerup', endPointer);
    };
  }, [
    cards,
    cardSizes,
    interaction,
    onClearSelection,
    onSetCardPositions,
    onSetSelection,
    onSetViewport,
    viewport.zoom,
    viewport.x,
    viewport.y,
  ]);

  function getLocalPoint(clientX: number, clientY: number) {
    if (!containerRef.current) {
      return null;
    }

    const rect = containerRef.current.getBoundingClientRect();

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function handleCardMeasure(cardId: string, size: { width: number; height: number }) {
    setCardSizes((current) => {
      const existing = current[cardId];

      if (existing && existing.width === size.width && existing.height === size.height) {
        return current;
      }

      return {
        ...current,
        [cardId]: size,
      };
    });
  }

  function handleBackgroundPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }

    const localPoint = getLocalPoint(event.clientX, event.clientY);

    if (!localPoint) {
      return;
    }

    if (linkDraftFromId) {
      onCancelLinkDraft();
    }

    if (event.button === 1 || toolMode === 'pan' || event.altKey || event.metaKey) {
      event.preventDefault();
      setInteraction({
        kind: 'pan',
        origin: localPoint,
        startViewport: viewport,
      });
      return;
    }

    setPointerScreen(localPoint);
    setInteraction({
      kind: 'marquee',
      origin: localPoint,
      current: localPoint,
      additive: event.shiftKey,
      initialSelection: selectedCardIds,
    });
  }

  function handleCardPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    cardId: string,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const localPoint = getLocalPoint(event.clientX, event.clientY);

    if (!localPoint) {
      return;
    }

    if (linkDraftFromId && linkDraftFromId !== cardId) {
      onCompleteLink(linkDraftFromId, cardId);
      return;
    }

    const clickedCard = allCards.find((card) => card.id === cardId);

    if (!clickedCard) {
      return;
    }

    const baseSelection = event.shiftKey
      ? Array.from(new Set([...selectedCardIds, cardId]))
      : selectedIdSet.has(cardId)
        ? selectedCardIds
        : [cardId];

    onFocusCard(cardId, event.shiftKey);

    const clusterMemberIds =
      clickedCard.type === 'cluster'
        ? allCards.filter((card) => card.clusterId === clickedCard.id).map((card) => card.id)
        : [];
    const draggedCardIds = Array.from(new Set([...baseSelection, ...clusterMemberIds]));
    const basePositions = draggedCardIds.reduce<Record<string, Point>>((positions, id) => {
      const card = allCards.find((candidate) => candidate.id === id);

      if (card) {
        positions[id] = card.position;
      }

      return positions;
    }, {});

    setInteraction({
      kind: 'drag',
      origin: localPoint,
      basePositions,
      draggedCardIds,
    });
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();

    const localPoint = getLocalPoint(event.clientX, event.clientY);

    if (!localPoint) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const nextZoom = clamp(
        viewport.zoom * (event.deltaY > 0 ? 0.92 : 1.08),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const worldX = (localPoint.x - viewport.x) / viewport.zoom;
      const worldY = (localPoint.y - viewport.y) / viewport.zoom;

      onSetViewport({
        zoom: nextZoom,
        x: localPoint.x - worldX * nextZoom,
        y: localPoint.y - worldY * nextZoom,
      });

      return;
    }

    onSetViewport({
      ...viewport,
      x: viewport.x - event.deltaX,
      y: viewport.y - event.deltaY,
    });
  }

  const marqueeRect =
    interaction?.kind === 'marquee'
      ? normalizeRectangle(interaction.origin, interaction.current)
      : null;

  const clusterOverlays = cards
    .filter((card) => card.type === 'cluster')
    .map((clusterCard) => {
      const members = allCards.filter(
        (card) => card.clusterId === clusterCard.id && visibleIdSet.has(card.id),
      );

      if (!members.length) {
        return null;
      }

      const groupCards = [clusterCard, ...members];
      const bounds = groupCards.reduce<{
        left: number;
        top: number;
        right: number;
        bottom: number;
      }>((accumulator, card) => {
        const size = cardSizes[card.id] ?? getCardDimensions(card.type);
        const cardBounds = getCardBounds(card, size);

        return {
          left: Math.min(accumulator.left, cardBounds.left),
          top: Math.min(accumulator.top, cardBounds.top),
          right: Math.max(accumulator.right, cardBounds.right),
          bottom: Math.max(accumulator.bottom, cardBounds.bottom),
        };
      }, {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      });

      const padding = 42;
      const screenLeft = (bounds.left - padding) * viewport.zoom + viewport.x;
      const screenTop = (bounds.top - padding) * viewport.zoom + viewport.y;
      const screenWidth = (bounds.right - bounds.left + padding * 2) * viewport.zoom;
      const screenHeight = (bounds.bottom - bounds.top + padding * 2) * viewport.zoom;
      const meta = CARD_TYPE_META.cluster;

      return (
        <div
          key={`${clusterCard.id}-overlay`}
          className="pointer-events-none absolute rounded-[36px] border border-white/70 shadow-[0_24px_48px_-38px_rgba(15,23,42,0.35)]"
          style={{
            left: screenLeft,
            top: screenTop,
            width: screenWidth,
            height: screenHeight,
            background: `linear-gradient(180deg, ${meta.clusterTint}, rgba(255,255,255,0.34))`,
          }}
        >
          <div className="absolute left-6 top-4 rounded-full bg-white/80 px-3 py-1 text-[11px] font-medium tracking-wide text-slate-600">
            {clusterCard.title} · {members.length} cards
          </div>
        </div>
      );
    });

  const gridSize = 48 * viewport.zoom;

  return (
    <div className="panel-surface relative h-full min-h-[52vh] overflow-hidden rounded-[34px]">
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-4">
        <div className="rounded-full border border-white/80 bg-white/75 px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          {toolMode === 'pan' ? 'Pan mode' : 'Select mode'}
        </div>
        <div className="rounded-full border border-white/80 bg-white/75 px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          Drag cards · Shift + drag to extend selection · Ctrl/Cmd + wheel to zoom
        </div>
      </div>

      {linkDraftFromId ? (
        <div className="absolute left-1/2 top-14 z-20 -translate-x-1/2 rounded-full border border-indigo-200 bg-indigo-50/90 px-4 py-2 text-[11px] font-medium text-indigo-700 shadow-[0_18px_40px_-32px_rgba(79,70,229,0.55)] backdrop-blur-xl">
          Click another card to create a connection.
        </div>
      ) : null}

      <div
        ref={containerRef}
        className={`relative h-full w-full overflow-hidden ${
          toolMode === 'pan' ? 'cursor-grab' : 'cursor-default'
        }`}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={(event) => {
          const localPoint = getLocalPoint(event.clientX, event.clientY);

          if (localPoint) {
            setPointerScreen(localPoint);
          }
        }}
        onWheel={handleWheel}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: 'rgba(248, 250, 252, 0.88)',
            backgroundImage:
              'linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)',
            backgroundPosition: `${viewport.x % gridSize}px ${viewport.y % gridSize}px`,
            backgroundSize: `${gridSize}px ${gridSize}px`,
          }}
        />

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.08),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.08),_transparent_30%)]" />

        {clusterOverlays}

        <ConnectorLayer
          activeCardId={activeCardId}
          cards={cards}
          cardSizes={cardSizes}
          draftFromCardId={linkDraftFromId}
          draftPointer={pointerScreen}
          links={links}
          selectedCardIds={selectedCardIds}
          viewport={viewport}
        />

        {cards.map((card) => (
          <CardNode
            key={card.id}
            card={card}
            isActive={card.id === activeCardId}
            isLinkDraftSource={card.id === linkDraftFromId}
            isSelected={selectedIdSet.has(card.id)}
            onMeasure={handleCardMeasure}
            onPointerDown={handleCardPointerDown}
            onStartLink={onStartLink}
            screenPosition={{
              x: card.position.x * viewport.zoom + viewport.x,
              y: card.position.y * viewport.zoom + viewport.y,
            }}
            zoom={viewport.zoom}
          />
        ))}

        {marqueeRect ? (
          <div
            className="pointer-events-none absolute rounded-[20px] border border-indigo-300 bg-indigo-200/20 shadow-[0_18px_40px_-30px_rgba(79,70,229,0.45)]"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.right - marqueeRect.left,
              height: marqueeRect.bottom - marqueeRect.top,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
