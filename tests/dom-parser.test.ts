import { describe, expect, it } from 'vitest';
import { actionKind, isSelected, pageKind, parseTweetArticle } from '../src/dom-parser';

function article(markup = ''): HTMLElement {
  const root = document.createElement('article');
  root.dataset.testid = 'tweet';
  root.innerHTML = markup;
  return root;
}

describe('DOM tweet parser', () => {
  it('normalizes the rendered tweet fields and canonical status URL', () => {
    const root = article(`
      <div data-testid="User-Name">Alice <span>@alice</span></div>
      <div data-testid="tweetText">Hello\n  from X</div>
      <time datetime="2025-01-02T03:04:05.000Z">Jan 2</time>
      <a href="https://twitter.com/alice/status/123456789?s=20">timestamp</a>
    `);
    document.body.append(root);

    expect(parseTweetArticle(root, 'like')).toEqual({
      tweet_id: '123456789', text: 'Hello from X', author: '@alice',
      url: 'https://x.com/alice/status/123456789',
      created_at: '2025-01-02T03:04:05.000Z', kind: 'like'
    });
  });

  it('recognizes history routes and selected action buttons', () => {
    expect(pageKind({ pathname: '/i/bookmarks' })).toBe('bookmark');
    expect(pageKind({ pathname: '/alice/likes' })).toBe('like');
    expect(pageKind({ pathname: '/home' })).toBeNull();
    const root = article('<button data-testid="removeBookmark"></button>');
    expect(actionKind(root.querySelector('button'))).toBe('bookmark');
    expect(isSelected(root, 'bookmark')).toBe(true);
  });

  it('rejects articles without a status link or timestamp', () => {
    const root = article('<div data-testid="User-Name">@alice</div>');
    expect(parseTweetArticle(root, 'bookmark')).toBeNull();
  });
});
