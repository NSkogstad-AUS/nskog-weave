import { useEffect, useState } from 'react';

import { createDemoWorkspace } from '../data/demoWorkspace';
import {
  bringCardsToFront,
  clamp,
  connectCards,
  createCard,
  excerptText,
  getCardsByIds,
  getSuggestedPosition,
  normalizeCards,
  parseTags,
  STORAGE_KEY,
  updateCardPositions,
  DEFAULT_VIEWPORT,
} from '../lib/workspace';
import {
  buildClusterDraft,
  findSimilarCardIds,
  generateStructuredOutput,
  summarizeCardPreview,
} from '../services/mockAi';
import type { Card, CardType, Point, ToolMode, WorkspaceState } from '../types/workspace';

function hydrateWorkspaceState(): WorkspaceState {
  if (typeof window === 'undefined') {
    return createDemoWorkspace();
  }

  const fallback = createDemoWorkspace();

  try {
    const rawWorkspace = window.localStorage.getItem(STORAGE_KEY);

    if (!rawWorkspace) {
      return fallback;
    }

    const parsedWorkspace = JSON.parse(rawWorkspace) as Partial<WorkspaceState>;
    const cards = normalizeCards(parsedWorkspace.cards ?? fallback.cards);
    const cardIds = new Set(cards.map((card) => card.id));
    const filteredTypes =
      parsedWorkspace.filteredTypes?.length
        ? parsedWorkspace.filteredTypes.filter((type): type is CardType =>
            fallback.filteredTypes.includes(type),
          )
        : fallback.filteredTypes;
    const selectedCardIds = (parsedWorkspace.selectedCardIds ?? []).filter((id) =>
      cardIds.has(id),
    );
    const activeCardId =
      parsedWorkspace.activeCardId && cardIds.has(parsedWorkspace.activeCardId)
        ? parsedWorkspace.activeCardId
        : selectedCardIds[0] ?? null;

    return {
      cards,
      viewport: {
        x: Number.isFinite(parsedWorkspace.viewport?.x)
          ? parsedWorkspace.viewport?.x ?? DEFAULT_VIEWPORT.x
          : DEFAULT_VIEWPORT.x,
        y: Number.isFinite(parsedWorkspace.viewport?.y)
          ? parsedWorkspace.viewport?.y ?? DEFAULT_VIEWPORT.y
          : DEFAULT_VIEWPORT.y,
        zoom: clamp(
          Number.isFinite(parsedWorkspace.viewport?.zoom)
            ? parsedWorkspace.viewport?.zoom ?? DEFAULT_VIEWPORT.zoom
            : DEFAULT_VIEWPORT.zoom,
          0.55,
          1.7,
        ),
      },
      selectedCardIds,
      activeCardId,
      searchQuery: parsedWorkspace.searchQuery ?? '',
      filteredTypes,
      toolMode: parsedWorkspace.toolMode === 'pan' ? 'pan' : 'select',
      linkDraftFromId:
        parsedWorkspace.linkDraftFromId && cardIds.has(parsedWorkspace.linkDraftFromId)
          ? parsedWorkspace.linkDraftFromId
          : null,
    };
  } catch {
    return fallback;
  }
}

