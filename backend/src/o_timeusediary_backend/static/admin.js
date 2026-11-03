/*
 * Shared helpers for the admin pages (templates/admin_*.html).
 *
 * admin_base.html loads this file before the page's own scripts, so the
 * functions below are available to the inline handlers used by the templates.
 * Keep page-specific behaviour in the template; only genuinely shared helpers
 * belong here.
 */
(function () {
    'use strict';

    const rootPath = document.documentElement.dataset.rootPath || '';

    /**
     * Switch one tab group to the given panel.
     *
     * The group is the nearest [data-tab-group]; older markup without that
     * attribute still works through the .study-section / .tab-content fallbacks.
     * Panels are matched by id inside the group, so the caller never needs to
     * escape study short names.
     */
    window.switchTab = function switchTab(tabId, button) {
        const group =
            button.closest('[data-tab-group]') ||
            button.closest('.study-section') ||
            button.parentElement.parentElement;
        if (!group) {
            return;
        }

        group.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
        group.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
        button.classList.add('active');

        const panel = Array.from(group.querySelectorAll('.tab-panel')).find(
            (candidate) => candidate.id === tabId
        );
        if (panel) {
            panel.classList.add('active');
        }

        // The overview keeps the active study/tab in the URL.
        if (typeof window.updateAdminViewState === 'function') {
            window.updateAdminViewState(group.dataset.studyId || null, tabId);
        }

        document.dispatchEvent(
            new CustomEvent('admin:tab-shown', { detail: { tabId, group, panel } })
        );

        // Optional deep-linking: remember the tab in the URL fragment.
        if (group.hasAttribute('data-tab-persist') && window.history.replaceState) {
            window.history.replaceState(null, '', `#${tabId}`);
        }
    };

    // Restore a tab selected through the URL fragment of a persisting group.
    document.addEventListener('DOMContentLoaded', () => {
        const hash = window.location.hash.slice(1);
        if (!hash) {
            return;
        }
        document.querySelectorAll('[data-tab-persist]').forEach((group) => {
            const button = Array.from(group.querySelectorAll('.tab')).find((tab) =>
                (tab.getAttribute('onclick') || '').includes(`'${hash}'`)
            );
            if (button) {
                window.switchTab(hash, button);
            }
        });
    });

    /**
     * fetch() against the API with credentials and uniform error handling.
     *
     * Resolves with the parsed JSON body (or null for an empty body) and throws
     * an Error carrying the API's `detail` text on any non-2xx response.
     */
    window.adminFetch = async function adminFetch(path, options = {}) {
        const response = await fetch(`${window.location.origin}${rootPath}${path}`, {
            credentials: 'same-origin',
            ...options,
        });

        let body = null;
        try {
            body = await response.json();
        } catch (error) {
            body = null;
        }

        if (!response.ok) {
            throw new Error((body && body.detail) || `Request failed (${response.status})`);
        }
        return body;
    };

    /** Write a message into a status element, coloured by kind: info/ok/error. */
    window.setStatus = function setStatus(element, message, kind = 'info') {
        if (!element) {
            return;
        }
        const colours = { info: '#5f5f5d', ok: '#1f6f43', error: '#b3261e' };
        element.textContent = message || '';
        element.style.color = colours[kind] || colours.info;
    };

    /** Copy text to the clipboard, returning false when the browser refuses. */
    window.copyToClipboard = async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            return false;
        }
    };
})();
