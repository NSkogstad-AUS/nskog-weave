export const CARD_TYPES = [
  'source',
  'note',
  'claim',
  'insight',
  'cluster',
  'output',
] as const;

export type CardType = (typeof CARD_TYPES)[number];
export type ToolMode = 'select' | 'pan';

export interface Point {
  x: number;
  y: number;
}

export interface Card {
  id: string;
  title: string;
  type: CardType;
  previewText: string;
  content: string;
  tags: string[];
  sourceReference: string;
  position: Point;
  linkedCardIds: string[];
  clusterId: string | null;
}

export interface Link {
  id: string;
  sourceCardId: string;
  targetCardId: string;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkspaceState {
  cards: Card[];
  viewport: Viewport;
  selectedCardIds: string[];
  activeCardId: string | null;
  searchQuery: string;
  filteredTypes: CardType[];
  toolMode: ToolMode;
  linkDraftFromId: string | null;
}

