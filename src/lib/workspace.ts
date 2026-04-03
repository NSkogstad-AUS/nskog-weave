import type { Card, CardType, Link, Point, Viewport } from '../types/workspace';

export const STORAGE_KEY = 'weave.workspace.v1';
export const MIN_ZOOM = 0.55;
export const MAX_ZOOM = 1.7;
export const DEFAULT_VIEWPORT: Viewport = { x: 220, y: 120, zoom: 0.94 };

export const CARD_DIMENSIONS: Record<CardType, { width: number; height: number }> = {
  source: { width: 312, height: 220 },
  note: { width: 292, height: 198 },
  claim: { width: 304, height: 212 },
  insight: { width: 324, height: 216 },
  cluster: { width: 300, height: 188 },
  output: { width: 344, height: 252 },
};

export const CARD_TYPE_META: Record<
  CardType,
  {
    label: string;
    shortLabel: string;
    pillClassName: string;
    accentClassName: string;
    iconClassName: string;
    clusterTint: string;
  }
> = {
  source: {
    label: 'Source',
    shortLabel: 'SR',
    pillClassName: 'border-slate-200 bg-slate-100 text-slate-700',
    accentClassName: 'from-slate-500/90 via-slate-400/60 to-slate-200/20',
    iconClassName: 'bg-slate-600 text-white',
    clusterTint: 'rgba(100, 116, 139, 0.08)',
  },
  note: {
    label: 'Note',
    shortLabel: 'NT',
    pillClassName: 'border-sky-200 bg-sky-100 text-sky-700',
    accentClassName: 'from-sky-500/85 via-cyan-300/55 to-transparent',
    iconClassName: 'bg-sky-600 text-white',
    clusterTint: 'rgba(14, 165, 233, 0.08)',
  },
  claim: {
    label: 'Claim',
    shortLabel: 'CL',
    pillClassName: 'border-amber-200 bg-amber-100 text-amber-700',
    accentClassName: 'from-amber-500/85 via-orange-300/50 to-transparent',
    iconClassName: 'bg-amber-500 text-white',
    clusterTint: 'rgba(245, 158, 11, 0.08)',
  },
  insight: {
    label: 'Insight',
    shortLabel: 'IN',
    pillClassName: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    accentClassName: 'from-emerald-500/85 via-teal-300/50 to-transparent',
    iconClassName: 'bg-emerald-600 text-white',
    clusterTint: 'rgba(16, 185, 129, 0.08)',
  },
  cluster: {
    label: 'Cluster',
    shortLabel: 'GR',
    pillClassName: 'border-rose-200 bg-rose-100 text-rose-700',
    accentClassName: 'from-rose-500/85 via-fuchsia-300/50 to-transparent',
    iconClassName: 'bg-rose-600 text-white',
    clusterTint: 'rgba(244, 114, 182, 0.08)',
  },
  output: {
    label: 'Output',
    shortLabel: 'OP',
    pillClassName: 'border-violet-200 bg-violet-100 text-violet-700',
    accentClassName: 'from-violet-500/85 via-indigo-300/50 to-transparent',
    iconClassName: 'bg-violet-600 text-white',
    clusterTint: 'rgba(139, 92, 246, 0.09)',
  },
};

const CARD_TEMPLATES: Record<
  CardType,
  { title: string; content: string; tags: string[]; sourceReference: string }
> = {
  source: {
    title: 'New source',
    content:
      'Capture a source excerpt, citation, or imported material here. Keep enough detail for future summarization.',
    tags: ['source'],
    sourceReference: 'Research source',
  },
  note: {
    title: 'Working note',
    content:
      'Add a concise note, decision fragment, or observation. Use short paragraphs so cards stay easy to scan.',
    tags: ['note'],
    sourceReference: '',
  },
  claim: {
    title: 'Working claim',
    content:
      'State a claim clearly, then support it with evidence and links to related cards on the canvas.',
    tags: ['claim'],
    sourceReference: '',
  },
  insight: {
    title: 'Emerging insight',
    content:
      'Summarize the pattern that matters. Insights should synthesize multiple cards into one reusable takeaway.',
    tags: ['insight'],
    sourceReference: '',
  },
  cluster: {
    title: 'New cluster',
    content:
      'Use clusters to hold related ideas together. This card can become the visible anchor for a working theme.',
    tags: ['cluster'],
    sourceReference: '',
  },
  output: {
    title: 'New output',
    content:
      'Generate a structured memo, summary, outline, or brief from a selected group of cards.',
    tags: ['output'],
    sourceReference: 'Generated from selected cards',
  },
};

