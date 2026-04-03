import type { Card, CardType } from '../types/workspace';
import { excerptText, sanitizeTags } from '../lib/workspace';

const STOP_WORDS = new Set([
  'about',
  'after',
  'also',
  'been',
  'between',
  'could',
  'from',
  'have',
  'into',
  'more',
  'that',
  'their',
  'there',
  'these',
  'they',
  'this',
  'using',
  'with',
  'were',
  'will',
  'would',
  'your',
]);

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function topKeywords(cards: Card[], limit = 3) {
  const counts = new Map<string, number>();

  cards.forEach((card) => {
    [...card.tags, ...tokenize(`${card.title} ${card.content}`)].forEach((token) => {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([keyword]) => keyword);
}

function buildTypeSummary(cards: Card[], type: CardType) {
  return cards
    .filter((card) => card.type === type)
    .slice(0, 2)
    .map((card) => `- ${card.title}: ${excerptText(card.content, 90)}`);
}

export function summarizeCardPreview(card: Card) {
  const lead = excerptText(card.content, 92);
  const tagLine = card.tags.length ? `Tags: ${card.tags.slice(0, 3).join(', ')}.` : '';

  return `${lead}${tagLine ? ` ${tagLine}` : ''}`;
}

export function buildClusterDraft(cards: Card[]) {
  const keywords = topKeywords(cards);
  const title = keywords.length
    ? `${keywords[0].replace(/^\w/, (character) => character.toUpperCase())} cluster`
    : 'New cluster';
  const content = `This cluster groups ${cards.length} related cards around ${keywords.join(
    ', ',
  ) || 'a shared theme'}. Use it as a working anchor for synthesis and output generation.`;

  return {
    title,
    content,
    tags: sanitizeTags([...keywords, 'cluster']),
  };
}

export function findSimilarCardIds(activeCard: Card, cards: Card[], limit = 3) {
  const activeTerms = new Set(tokenize(`${activeCard.title} ${activeCard.content}`));
  const activeTags = new Set(activeCard.tags);

  return cards
    .filter((card) => card.id !== activeCard.id && card.type !== 'cluster')
    .map((card) => {
      const cardTerms = new Set(tokenize(`${card.title} ${card.content}`));
      const cardTags = new Set(card.tags);

      let score = 0;

      cardTags.forEach((tag) => {
        if (activeTags.has(tag)) {
          score += 3;
        }
      });

      cardTerms.forEach((term) => {
        if (activeTerms.has(term)) {
          score += 1;
        }
      });

      if (card.type === activeCard.type) {
        score += 1;
      }

      return { id: card.id, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((candidate) => candidate.id);
}

export function generateStructuredOutput(cards: Card[]) {
  const keywords = topKeywords(cards);
  const references = cards.map((card) => `- [${card.id}] ${card.title}`);
  const claims = buildTypeSummary(cards, 'claim');
  const notes = buildTypeSummary(cards, 'note');
  const sources = buildTypeSummary(cards, 'source');
  const insights = buildTypeSummary(cards, 'insight');
  const tags = sanitizeTags([...keywords, 'output']);
  const headline =
    keywords[0]?.replace(/^\w/, (character) => character.toUpperCase()) ?? 'Working';
  const title = `${headline} brief`;
  const contentSections = [
    'Summary',
    `This working brief pulls together ${cards.length} selected cards to clarify the main signal around ${
      keywords.join(', ') || 'the current topic'
    }.`,
    '',
    'Key Takeaways',
    ...(claims.length ? claims : ['- Synthesize the selected evidence into one clear claim.']),
    ...(insights.length ? insights : ['- Surface the strongest pattern before moving into execution.']),
    '',
    'Evidence Threads',
    ...(sources.length ? sources : ['- Add at least one strong source card to support the draft.']),
    ...(notes.length ? notes : ['- Capture more raw notes to support the synthesis.']),
    '',
    'Recommended Next Step',
    `- Convert this brief into a sharper memo or outline focused on ${keywords[0] || 'the strongest theme'}.`,
    '',
    'References',
    ...references,
  ];

  return {
    title,
    content: contentSections.join('\n'),
    previewText: `Structured output built from ${cards.length} linked cards around ${
      keywords.join(', ') || 'the current theme'
    }.`,
    tags,
  };
}

