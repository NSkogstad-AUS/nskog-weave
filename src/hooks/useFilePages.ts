import { useEffect, useMemo, useState } from 'react';

import type { WorkspaceFile } from '@/data/sidebarNavigation';
import {
  createDefaultFilePage,
  FILE_PAGES_STORAGE_KEY,
} from '@/lib/filePages';
import type { FilePageState, FilePageView } from '@/types/filePage';
import type { Point } from '@/types/workspace';

type FilePagesStore = Record<string, FilePageState>;

function hydrateFilePages(): FilePagesStore {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(FILE_PAGES_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, Partial<FilePageState>>;

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([fileId, page]) => {
        if (!page || !Array.isArray(page.nodes)) {
          return [];
        }

        return [
          [
            fileId,
            {
              view: page.view === 'explorer' ? 'explorer' : 'canvas',
              nodes: page.nodes.filter(
                (node): node is FilePageState['nodes'][number] =>
                  typeof node?.id === 'string' &&
                  typeof node?.label === 'string' &&
                  (node?.kind === 'folder' ||
                    node?.kind === 'file' ||
                    node?.kind === 'element') &&
                  Number.isFinite(node?.position?.x) &&
                  Number.isFinite(node?.position?.y),
              ),
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

export function useFilePages(activeFile: WorkspaceFile | null) {
  const [pages, setPages] = useState<FilePagesStore>(hydrateFilePages);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(FILE_PAGES_STORAGE_KEY, JSON.stringify(pages));
  }, [pages]);

  useEffect(() => {
    if (!activeFile) {
      setSelectedNodeId(null);
      return;
    }

    setPages((current) =>
      current[activeFile.id]
        ? current
        : {
            ...current,
            [activeFile.id]: createDefaultFilePage(activeFile),
          },
    );
    setSelectedNodeId(null);
  }, [activeFile?.id]);

  const activePage = useMemo(() => {
    if (!activeFile) {
      return null;
    }

    return pages[activeFile.id] ?? createDefaultFilePage(activeFile);
  }, [activeFile, pages]);

  function updateActivePage(recipe: (page: FilePageState) => FilePageState) {
    if (!activeFile) {
      return;
    }

    setPages((current) => {
      const currentPage = current[activeFile.id] ?? createDefaultFilePage(activeFile);

      return {
        ...current,
        [activeFile.id]: recipe(currentPage),
      };
    });
  }

  function setView(view: FilePageView) {
    updateActivePage((page) => ({
      ...page,
      view,
    }));
  }

  function moveNode(nodeId: string, position: Point) {
    updateActivePage((page) => ({
      ...page,
      nodes: page.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              position,
            }
          : node,
      ),
    }));
  }

  function removeFilePage(fileId: string) {
    setPages((current) => {
      if (!current[fileId]) {
        return current;
      }

      const next = { ...current };

      delete next[fileId];
      return next;
    });
  }

  return {
    activePage,
    selectedNodeId,
    setSelectedNodeId,
    setView,
    moveNode,
    removeFilePage,
  };
}
