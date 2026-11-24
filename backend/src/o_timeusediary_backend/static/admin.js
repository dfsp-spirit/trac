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
        const colours = { info: 'var(--muted)', ok: 'var(--ok)', error: 'var(--danger-strong)' };
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

    window.drawCompletionChart = function drawCompletionChart(canvasId, dates, tuSeries, allSeries, hasTasks) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !dates || dates.length < 2) return;

        // Use explicit canvas attributes as fallback when the tab is hidden (display:none -> zero rect)
        const cssWidth = canvas.getBoundingClientRect().width || canvas.width;
        const cssHeight = canvas.getBoundingClientRect().height || canvas.height;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;
        ctx.scale(dpr, dpr);
        const w = cssWidth;
        const h = cssHeight;
        const pad = { top: 30, right: 30, bottom: 55, left: 55 };
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;

        const maxVal = Math.max(...tuSeries, ...(allSeries || []), 1);
        const xCount = dates.length;

        const totalDays = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / (1000 * 60 * 60 * 24);
        const xStep = totalDays > 0 ? plotW / totalDays : plotW;
        const yScale = plotH / Math.max(maxVal, 1);

        function xPos(i) {
            const dayOffset = (new Date(dates[i]) - new Date(dates[0])) / (1000 * 60 * 60 * 24);
            return pad.left + dayOffset * xStep;
        }
        function yPos(v) { return pad.top + plotH - v * yScale; }

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = 'rgba(28,28,28,0.08)';
        ctx.lineWidth = 1;
        const yTicks = 5;
        for (let i = 0; i <= yTicks; i++) {
            const v = Math.round((maxVal / yTicks) * i);
            const y = yPos(v);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();
            ctx.fillStyle = 'var(--muted, #6b7280)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(String(v), pad.left - 8, y + 4);
        }

        // Y-axis label
        ctx.save();
        ctx.translate(14, pad.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'var(--muted, #6b7280)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Participants', 0, 0);
        ctx.restore();

        // X-axis labels (show ~8 labels)
        const xLabelCount = Math.min(8, xCount);
        const xStepLabels = Math.max(1, Math.floor(xCount / xLabelCount));
        for (let i = 0; i < xCount; i += xStepLabels) {
            const x = xPos(i);
            ctx.fillStyle = 'var(--muted, #6b7280)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            const parts = dates[i].split('-');
            ctx.fillText(parts[1] + '/' + parts[2], x, pad.top + plotH + 16);
        }
        ctx.fillText('Date', pad.left + plotW / 2, h - 5);

        // Draw time-use line
        function drawSeries(data, color) {
            if (!data || data.length < 2) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            for (let i = 0; i < data.length; i++) {
                const x = xPos(i);
                const y = yPos(data[i]);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Fill under the line
            ctx.lineTo(xPos(data.length - 1), yPos(0));
            ctx.lineTo(xPos(0), yPos(0));
            ctx.closePath();
            ctx.fillStyle = color + '18';
            ctx.fill();
        }

        drawSeries(tuSeries, '#4f46e5');
        if (hasTasks && allSeries && allSeries.length > 0) {
            drawSeries(allSeries, '#059669');
        }

        // Current date vertical line
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayIdx = dates.findIndex(d => d >= todayStr);
        if (todayIdx >= 0 && todayIdx < dates.length) {
            const x = xPos(todayIdx);
            ctx.strokeStyle = 'rgba(220,38,38,0.5)';
            ctx.setLineDash([4, 3]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, pad.top);
            ctx.lineTo(x, pad.top + plotH);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(220,38,38,0.7)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Today', x, pad.top - 8);
        }

        // Mark as drawn so e2e tests can reliably detect completion
        canvas.dataset.drawn = 'true';
    };
})();
