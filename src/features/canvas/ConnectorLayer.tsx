import type { Card, Link, Point, Viewport } from '../../types/workspace';
import { getCardDimensions } from '../../lib/workspace';

interface ConnectorLayerProps {
  cards: Card[];
  links: Link[];
  cardSizes: Record<string, { width: number; height: number }>;
  viewport: Viewport;
  selectedCardIds: string[];
  activeCardId: string | null;
  draftFromCardId: string | null;
  draftPointer: Point | null;
}

function getScaledCardSize(
  card: Card,
  cardSizes: Record<string, { width: number; height: number }>,
  zoom: number,
) {
  const size = cardSizes[card.id] ?? getCardDimensions(card.type);

  return {
    width: size.width * zoom,
    height: size.height * zoom,
  };
}

function getAnchorPoint(
  sourceCard: Card,
  targetCard: Card,
  viewport: Viewport,
  cardSizes: Record<string, { width: number; height: number }>,
) {
  const sourceSize = getScaledCardSize(sourceCard, cardSizes, viewport.zoom);
  const targetSize = getScaledCardSize(targetCard, cardSizes, viewport.zoom);
  const sourceOnLeft = sourceCard.position.x <= targetCard.position.x;

  return {
    source: {
      x:
        sourceCard.position.x * viewport.zoom +
        viewport.x +
        (sourceOnLeft ? sourceSize.width : 0),
      y: sourceCard.position.y * viewport.zoom + viewport.y + sourceSize.height / 2,
    },
    target: {
      x:
        targetCard.position.x * viewport.zoom +
        viewport.x +
        (sourceOnLeft ? 0 : targetSize.width),
      y: targetCard.position.y * viewport.zoom + viewport.y + targetSize.height / 2,
    },
  };
}

function buildCurvePath(source: Point, target: Point) {
  const distance = Math.abs(target.x - source.x);
  const controlOffset = Math.max(60, distance * 0.35);

  return `M ${source.x} ${source.y} C ${source.x + controlOffset} ${source.y}, ${
    target.x - controlOffset
  } ${target.y}, ${target.x} ${target.y}`;
}

export function ConnectorLayer({
  cards,
  links,
  cardSizes,
  viewport,
  selectedCardIds,
  activeCardId,
  draftFromCardId,
  draftPointer,
}: ConnectorLayerProps) {
  const cardMap = new Map(cards.map((card) => [card.id, card] as const));
  const selectedIdSet = new Set(selectedCardIds);

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <linearGradient id="linkGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(148, 163, 184, 0.75)" />
          <stop offset="100%" stopColor="rgba(99, 102, 241, 0.75)" />
        </linearGradient>
      </defs>

      {links.map((link) => {
        const sourceCard = cardMap.get(link.sourceCardId);
        const targetCard = cardMap.get(link.targetCardId);

        if (!sourceCard || !targetCard) {
          return null;
        }

        const points = getAnchorPoint(sourceCard, targetCard, viewport, cardSizes);
        const isHighlighted =
          selectedIdSet.has(sourceCard.id) &&
          selectedIdSet.has(targetCard.id);
        const isActiveLink = sourceCard.id === activeCardId || targetCard.id === activeCardId;

        return (
          <path
            key={link.id}
            d={buildCurvePath(points.source, points.target)}
            fill="none"
            stroke={isHighlighted || isActiveLink ? 'url(#linkGradient)' : 'rgba(148, 163, 184, 0.42)'}
            strokeLinecap="round"
            strokeWidth={isHighlighted || isActiveLink ? 3 : 2.2}
          />
        );
      })}

      {draftFromCardId && draftPointer
        ? (() => {
            const sourceCard = cardMap.get(draftFromCardId);

            if (!sourceCard) {
              return null;
            }

            const sourceSize = getScaledCardSize(sourceCard, cardSizes, viewport.zoom);
            const source = {
              x:
                sourceCard.position.x * viewport.zoom +
                viewport.x +
                sourceSize.width,
              y:
                sourceCard.position.y * viewport.zoom +
                viewport.y +
                sourceSize.height / 2,
            };

            return (
              <path
                d={buildCurvePath(source, draftPointer)}
                fill="none"
                stroke="rgba(99, 102, 241, 0.7)"
                strokeDasharray="7 8"
                strokeLinecap="round"
                strokeWidth={2.4}
              />
            );
          })()
        : null}
    </svg>
  );
}

