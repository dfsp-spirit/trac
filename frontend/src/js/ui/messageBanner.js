// @ts-check
/**
 * The two banner messages above the app: one from the server admin, one from
 * the study admin.
 *
 * A banner is informational, never blocking: it sits above the top bar in the
 * normal flow (so it scrolls away and no sticky offset has to know about it),
 * its text is plain text with preserved line breaks, and closing it only
 * removes the element. Nothing here can throw at the diary: a missing message,
 * a dismissed message and a failed request all end in "no banner".
 */

import { el } from './dom.js';
import { createDismissedMessages } from './dismissedMessages.js';

const STACK_SELECTOR = '[data-message-stack]';

/**
 * @typedef {{ text: string, key: string }} BannerMessage
 * @typedef {{
 *   has: (key: string) => boolean,
 *   remember: (key: string) => void,
 * }} DismissedMessages
 */

/**
 * @param {BannerMessage} message
 * @param {{ dismissed: DismissedMessages, label: string, onRemove: () => void }} view
 * @returns {HTMLElement}
 */
function bannerFor(message, { dismissed, label, onRemove }) {
  const banner = el('div', 't-message');
  banner.setAttribute('role', 'status');

  const text = el('p', 't-message__text', message.text);

  const close = el('button', 't-message__close');
  close.type = 'button';
  close.setAttribute('aria-label', label);
  close.textContent = '\u00d7';
  close.addEventListener('click', () => {
    dismissed.remember(message.key);
    onRemove();
  });

  banner.append(text, close);
  return banner;
}

/**
 * Render (or re-render) the banners in `host`. Idempotent: the language switch
 * calls it again with new texts, and a message the reader dismissed stays gone
 * because the dismissal is keyed by content, not by position.
 *
 * @param {HTMLElement} host
 * @param {{
 *   messages: { server: BannerMessage | null, study: BannerMessage | null },
 *   dismissed: DismissedMessages,
 *   t: (key: string) => string,
 * }} view
 */
export function renderMessageBanners(host, { messages, dismissed, t }) {
  /** @type {BannerMessage[]} */
  const visible = [];
  for (const message of [messages.server, messages.study]) {
    if (message && !dismissed.has(message.key)) visible.push(message);
  }

  const existing = host.querySelector(STACK_SELECTOR);
  if (!visible.length) {
    existing?.remove();
    return;
  }

  const stack = existing || el('div', 't-message-stack');
  if (!existing) {
    stack.setAttribute('data-message-stack', '');
    host.prepend(stack);
  }

  const label = t('diary.message.dismiss');
  stack.replaceChildren(
    ...visible.map((message) =>
      bannerFor(message, {
        dismissed,
        label,
        onRemove: () => {
          // Re-render from the remaining messages: last banner closed means the
          // stack disappears too.
          renderMessageBanners(host, { messages, dismissed, t });
        },
      })
    )
  );
}

/**
 * Keep the banners in sync with the server: once on load, and again whenever
 * the interface language changes (the server resolves the text for a language,
 * so a switch has to re-ask).
 *
 * @param {{
 *   host: HTMLElement,
 *   t: (key: string) => string,
 *   load: (language: string) => Promise<{ server: BannerMessage | null, study: BannerMessage | null }>,
 *   dismissed?: DismissedMessages,
 * }} deps
 */
export function createMessageBanners({ host, t, load, dismissed = createDismissedMessages() }) {
  return {
    /** @param {string} language */
    async refresh(language) {
      const messages = await load(language);
      renderMessageBanners(host, { messages, dismissed, t });
    },
  };
}
