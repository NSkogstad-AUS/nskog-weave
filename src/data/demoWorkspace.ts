import { CARD_TYPES, type WorkspaceState } from '../types/workspace';
import { DEFAULT_VIEWPORT, normalizeCards } from '../lib/workspace';

export function createDemoWorkspace(): WorkspaceState {
  const cards = normalizeCards([
    {
      id: 'source-1',
      title: 'Interview excerpt: onboarding friction',
      type: 'source',
      previewText:
        'Managers describe handoff friction when kickoff context lives across email, docs, and chat.',
      content:
        'Interview with three onboarding managers: kickoff context is fragmented across notes, handoff docs, and Slack threads. New hires ask repeated questions because no one artifact feels complete.',
      tags: ['onboarding', 'handoff', 'context'],
      sourceReference: 'Qualitative interviews / March 2026',
      position: { x: 80, y: 80 },
      linkedCardIds: ['note-1', 'claim-2'],
      clusterId: null,
    },
    {
      id: 'source-2',
      title: 'Survey highlights: week-one clarity',
      type: 'source',
      previewText:
        'Survey respondents tie first-week confidence to how clearly expectations and resources are framed.',
      content:
        'Week-one survey: confidence rises when expectations, stakeholders, and tools are visible in one place. Respondents specifically mention checklist quality and ownership clarity.',
      tags: ['survey', 'clarity', 'confidence'],
      sourceReference: 'Pulse survey / 48 responses',
      position: { x: 420, y: 70 },
      linkedCardIds: ['claim-1', 'note-2'],
      clusterId: null,
    },
    {
      id: 'note-1',
      title: 'Managers lack a shared kickoff checklist',
      type: 'note',
      previewText:
        'Checklist coverage changes by team, so every manager explains the process differently.',
      content:
        'Observation: teams are improvising kickoff steps. Some start with tools, others with people, and none share a stable source of truth.',
      tags: ['checklist', 'process', 'onboarding'],
      sourceReference: '',
      position: { x: 120, y: 320 },
      linkedCardIds: ['claim-1', 'cluster-1'],
      clusterId: 'cluster-1',
    },
    {
      id: 'note-2',
      title: 'New hires rely on informal chat support',
      type: 'note',
      previewText:
        'Informal chat fills gaps quickly, but the knowledge is ephemeral and hard to reuse.',
      content:
        'New hires lean on team chat for speed, but answers stay buried in channels. Useful context rarely returns to durable onboarding material.',
      tags: ['support', 'chat', 'knowledge'],
      sourceReference: '',
      position: { x: 470, y: 330 },
      linkedCardIds: ['insight-1', 'cluster-1'],
      clusterId: 'cluster-1',
    },
    {
      id: 'claim-1',
      title: 'Checklist quality predicts first-week confidence',
      type: 'claim',
      previewText:
        'Confidence appears to increase when people can see the sequence of tasks, owners, and expectations.',
      content:
        'Claim: the more coherent the kickoff checklist, the more likely new hires are to feel oriented in the first week. This is supported by both manager interviews and the survey.',
      tags: ['confidence', 'checklist', 'signal'],
      sourceReference: '',
      position: { x: 840, y: 120 },
      linkedCardIds: ['insight-1', 'cluster-1'],
      clusterId: 'cluster-1',
    },
    {
      id: 'claim-2',
      title: 'Context loss peaks during the sales-to-success handoff',
      type: 'claim',
      previewText:
        'The earliest friction stems from missing historical context rather than from tool setup alone.',
      content:
        'Claim: the biggest information gap is not tooling, it is context transfer. Key customer history and expectations often vanish between teams before onboarding starts.',
      tags: ['handoff', 'context', 'risk'],
      sourceReference: '',
      position: { x: 870, y: 390 },
      linkedCardIds: ['output-1'],
      clusterId: null,
    },
    {
      id: 'insight-1',
      title: 'A visual workspace could align scattered onboarding signals',
      type: 'insight',
      previewText:
        'The pattern points toward one surface where notes, sources, claims, and next actions stay connected.',
      content:
        'Insight: onboarding work improves when raw evidence and synthesized thinking share one visible workspace. That reduces context loss while keeping the reasoning behind decisions inspectable.',
      tags: ['workspace', 'clarity', 'alignment'],
      sourceReference: '',
      position: { x: 1210, y: 220 },
      linkedCardIds: ['output-1', 'cluster-1'],
      clusterId: 'cluster-1',
    },
    {
      id: 'cluster-1',
      title: 'Onboarding clarity cluster',
      type: 'cluster',
      previewText:
        'Shared thread: checklist clarity, reusable answers, and visible ownership all reinforce first-week confidence.',
      content:
        'Cluster the cards that explain why first-week clarity improves confidence. This group should feed the next output draft.',
      tags: ['clarity', 'cluster', 'onboarding'],
      sourceReference: '',
      position: { x: 320, y: 590 },
      linkedCardIds: ['note-1', 'note-2', 'claim-1', 'insight-1'],
      clusterId: null,
    },
    {
      id: 'output-1',
      title: 'Brief: fix first-week context gaps',
      type: 'output',
      previewText:
        'A short working brief connects evidence, claims, and the proposed product direction.',
      content: `Summary
Create one visible workspace that keeps kickoff sources, working notes, claims, and outputs connected.

Key Takeaways
- First-week confidence improves when expectations and owners stay visible.
- Informal chat answers need a durable home.
- The handoff stage loses critical customer context.

References
- [claim-1] Checklist quality predicts first-week confidence
- [claim-2] Context loss peaks during the sales-to-success handoff
- [insight-1] A visual workspace could align scattered onboarding signals`,
      tags: ['brief', 'output', 'onboarding'],
      sourceReference: 'Generated from linked cards',
      position: { x: 1280, y: 580 },
      linkedCardIds: ['claim-2', 'insight-1'],
      clusterId: null,
    },
  ]);

  return {
    cards,
    viewport: DEFAULT_VIEWPORT,
    selectedCardIds: ['claim-1'],
    activeCardId: 'claim-1',
    searchQuery: '',
    filteredTypes: [...CARD_TYPES],
    toolMode: 'select',
    linkDraftFromId: null,
  };
}

