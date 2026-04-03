import { startTransition, useDeferredValue, useState } from 'react';

import { CanvasBoard } from './features/canvas/CanvasBoard';
import { InspectorSidebar } from './features/inspector/InspectorSidebar';
import { LeftToolbar } from './features/toolbar/LeftToolbar';
import { useWorkspace } from './hooks/useWorkspace';
import {
  buildLinks,
  getCanvasCenterPosition,
  matchesCardFilters,
} from './lib/workspace';
import type { CardType } from './types/workspace';

function App() {
  const { workspace, actions } = useWorkspace();
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });
  const deferredSearchQuery = useDeferredValue(workspace.searchQuery);
  const visibleCards = workspace.cards.filter((card) =>
    matchesCardFilters(card, deferredSearchQuery, workspace.filteredTypes),
  );
  const visibleCardIds = new Set(visibleCards.map((card) => card.id));
  const links = buildLinks(workspace.cards).filter(
    (link) =>
      visibleCardIds.has(link.sourceCardId) && visibleCardIds.has(link.targetCardId),
  );
  const activeCard =
    workspace.cards.find((card) => card.id === workspace.activeCardId) ?? null;
  const selectedCards = workspace.cards.filter((card) =>
    workspace.selectedCardIds.includes(card.id),
  );
  const actionSelectionIds = workspace.selectedCardIds.length
    ? workspace.selectedCardIds
    : activeCard
      ? [activeCard.id]
      : [];
  const relatedCards = activeCard
    ? workspace.cards.filter(
        (card) =>
          card.id !== activeCard.id &&
          (activeCard.linkedCardIds.includes(card.id) ||
            card.clusterId === activeCard.id ||
            activeCard.clusterId === card.id),
      )
    : [];

  function handleAddCard(type: CardType) {
    actions.addCard(
      type,
      getCanvasCenterPosition(workspace.viewport, canvasSize, type),
    );
  }

  function handleGenerateOutput() {
    actions.generateOutputFromSelection(actionSelectionIds);
  }

  function handleGroupSelection() {
    if (workspace.selectedCardIds.length > 1) {
      actions.createClusterFromSelection(workspace.selectedCardIds);
      return;
    }

    actions.groupWithSimilar(activeCard?.id ?? null);
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.12),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.10),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#f3f6fb_100%)] p-4">
      <div className="grid h-[calc(100vh-2rem)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)_380px]">
        <aside className="min-h-0">
          <LeftToolbar
            canCreateCluster={actionSelectionIds.length > 1}
            canGenerateOutput={actionSelectionIds.length > 0}
            canLinkSelection={workspace.selectedCardIds.length === 2}
            filteredTypes={workspace.filteredTypes}
            onAddCard={handleAddCard}
            onCreateCluster={() =>
              actions.createClusterFromSelection(workspace.selectedCardIds)
            }
            onGenerateOutput={handleGenerateOutput}
            onLinkSelection={actions.linkSelectedCards}
            onResetDemo={actions.resetDemoWorkspace}
            onSearchChange={(value) => {
              startTransition(() => {
                actions.setSearchQuery(value);
              });
            }}
            onToggleType={actions.toggleFilteredType}
            onToolModeChange={actions.setToolMode}
            searchQuery={workspace.searchQuery}
            selectedCount={selectedCards.length}
            toolMode={workspace.toolMode}
            totalCount={workspace.cards.length}
            visibleCount={visibleCards.length}
          />
        </aside>

        <main className="min-h-0">
          <CanvasBoard
            activeCardId={workspace.activeCardId}
            allCards={workspace.cards}
            cards={visibleCards}
            linkDraftFromId={workspace.linkDraftFromId}
            links={links}
            onCancelLinkDraft={actions.cancelLinkDraft}
            onCanvasSizeChange={setCanvasSize}
            onClearSelection={actions.clearSelection}
            onCompleteLink={actions.completeLink}
            onFocusCard={actions.focusCard}
            onSetCardPositions={actions.setCardPositions}
            onSetSelection={actions.setSelection}
            onSetViewport={actions.setViewport}
            onStartLink={actions.startLinkDraft}
            selectedCardIds={workspace.selectedCardIds}
            toolMode={workspace.toolMode}
            viewport={workspace.viewport}
          />
        </main>

        <aside className="min-h-0">
          <InspectorSidebar
            activeCard={activeCard}
            onFocusRelatedCard={actions.focusCard}
            onGenerateOutput={handleGenerateOutput}
            onGroupSelection={handleGroupSelection}
            onSetCardType={actions.setCardType}
            onSummarizeCard={actions.summarizeCard}
            onUpdateCard={actions.updateCard}
            onUpdateTags={actions.updateCardTags}
            relatedCards={relatedCards}
            selectedCount={selectedCards.length}
          />
        </aside>
      </div>
    </div>
  );
}

export default App;

