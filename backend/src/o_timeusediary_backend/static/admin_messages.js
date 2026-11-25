/*
 * The two banner messages: the server-wide one (admin overview, super admins)
 * and a study's own one (study message page). One script for both forms,
 * because the fields and the payload differ only in the endpoint.
 *
 * Saving is last-write-wins on purpose: there is exactly one message per scope,
 * and an admin who just typed a maintenance window knows what she typed. A
 * revision conflict would only add a dialog to a two-field form.
 */
(function () {
    'use strict';

    const form = document.querySelector('[data-message-form]');
    if (!form) {
        return;
    }

    const scope = form.dataset.messageForm; // 'server' | 'study'
    const studyNameShort = form.dataset.studyNameShort || '';
    const activeEl = form.querySelector('[data-message-active]');
    const statusEl = form.querySelector('#messageStatus');
    const saveBtn = form.querySelector('#messageSaveBtn');
    const audienceEls = Array.from(form.querySelectorAll('[data-message-audience]'));
    const languageEls = Array.from(form.querySelectorAll('[data-message-language]'));

    function setStatus(message, kind) {
        window.setStatus(statusEl, message, kind);
    }

    function collectText() {
        const text = {};
        for (const el of languageEls) {
            const value = el.value.trim();
            if (value) {
                text[el.dataset.messageLanguage] = value;
            }
        }
        return text;
    }

    /**
     * Both boxes checked means "both" in the API's single enum; one box means
     * that audience; none is an error the admin has to fix (an active message
     * with no reader is a message nobody asked for).
     */
    function collectAudience() {
        const chosen = audienceEls
            .filter((el) => el.checked)
            .map((el) => el.dataset.messageAudience);
        if (chosen.length === 0 || chosen.length === audienceEls.length) {
            return chosen.length === 0 ? null : 'both';
        }
        return chosen[0];
    }

    async function save() {
        const text = collectText();
        const isActive = Boolean(activeEl && activeEl.checked);
        const payload = { text, is_active: isActive };

        if (audienceEls.length) {
            const audience = collectAudience();
            if (!audience) {
                setStatus('Select at least one audience.', 'error');
                return;
            }
            payload.audience = audience;
        }

        if (isActive && Object.keys(text).length === 0) {
            setStatus('Enter the text before switching the message on.', 'error');
            return;
        }

        const path =
            scope === 'server'
                ? '/api/admin/messages/server'
                : `/api/admin/studies/${encodeURIComponent(studyNameShort)}/message`;

        saveBtn.disabled = true;
        setStatus('Saving…');
        try {
            const saved = await window.adminFetch(path, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            setStatus(
                saved.is_active
                    ? 'Saved. The message is live now.'
                    : 'Saved. The message is switched off.',
                'ok'
            );
        } catch (error) {
            setStatus(error.message || 'Saving failed.', 'error');
        } finally {
            saveBtn.disabled = false;
        }
    }

    saveBtn.addEventListener('click', save);
})();