export function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID().split('-')[0]}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function excerptText(text: string, maxLength = 140) {
  const compact = text.replace(/\s+/g, ' ').trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

export function sanitizeTags(tags: string[]) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function parseTags(raw: string) {
  return sanitizeTags(raw.split(','));
}

export function getCardDimensions(type: CardType) {
  return CARD_DIMENSIONS[type];
}

export function getCardBounds(card: Card, size = CARD_DIMENSIONS[card.type]) {
  return {
    left: card.position.x,
    top: card.position.y,
    right: card.position.x + size.width,
    bottom: card.position.y + size.height,
    width: size.width,
    height: size.height,
  };
}

export function normalizeCards(cards: Card[]) {
  const ids = new Set(cards.map((card) => card.id));
  const clusterIds = new Set(
    cards.filter((card) => card.type === 'cluster').map((card) => card.id),
  );
  const linkMap = new Map<string, Set<string>>();

  cards.forEach((card) => {
    linkMap.set(card.id, new Set());
  });

  cards.forEach((card) => {
    card.linkedCardIds.forEach((linkedCardId) => {
      if (linkedCardId === card.id || !ids.has(linkedCardId)) {
        return;
      }

      linkMap.get(card.id)?.add(linkedCardId);
      linkMap.get(linkedCardId)?.add(card.id);
    });
  });

  return cards.map((card) => ({
    ...card,
    tags: sanitizeTags(card.tags),
    previewText: card.previewText || excerptText(card.content),
    linkedCardIds: Array.from(linkMap.get(card.id) ?? []),
    clusterId:
      card.clusterId && clusterIds.has(card.clusterId) && card.clusterId !== card.id
        ? card.clusterId
        : null,
  }));
}

export function buildLinks(cards: Card[]): Link[] {
  const links = new Map<string, Link>();

  cards.forEach((card) => {
    card.linkedCardIds.forEach((linkedCardId) => {
      const pair = [card.id, linkedCardId].sort();
      const key = pair.join('--');

      if (!links.has(key)) {
        links.set(key, {
          id: `link-${key}`,
          sourceCardId: pair[0],
          targetCardId: pair[1],
        });
      }
    });
  });

  return Array.from(links.values());
}

export function matchesCardFilters(card: Card, searchQuery: string, filteredTypes: CardType[]) {
  if (!filteredTypes.includes(card.type)) {
    return false;
  }

  if (!searchQuery.trim()) {
    return true;
  }

  const haystack = [
    card.title,
    card.previewText,
    card.content,
    card.sourceReference,
    card.tags.join(' '),
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(searchQuery.trim().toLowerCase());
}

export function createCard(
  type: CardType,
  position: Point,
  overrides: Partial<Card> = {},
): Card {
  const template = CARD_TEMPLATES[type];
  const content = overrides.content ?? template.content;

  return {
    id: overrides.id ?? createId(type),
    title: overrides.title ?? template.title,
    type,
    previewText: overrides.previewText ?? excerptText(content),
    content,
    tags: overrides.tags ?? template.tags,
    sourceReference: overrides.sourceReference ?? template.sourceReference,
    position,
    linkedCardIds: overrides.linkedCardIds ?? [],
    clusterId: overrides.clusterId ?? null,
  };
}

export function bringCardsToFront(cards: Card[], ids: string[]) {
  const idSet = new Set(ids);
  const remaining = cards.filter((card) => !idSet.has(card.id));
  const front = cards.filter((card) => idSet.has(card.id));

  return [...remaining, ...front];
}

export function connectCards(cards: Card[], sourceCardId: string, targetCardId: string) {
  if (sourceCardId === targetCardId) {
    return cards;
  }

  return normalizeCards(
    cards.map((card) => {
      if (card.id !== sourceCardId && card.id !== targetCardId) {
        return card;
      }

      return {
        ...card,
        linkedCardIds: Array.from(
          new Set([
            ...card.linkedCardIds,
            card.id === sourceCardId ? targetCardId : sourceCardId,
          ]),
        ),
      };
    }),
  );
}

export function updateCardPositions(
  cards: Card[],
  nextPositions: Record<string, Point>,
) {
  return cards.map((card) =>
    nextPositions[card.id]
      ? { ...card, position: nextPositions[card.id] }
      : card,
  );
}

export function getCardsByIds(cards: Card[], ids: string[]) {
  const idSet = new Set(ids);
  return cards.filter((card) => idSet.has(card.id));
}

export function getSelectionBounds(cards: Card[], ids: string[]) {
  const selectedCards = getCardsByIds(cards, ids);

  if (!selectedCards.length) {
    return null;
  }

  return selectedCards.reduce<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  }>((accumulator, card) => {
    const bounds = getCardBounds(card);

    return {
      left: Math.min(accumulator.left, bounds.left),
      top: Math.min(accumulator.top, bounds.top),
      right: Math.max(accumulator.right, bounds.right),
      bottom: Math.max(accumulator.bottom, bounds.bottom),
    };
  }, {
    left: Number.POSITIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  });
}

export function getSuggestedPosition(
  cards: Card[],
  ids: string[],
  type: CardType,
  fallback = { x: 220, y: 180 },
) {
  const bounds = getSelectionBounds(cards, ids);

  if (!bounds) {
    return fallback;
  }

  if (type === 'cluster') {
    return { x: bounds.left - 28, y: bounds.top - 110 };
  }

  if (type === 'output') {
    return { x: bounds.right + 72, y: bounds.top + 16 };
  }

  return {
    x: bounds.left + 48,
    y: bounds.top + 48,
  };
}

export function getCanvasCenterPosition(
  viewport: Viewport,
  canvasSize: { width: number; height: number },
  type: CardType,
) {
  const size = CARD_DIMENSIONS[type];

  return {
    x: (canvasSize.width / 2 - viewport.x) / viewport.zoom - size.width / 2,
    y: (canvasSize.height / 2 - viewport.y) / viewport.zoom - size.height / 2,
  };
}

export function formatCardType(type: CardType) {
  return CARD_TYPE_META[type].label;
}
