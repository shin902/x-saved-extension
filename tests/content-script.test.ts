import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
});

it('does not throw when an extension reload invalidates an existing content script', async () => {
  window.history.replaceState({}, '', '/i/bookmarks');
  document.body.innerHTML = `
    <article data-testid="tweet">
      <div data-testid="User-Name">@alice</div>
      <a href="https://x.com/alice/status/123">
        <time datetime="2026-01-01T00:00:00Z"></time>
      </a>
    </article>
  `;
  vi.stubGlobal('chrome', { runtime: undefined });
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(_callback: () => void) {}
      observe() {}
    }
  );

  await expect(import('../src/content-script')).resolves.toBeDefined();
});
