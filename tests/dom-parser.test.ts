import { describe, expect, it, vi } from 'vitest';
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
      tweet_id: '123456789',
      text: 'Hello from X',
      author: '@alice',
      url: 'https://x.com/alice/status/123456789',
      created_at: '2025-01-02T03:04:05.000Z',
      kind: 'like',
    });
  });

  const metadata = `<div data-testid="User-Name">@alice</div><time datetime="2026-01-01T00:00:00Z"></time><a href="https://x.com/alice/status/123">post</a>`;

  it('extracts image alt and stable mixed positions, excluding avatars, icons, quotes and video posters', () => {
    const root = article(`${metadata}
      <div data-testid="UserAvatar-Container"><img src="https://pbs.twimg.com/profile_images/avatar.jpg"></div>
      <img src="https://abs.twimg.com/emoji.svg"><img src="https://example.com/media/not-x.jpg">
      <a href="/alice/status/123/photo/1"><img src="https://pbs.twimg.com/media/one?format=jpg&name=small" alt="A diagram"></a>
      <div data-testid="videoComponent"><div data-testid="videoPlayer"><img src="https://pbs.twimg.com/media/poster"><video src="blob:https://x.com/transient"></video></div></div>
      <img src="https://pbs.twimg.com/media/two.png">
      <div role="link"><a href="/bob/status/456">quoted</a><img src="https://pbs.twimg.com/media/quote"><video></video></div>
      <article><img src="https://pbs.twimg.com/media/nested"></article>
      <div data-testid="card.wrapper"><img src="https://pbs.twimg.com/media/card"></div>
    `);
    const expected = [
      {
        kind: 'image',
        position: 0,
        source_url: 'https://pbs.twimg.com/media/one?format=jpg&name=small',
        alt_text: 'A diagram',
      },
      { kind: 'video', position: 1 },
      { kind: 'image', position: 2, source_url: 'https://pbs.twimg.com/media/two.png' },
    ];
    expect(parseTweetArticle(root, 'like')?.media).toEqual(expected);
    expect(parseTweetArticle(root, 'like')?.media).toEqual(expected);
  });

  it('preserves photo slot positions as a lazy-loaded image source arrives', () => {
    const root = article(
      `${metadata}<div data-testid="tweetPhoto"><img></div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/two"></div>`
    );
    expect(parseTweetArticle(root, 'like')?.media).toEqual([
      { kind: 'image', position: 1, source_url: 'https://pbs.twimg.com/media/two' },
    ]);
    root.querySelector('img')!.src = 'https://pbs.twimg.com/media/one';
    expect(parseTweetArticle(root, 'like')?.media).toEqual([
      { kind: 'image', position: 0, source_url: 'https://pbs.twimg.com/media/one' },
      { kind: 'image', position: 1, source_url: 'https://pbs.twimg.com/media/two' },
    ]);
  });

  it('recognizes a bare video without persisting its transient URL', () => {
    expect(
      parseTweetArticle(article(`${metadata}<video src="blob:https://x.com/gif"></video>`), 'bookmark')?.media
    ).toEqual([{ kind: 'video', position: 0 }]);
  });

  it('keeps the Tweet when media parsing throws', () => {
    const root = article(`${metadata}<img src="https://pbs.twimg.com/media/one">`);
    const original = root.querySelectorAll.bind(root);
    vi.spyOn(root, 'querySelectorAll').mockImplementation((selector) => {
      if (selector.startsWith('img,')) throw new Error('media DOM unavailable');
      return original(selector);
    });
    expect(parseTweetArticle(root, 'like')).toMatchObject({ tweet_id: '123', text: '', kind: 'like' });
    expect(parseTweetArticle(root, 'like')).not.toHaveProperty('media');
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
