/*
 * Multi-language study text editor.
 *
 * The page shell is rendered by Jinja; the form itself is built from the field
 * descriptors returned by GET /api/admin/studies/{name}/texts. Keeping the
 * rendering generic is what lets the same component grow into a full study
 * configuration editor later.
 */
(function () {
    'use strict';

    const container = document.getElementById('studyTextsEditor');
    if (!container) {
        return;
    }

    const studyNameShort = container.dataset.studyNameShort || '';
    const loadingEl = document.getElementById('textEditorLoading');
    const errorEl = document.getElementById('textEditorError');
    const contentEl = document.getElementById('textEditorContent');
    const tabsEl = document.getElementById('textEditorLanguageTabs');
    const hintEl = document.getElementById('textEditorLanguageHint');
    const validationEl = document.getElementById('textEditorValidation');
    const fieldsEl = document.getElementById('textEditorFields');
    const statusEl = document.getElementById('textEditorStatus');
    const saveBtn = document.getElementById('textEditorSaveBtn');
    const reloadBtn = document.getElementById('textEditorReloadBtn');

    const state = {
        revision: '',
        defaultLanguage: '',
        supportedLanguages: [],
        activeLanguage: '',
        fields: [],
        values: {},
        originalValues: {},
        dirtyFields: new Set(),
        saving: false,
    };

    function cloneValues(values) {
        return JSON.parse(JSON.stringify(values || {}));
    }

    function setError(message) {
        errorEl.textContent = message || '';
        errorEl.hidden = !message;
    }

    function setValidation(message) {
        validationEl.textContent = message || '';
        validationEl.hidden = !message;
    }

    function fieldSpec(key) {
        return state.fields.find((field) => field.key === key) || null;
    }

    function fieldLabel(key) {
        const spec = fieldSpec(key);
        return spec ? spec.label : key;
    }

    function fieldValue(key, language) {
        const map = state.values[key];
        return map && typeof map[language] === 'string' ? map[language] : '';
    }

    /** The values the editor owns: supported languages only, empty -> null. */
    function normalizedField(map) {
        const result = {};
        let anyText = false;
        for (const language of state.supportedLanguages) {
            const value = map && typeof map[language] === 'string' ? map[language] : '';
            result[language] = value;
            if (value.trim()) {
                anyText = true;
            }
        }
        return anyText ? result : null;
    }

    function missingLanguages(map) {
        const normalized = normalizedField(map);
        if (!normalized) {
            return [];
        }
        return state.supportedLanguages.filter(
            (language) => !String(normalized[language] || '').trim()
        );
    }

    function markDirty(key) {
        const original = JSON.stringify(normalizedField(state.originalValues[key]));
        const current = JSON.stringify(normalizedField(state.values[key]));
        if (original === current) {
            state.dirtyFields.delete(key);
        } else {
            state.dirtyFields.add(key);
        }
        updateSaveState();
    }

    function validationErrors() {
        const errors = [];
        for (const key of state.dirtyFields) {
            const missing = missingLanguages(state.values[key]);
            if (missing.length) {
                errors.push(`${fieldLabel(key)}: missing ${missing.join(', ')}`);
            }
        }
        return errors;
    }

    function updateSaveState() {
        if (!saveBtn) {
            return;
        }
        const errors = validationErrors();
        setValidation(errors.length ? errors.join(' | ') : '');
        saveBtn.disabled = state.saving || state.dirtyFields.size === 0 || errors.length > 0;
    }

    function setStatusMessage(message, kind) {
        setStatus(statusEl, message, kind || 'info');
    }

    function renderLanguageTabs() {
        tabsEl.replaceChildren();
        for (const language of state.supportedLanguages) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className =
                'text-editor-language-tab' +
                (language === state.activeLanguage ? ' active' : '');
            button.setAttribute('role', 'tab');
            button.setAttribute(
                'aria-selected',
                language === state.activeLanguage ? 'true' : 'false'
            );
            button.textContent =
                language.toUpperCase() +
                (language === state.defaultLanguage ? ' (default)' : '');
            button.addEventListener('click', () => {
                state.activeLanguage = language;
                renderAll();
            });
            tabsEl.appendChild(button);
        }

        hintEl.textContent = state.activeLanguage
            ? `Editing ${state.activeLanguage.toUpperCase()}. ` +
              'For each text you edit, fill in every supported language; missing translations are marked below.'
            : 'No supported languages are configured for this study.';
    }

    function createMissingBadge(key) {
        const badge = document.createElement('span');
        const missing = missingLanguages(state.values[key]);
        if (missing.length) {
            badge.className = 'text-editor-badge text-warn';
            badge.textContent = `Missing ${missing.join(', ')}`;
        } else if (normalizedField(state.values[key])) {
            badge.className = 'text-editor-badge text-ok';
            badge.textContent = 'Complete';
        } else {
            badge.className = 'text-editor-badge';
            badge.textContent = 'Not set';
        }
        return badge;
    }

    function renderField(field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'text-editor-field';
        wrapper.dataset.fieldKey = field.key;

        const inputId = `study-text-${field.key}`;

        const header = document.createElement('div');
        header.className = 'text-editor-field-header';

        const label = document.createElement('label');
        label.htmlFor = inputId;
        label.className = 'text-editor-field-label';
        label.textContent = field.label;
        header.appendChild(label);

        const badge = createMissingBadge(field.key);
        header.appendChild(badge);

        const format = document.createElement('span');
        format.className = 'text-editor-badge';
        format.textContent = field.format.replace('_', ' ');
        header.appendChild(format);
        wrapper.appendChild(header);

        const help = document.createElement('p');
        help.className = 'hint text-editor-help';
        help.textContent = field.help_text || '';
        wrapper.appendChild(help);

        const textarea = document.createElement('textarea');
        textarea.id = inputId;
        textarea.className = 'text-editor-input';
        textarea.rows = field.format === 'inline_markdown' ? 2 : 6;
        textarea.spellcheck = true;
        textarea.value = fieldValue(field.key, state.activeLanguage);
        wrapper.appendChild(textarea);

        const meta = document.createElement('div');
        meta.className = 'text-editor-field-meta';

        const count = document.createElement('span');
        count.className = 'text-editor-count';
        count.textContent = `${textarea.value.length} characters`;
        meta.appendChild(count);

        if (state.activeLanguage !== state.defaultLanguage) {
            const defaultText = fieldValue(field.key, state.defaultLanguage);
            if (defaultText.trim()) {
                const copy = document.createElement('button');
                copy.type = 'button';
                copy.className = 'text-editor-link-btn';
                copy.textContent = `Copy from ${state.defaultLanguage.toUpperCase()}`;
                copy.addEventListener('click', () => {
                    textarea.value = defaultText;
                    const map = { ...(state.values[field.key] || {}) };
                    map[state.activeLanguage] = defaultText;
                    state.values[field.key] = map;
                    count.textContent = `${textarea.value.length} characters`;
                    markDirty(field.key);
                    renderAll();
                });
                meta.appendChild(copy);
            }
        }

        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'text-editor-link-btn';
        clear.textContent = 'Clear all languages';
        clear.addEventListener('click', () => {
            const map = { ...(state.values[field.key] || {}) };
            for (const language of state.supportedLanguages) {
                map[language] = '';
            }
            state.values[field.key] = map;
            markDirty(field.key);
            renderAll();
        });
        meta.appendChild(clear);

        wrapper.appendChild(meta);

        textarea.addEventListener('input', () => {
            const map = { ...(state.values[field.key] || {}) };
            map[state.activeLanguage] = textarea.value;
            state.values[field.key] = map;
            count.textContent = `${textarea.value.length} characters`;

            const missing = missingLanguages(state.values[field.key]);
            if (missing.length) {
                badge.className = 'text-editor-badge text-warn';
                badge.textContent = `Missing ${missing.join(', ')}`;
            } else if (normalizedField(state.values[field.key])) {
                badge.className = 'text-editor-badge text-ok';
                badge.textContent = 'Complete';
            } else {
                badge.className = 'text-editor-badge';
                badge.textContent = 'Not set';
            }

            markDirty(field.key);
        });

        return wrapper;
    }

    function renderFields() {
        fieldsEl.replaceChildren();

        const groups = [];
        for (const field of state.fields) {
            let group = groups.find((entry) => entry.name === field.group);
            if (!group) {
                group = { name: field.group, fields: [] };
                groups.push(group);
            }
            group.fields.push(field);
        }

        for (const group of groups) {
            const section = document.createElement('section');
            section.className = 'text-editor-group';

            const heading = document.createElement('h3');
            heading.textContent = group.name;
            section.appendChild(heading);

            for (const field of group.fields) {
                section.appendChild(renderField(field));
            }
            fieldsEl.appendChild(section);
        }
    }

    function renderAll() {
        renderLanguageTabs();
        renderFields();
        updateSaveState();
    }

    async function loadTexts() {
        setError('');
        setValidation('');
        setStatusMessage('');
        loadingEl.hidden = false;
        contentEl.hidden = true;

        try {
            const payload = await adminFetch(
                `/api/admin/studies/${encodeURIComponent(studyNameShort)}/texts`
            );
            state.revision = payload.revision;
            state.defaultLanguage = payload.default_language;
            state.supportedLanguages = Array.isArray(payload.supported_languages)
                ? payload.supported_languages
                : [];
            state.fields = Array.isArray(payload.fields) ? payload.fields : [];
            state.values = cloneValues(payload.values);
            state.originalValues = cloneValues(payload.values);
            state.dirtyFields.clear();
            state.activeLanguage = state.supportedLanguages.includes(
                state.defaultLanguage
            )
                ? state.defaultLanguage
                : state.supportedLanguages[0] || '';

            loadingEl.hidden = true;
            contentEl.hidden = false;
            renderAll();
        } catch (error) {
            loadingEl.hidden = true;
            setError(`Could not load study texts: ${error.message}`);
        }
    }

    async function saveTexts() {
        const errors = validationErrors();
        if (errors.length) {
            setValidation(errors.join(' | '));
            return;
        }

        const values = {};
        for (const key of state.dirtyFields) {
            values[key] = normalizedField(state.values[key]);
        }

        state.saving = true;
        updateSaveState();
        setStatusMessage('Saving study texts…');

        try {
            const payload = await adminFetch(
                `/api/admin/studies/${encodeURIComponent(studyNameShort)}/texts`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ revision: state.revision, values }),
                }
            );
            state.revision = payload.revision;
            state.values = cloneValues(payload.values);
            state.originalValues = cloneValues(payload.values);
            state.dirtyFields.clear();
            renderAll();
            setStatusMessage('Study texts saved.', 'ok');
        } catch (error) {
            setStatusMessage(error.message, 'error');
        } finally {
            state.saving = false;
            updateSaveState();
        }
    }

    saveBtn.addEventListener('click', saveTexts);
    reloadBtn.addEventListener('click', () => {
        if (
            state.dirtyFields.size &&
            !window.confirm('Discard unsaved text changes?')
        ) {
            return;
        }
        loadTexts();
    });

    window.addEventListener('beforeunload', (event) => {
        if (!state.dirtyFields.size) {
            return;
        }
        event.preventDefault();
        event.returnValue = '';
    });

    loadTexts();
})();
