# Project Context

This repo is a local-first React workspace for organizing files and folders, then opening them in either a structured explorer or a freeform canvas. Prioritize preserving existing interaction behavior, storage compatibility, and readable code over clever abstractions.

Investigate first before changing canvas layout, worker execution, persistence, or drag/pointer behavior.

## Stack

- Vite + React 19 + TypeScript (`strict`)
- Tailwind CSS v4 with custom theme variables in [`src/index.css`](./src/index.css)
- UI primitives from `animate-ui`, `radix`, and local `src/components/ui`

## Architecture Map

- [`src/App.tsx`](./src/App.tsx): top-level app shell, workspace state, localStorage persistence, generated worker output integration
- [`src/data/sidebarNavigation.ts`](./src/data/sidebarNavigation.ts): core workspace folder/file tree types and mutation helpers
- [`src/features/file-page/FileWorkspace.tsx`](./src/features/file-page/FileWorkspace.tsx): switches between file/folder explorer and canvas experiences
- [`src/features/file-page/FileCanvasView.tsx`](./src/features/file-page/FileCanvasView.tsx): main canvas orchestration for drag, pan, resize, selection, connectors, palette, and worker flows
- [`src/features/file-page/canvas/`](./src/features/file-page/canvas): canvas-specific hooks, layout logic, node builders, constants, metadata, and utility functions
- [`src/features/file-page/useFolderCanvasState.ts`](./src/features/file-page/useFolderCanvasState.ts): folder canvas persistence and normalization
- [`src/hooks/useFilePages.ts`](./src/hooks/useFilePages.ts): per-file page persistence and hydration
- [`src/lib/filePageWorkers.ts`](./src/lib/filePageWorkers.ts): worker mode/focus/run-mode metadata and user-facing labels

## Commands

```bash
npm run dev        # start Vite dev server
npm run build      # typecheck app TS config, then build
npm run typecheck  # strict TypeScript validation
npm run preview    # preview production build
```

## Persistence And Invariants

- Keep localStorage keys stable unless migration code is added:
  - `weave:workspace-folders:v1`
  - `weave:file-pages:v1`
  - `weave:folder-canvas:v1`
- File and folder canvas state is normalized on hydration. If you change stored shapes, add backward-compatible handling.
- Worker-generated folders/files use encoded synthetic ids. Do not casually change those id formats without tracing all read/write paths.
- Canvas sizing and snapping depend on shared constants in [`src/features/file-page/canvas/constants.ts`](./src/features/file-page/canvas/constants.ts). Treat those as behavioral inputs, not cosmetic values.

## Conventions

- Prefer `@/` imports for app code.
- Keep React code functional and explicit. This codebase currently favors readable stateful hooks over heavy abstraction.
- Preserve current visual language unless the task explicitly calls for redesign. Styling mixes Tailwind utilities with shared CSS variables and custom surfaces.
- When changing canvas behavior, check the related hook/util modules before editing the top-level view component.
- There is no formal test suite yet. At minimum, run `npm run typecheck` after code changes. Run `npm run build` for broader verification when touching app wiring, styling, or the Vite config.

## Default Workflow

1. Determine whether the task is a question, a UI change, a persistence change, or a worker behavior change.
2. Read the relevant feature files before editing, especially for canvas interactions and storage code.
3. Make the smallest change that preserves existing behavior and data compatibility.
4. Verify with `npm run typecheck`; use `npm run build` when the change could affect bundling, runtime wiring, or CSS.

## Task-Specific Guidance

- Canvas interactions:
  - Review `FileCanvasView`, `useCanvasLayout`, `useFloatingInspectors`, `useWorkerEngine`, and `canvas/utils.ts` together.
  - Think through pointer events, selection state, snapping, grouping, and viewport math before editing.
- Persistence changes:
  - Review both hydration and write paths.
  - Do not break existing local data without an explicit migration.
## Notes

- The `claude/` directory can hold longer-form Claude-specific references. Keep this root `CLAUDE.md` concise so it remains useful in prompt context.
- Do not add secrets, tokens, or internal-only credentials to this file.