function buildClusterCard(cards: Card[], selectedCards: Card[]) {
  const clusterDraft = buildClusterDraft(selectedCards);
  const position = getSuggestedPosition(cards, selectedCards.map((card) => card.id), 'cluster');

  return createCard('cluster', position, {
    title: clusterDraft.title,
    content: clusterDraft.content,
    previewText: excerptText(clusterDraft.content),
    tags: clusterDraft.tags,
    sourceReference: '',
  });
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(hydrateWorkspaceState);

  useEffect(() => {
    const persistedState: WorkspaceState = {
      ...workspace,
      linkDraftFromId: null,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
  }, [workspace]);

  function updateWorkspace(recipe: (current: WorkspaceState) => WorkspaceState) {
    setWorkspace((current) => recipe(current));
  }

  function setSearchQuery(searchQuery: string) {
    updateWorkspace((current) => ({
      ...current,
      searchQuery,
    }));
  }

  function setToolMode(toolMode: ToolMode) {
    updateWorkspace((current) => ({
      ...current,
      toolMode,
    }));
  }

  function toggleFilteredType(type: CardType) {
    updateWorkspace((current) => {
      const filteredTypes = current.filteredTypes.includes(type)
        ? current.filteredTypes.filter((candidate) => candidate !== type)
        : [...current.filteredTypes, type];

      return {
        ...current,
        filteredTypes,
      };
    });
  }

  function setViewport(viewport: WorkspaceState['viewport']) {
    updateWorkspace((current) => ({
      ...current,
      viewport,
    }));
  }

  function clearSelection() {
    updateWorkspace((current) => ({
      ...current,
      selectedCardIds: [],
      activeCardId: null,
    }));
  }

  function setSelection(selectedCardIds: string[], activeCardId: string | null = null) {
    updateWorkspace((current) => ({
      ...current,
      selectedCardIds,
      activeCardId,
    }));
  }

  function focusCard(cardId: string, append = false) {
    updateWorkspace((current) => {
      const selectedCardIds = append
        ? Array.from(new Set([...current.selectedCardIds, cardId]))
        : [cardId];

      return {
        ...current,
        cards: bringCardsToFront(current.cards, [cardId]),
        selectedCardIds,
        activeCardId: cardId,
      };
    });
  }

  function addCard(type: CardType, position: Point) {
    updateWorkspace((current) => {
      const nextCard = createCard(type, position);

      return {
        ...current,
        cards: [...current.cards, nextCard],
        selectedCardIds: [nextCard.id],
        activeCardId: nextCard.id,
      };
    });
  }

  function updateCard(cardId: string, updates: Partial<Card>) {
    updateWorkspace((current) => ({
      ...current,
      cards: normalizeCards(
        current.cards.map((card) => {
          if (card.id !== cardId) {
            return card;
          }

          const content = updates.content ?? card.content;
          const tags = updates.tags ? [...updates.tags] : card.tags;

          return {
            ...card,
            ...updates,
            tags,
            previewText: updates.previewText ?? (updates.content !== undefined ? excerptText(content) : card.previewText),
          };
        }),
      ),
    }));
  }

  function updateCardTags(cardId: string, rawTags: string) {
    updateCard(cardId, { tags: parseTags(rawTags) });
  }

  function setCardType(cardId: string, type: CardType) {
    updateCard(cardId, { type });
  }

  function setCardPositions(nextPositions: Record<string, Point>) {
    updateWorkspace((current) => ({
      ...current,
      cards: updateCardPositions(current.cards, nextPositions),
    }));
  }

  function startLinkDraft(cardId: string) {
    updateWorkspace((current) => ({
      ...current,
      linkDraftFromId: current.linkDraftFromId === cardId ? null : cardId,
      activeCardId: cardId,
      selectedCardIds: Array.from(new Set([...current.selectedCardIds, cardId])),
    }));
  }

  function cancelLinkDraft() {
    updateWorkspace((current) => ({
      ...current,
      linkDraftFromId: null,
    }));
  }

  function completeLink(sourceCardId: string, targetCardId: string) {
    updateWorkspace((current) => ({
      ...current,
      cards: connectCards(current.cards, sourceCardId, targetCardId),
      linkDraftFromId: null,
      selectedCardIds: [targetCardId],
      activeCardId: targetCardId,
    }));
  }

  function linkSelectedCards() {
    updateWorkspace((current) => {
      if (current.selectedCardIds.length !== 2) {
        return current;
      }

      const [sourceCardId, targetCardId] = current.selectedCardIds;

      return {
        ...current,
        cards: connectCards(current.cards, sourceCardId, targetCardId),
      };
    });
  }

  function createClusterFromSelection(ids = workspace.selectedCardIds) {
    updateWorkspace((current) => {
      const selectedIds = ids.filter(Boolean);
      const selectedCards = getCardsByIds(current.cards, selectedIds).filter(
        (card) => card.type !== 'cluster' && card.type !== 'output',
      );

      if (selectedCards.length < 2) {
        return current;
      }

      const clusterCard = buildClusterCard(current.cards, selectedCards);
      const selectedIdSet = new Set(selectedCards.map((card) => card.id));
      const nextCards = normalizeCards(
        current.cards
          .map((card) => {
            if (!selectedIdSet.has(card.id)) {
              return card;
            }

            return {
              ...card,
              clusterId: clusterCard.id,
              linkedCardIds: Array.from(new Set([...card.linkedCardIds, clusterCard.id])),
            };
          })
          .concat({
            ...clusterCard,
            linkedCardIds: selectedCards.map((card) => card.id),
          }),
      );

      return {
        ...current,
        cards: nextCards,
        selectedCardIds: [clusterCard.id],
        activeCardId: clusterCard.id,
      };
    });
  }

  function groupWithSimilar(cardId: string | null) {
    if (!cardId) {
      return;
    }

    updateWorkspace((current) => {
      const activeCard = current.cards.find((card) => card.id === cardId);

      if (!activeCard) {
        return current;
      }

      const similarIds = findSimilarCardIds(activeCard, current.cards);
      const selectedIds = [activeCard.id, ...similarIds].slice(0, 4);
      const selectedCards = getCardsByIds(current.cards, selectedIds).filter(
        (card) => card.type !== 'cluster' && card.type !== 'output',
      );

      if (selectedCards.length < 2) {
        return current;
      }

      const clusterCard = buildClusterCard(current.cards, selectedCards);
      const selectedIdSet = new Set(selectedCards.map((card) => card.id));
      const nextCards = normalizeCards(
        current.cards
          .map((card) => {
            if (!selectedIdSet.has(card.id)) {
              return card;
            }

            return {
              ...card,
              clusterId: clusterCard.id,
              linkedCardIds: Array.from(new Set([...card.linkedCardIds, clusterCard.id])),
            };
          })
          .concat({
            ...clusterCard,
            linkedCardIds: selectedCards.map((card) => card.id),
          }),
      );

      return {
        ...current,
        cards: nextCards,
        selectedCardIds: [clusterCard.id],
        activeCardId: clusterCard.id,
      };
    });
  }

  function summarizeCard(cardId: string | null) {
    if (!cardId) {
      return;
    }

    updateWorkspace((current) => ({
      ...current,
      cards: current.cards.map((card) =>
        card.id === cardId
          ? { ...card, previewText: summarizeCardPreview(card) }
          : card,
      ),
    }));
  }

  function generateOutputFromSelection(ids = workspace.selectedCardIds) {
    updateWorkspace((current) => {
      const selectedIds = ids.filter(Boolean);
      const selectedCards = getCardsByIds(current.cards, selectedIds).filter(
        (card) => card.type !== 'cluster',
      );

      if (!selectedCards.length) {
        return current;
      }

      const outputDraft = generateStructuredOutput(selectedCards);
      const outputCard = createCard(
        'output',
        getSuggestedPosition(current.cards, selectedIds, 'output'),
        {
          title: outputDraft.title,
          content: outputDraft.content,
          previewText: outputDraft.previewText,
          tags: outputDraft.tags,
          sourceReference: `Generated from ${selectedCards.length} card${selectedCards.length === 1 ? '' : 's'}`,
          linkedCardIds: selectedCards.map((card) => card.id),
        },
      );
      const nextCards = normalizeCards([...current.cards, outputCard]);

      return {
        ...current,
        cards: nextCards,
        selectedCardIds: [outputCard.id],
        activeCardId: outputCard.id,
      };
    });
  }

  function resetDemoWorkspace() {
    setWorkspace(createDemoWorkspace());
  }

  return {
    workspace,
    actions: {
      addCard,
      cancelLinkDraft,
      clearSelection,
      completeLink,
      createClusterFromSelection,
      focusCard,
      generateOutputFromSelection,
      groupWithSimilar,
      linkSelectedCards,
      resetDemoWorkspace,
      setCardPositions,
      setCardType,
      setSearchQuery,
      setSelection,
      setToolMode,
      setViewport,
      startLinkDraft,
      summarizeCard,
      toggleFilteredType,
      updateCard,
      updateCardTags,
    },
  };
}

