import {
    getCurrentTimelineData,
    getCurrentTimelineKey,
    sendData,
    formatTimeHHMM,
    timeToMinutes,
    generateUniqueId,
    createTimeLabel,
    updateTimeLabel,
    positionToMinutes
} from './utils.js';
import { getIsMobile, updateIsMobile } from './globals.js';
import { addNextTimeline, goToPreviousTimeline, renderActivities } from './script.js';
import { DEBUG_MODE } from './constants.js';

// Toast notification system
function showToast(message, type = 'info', duration = 3000) {
    // Remove any existing toasts
    const existingToasts = document.querySelectorAll('.toast');
    existingToasts.forEach(toast => toast.remove());

    // Create new toast
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger show animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Make showToast globally available for debugging and accessibility
window.showToast = showToast;

// Create invisible overlays for disabled buttons to capture real mouse/touch events
function createDisabledButtonOverlay(buttonId) {
    const button = document.getElementById(buttonId);
    if (!button) return;

    // Remove existing overlay if any
    const existingOverlay = document.getElementById(`${buttonId}-overlay`);
    if (existingOverlay) {
        existingOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = `${buttonId}-overlay`;
    overlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: transparent;
        cursor: not-allowed;
        z-index: 10;
        display: none;
    `;

    // Add click handler to overlay
    overlay.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        console.log('Disabled button overlay clicked:', buttonId);

        const message = window.i18n ?
            window.i18n.t('messages.timelineMissing') :
            'There is information missing from this timeline. Would you like to add anything?';
        showToast(message, 'warning', 4000);
    });

    // Add touch handler for mobile
    overlay.addEventListener('touchend', function(e) {
        e.preventDefault();
        e.stopPropagation();

        console.log('Disabled button overlay touched:', buttonId);

        const message = window.i18n ?
            window.i18n.t('messages.timelineMissing') :
            'There is information missing from this timeline. Would you like to add anything?';
        showToast(message, 'warning', 4000);
    });

    // Position overlay directly over the button
    button.style.position = 'relative';
    button.appendChild(overlay);
    return overlay;
}

// Function to update overlay visibility based on button state
function updateDisabledButtonOverlays() {
    const nextBtn = document.getElementById('nextBtn');
    const navBtn = document.getElementById('navSubmitBtn');

    [nextBtn, navBtn].forEach(button => {
        if (button) {
            const overlay = document.getElementById(`${button.id}-overlay`);
            if (button.disabled && overlay) {
                overlay.style.display = 'block';
            } else if (overlay) {
                overlay.style.display = 'none';
            }
        }
    });
}

// Initialize overlays immediately and with intervals
let overlaysInitialized = false;
function initializeOverlays() {
    if (overlaysInitialized) return;
    overlaysInitialized = true;
    console.log('Initializing overlays...');

    // Create overlays for disabled buttons
    createDisabledButtonOverlay('nextBtn');
    createDisabledButtonOverlay('navSubmitBtn');

    // Update overlay visibility initially
    updateDisabledButtonOverlays();

    // Watch for button state changes using MutationObserver
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'disabled') {
                updateDisabledButtonOverlays();
            }
        });
    });

    // Observe both buttons for disabled attribute changes
    const nextBtn = document.getElementById('nextBtn');
    const navBtn = document.getElementById('navSubmitBtn');

    if (nextBtn) {
        observer.observe(nextBtn, { attributes: true, attributeFilter: ['disabled'] });
    }
    if (navBtn) {
        observer.observe(navBtn, { attributes: true, attributeFilter: ['disabled'] });
    }
}

// Try to initialize immediately
setTimeout(initializeOverlays, 100);

// Also try when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeOverlays);
} else {
    initializeOverlays();
}

// Also update overlays periodically as a fallback
setInterval(() => {
    updateDisabledButtonOverlays();

    // Re-create overlays if they don't exist
    if (!document.getElementById('nextBtn-overlay')) {
        createDisabledButtonOverlay('nextBtn');
    }
    if (!document.getElementById('navSubmitBtn-overlay')) {
        createDisabledButtonOverlay('navSubmitBtn');
    }
}, 2000);

// Make the update function globally available for manual calls
window.updateDisabledButtonOverlays = updateDisabledButtonOverlays;

// Modal management
function createModal() {
    // Check if modals already exist
    const existingActivitiesModal = document.getElementById('activitiesModal');
    if (existingActivitiesModal) {
        return existingActivitiesModal;
    }

    // Create custom activity input modal
    const customActivityModal = document.createElement('div');
    customActivityModal.className = 'modal-overlay';
    customActivityModal.id = 'customActivityModal';
    customActivityModal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3 data-i18n="modals.customActivity.title">Enter Custom Activity</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-content">
                <input type="text" id="customActivityInput" maxlength="30" data-i18n-placeholder="modals.customActivity.placeholder" placeholder="Enter your activity (max 30 chars)">
                <div class="button-container">
                    <button id="confirmCustomActivity" class="btn save-btn" data-i18n="buttons.ok">OK</button>
                </div>
            </div>
        </div>
    `;

    customActivityModal.querySelector('.modal-close').addEventListener('click', () => {
        customActivityModal.style.cssText = 'display: none !important';
    });

    customActivityModal.addEventListener('click', (e) => {
        if (e.target === customActivityModal) {
            customActivityModal.style.cssText = 'display: none !important';
        }
    });

    // Create activities modal
    const activitiesModal = document.createElement('div');
    activitiesModal.className = 'modal-overlay';
    activitiesModal.id = 'activitiesModal';
    activitiesModal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3 data-i18n="modals.addActivity.title">Add Activity</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div id="modalActivitiesContainer"></div>
        </div>
    `;

    activitiesModal.querySelector('.modal-close').addEventListener('click', () => {
        activitiesModal.style.cssText = 'display: none !important';
    });

    activitiesModal.addEventListener('click', (e) => {
        if (e.target === activitiesModal) {
            activitiesModal.style.cssText = 'display: none !important';
        }
    });

    // NEW: Add event delegation for handling "Other not listed (enter)" clicks
    const modalActivitiesContainer = activitiesModal.querySelector('#modalActivitiesContainer');
    modalActivitiesContainer.addEventListener('click', (e) => {
        console.log('Activities modal clicked:', e.target);
        if (
            e.target.classList.contains('activity-name') && e.target.classList.contains('custom-input')
        ) {
            console.log('Activities modal triggered by custom-input class:', e.target);
            // Hide the activities modal
            activitiesModal.style.cssText = 'display: none !important';
            // Show the custom activity input modal
            const customActivityModal = document.getElementById('customActivityModal');
            if (customActivityModal) {
                customActivityModal.style.display = 'block';
                // Focus the input field for better user experience
                const customActivityInput = document.getElementById('customActivityInput');
                if (customActivityInput) {
                    customActivityInput.focus();
                }
            }
            e.stopPropagation();
        }
    });

    // Create confirmation modal
    const confirmationModal = document.createElement('div');
    confirmationModal.className = 'modal-overlay';
    confirmationModal.id = 'confirmationModal';
    const numStudyDaysCount = window.studyConfigManager?.getStudyDaysCount() || 1;
    const urlParams = new URLSearchParams(window.location.search);
    const currentDayIndex = parseInt(urlParams.get('day_label_index')) || 0;
    const dayLabel = window.studyConfigManager?.getDayDisplayLabel(currentDayIndex)
        || window.studyConfigManager?.getDayLabel(currentDayIndex)
        || `day_${currentDayIndex + 1}`;
    const isLastStudyDay = currentDayIndex >= numStudyDaysCount - 1;

    const studyEndInfo = isLastStudyDay ? ' This submission concludes the study.' : '';
    const infoOnTemplateDate = isLastStudyDay ? studyEndInfo : 'For the next day, you will see the data you entered for today as a template to help you report more easily. Please adapt it as needed.<br /><br/> Remember that you can delete data by long-pressing or hovering over the activity in the timeline with the mouse cursor and pressing \'d\' or DEL.';
    const buttonSubmitText = isLastStudyDay ? `Submit Day ${dayLabel} and Finish Study` : `Submit Day ${dayLabel}`;
    confirmationModal.innerHTML = `
        <div class="modal">
            <div class="modal-content">
                <h3 data-i18n-disabled="modals.confirmSubmit.title">Submit data for ${dayLabel} (day ${currentDayIndex + 1} of ${numStudyDaysCount})?</h3>
                <p data-i18n-disabled="modals.confirmSubmit.message">You will not be able to change your responses for day ${dayLabel}.</p>
                <p data-i18n-disabled="modals.confirmSubmit.infoOnTemplate" data-i18n-options='{"dayLabel": "${dayLabel}"}'>${infoOnTemplateDate}</p>
                <div class="button-container">
                    <button id="confirmCancel" class="btn btn-secondary" data-i18n="buttons.cancel">Cancel</button>
                    <button id="confirmOk" class="btn save-btn" data-i18n-disabled="buttons.ok">${buttonSubmitText}</button>
                </div>
            </div>
        </div>
    `;

    confirmationModal.querySelector('#confirmCancel').addEventListener('click', () => {
        confirmationModal.style.cssText = 'display: none !important';
    });

    confirmationModal.querySelector('#confirmOk').addEventListener('click', async () => {
        confirmationModal.style.cssText = 'display: none !important';
        showLoadingModal();

        const nextButton = document.getElementById('nextBtn');
        const navSubmitButton = document.getElementById('navSubmitBtn');

        if (nextButton) {
            nextButton.disabled = true;
        }
        if (navSubmitButton) {
            navSubmitButton.disabled = true;
        }

        // Get current day index
        const urlParams = new URLSearchParams(window.location.search);
        const currentDayIndex = parseInt(urlParams.get('day_label_index')) || 0;
        const totalDays = window.studyConfigManager?.getStudyDaysCount() || 1;
        const isLastDay = currentDayIndex >= totalDays - 1;

        // Send data with redirect flag
        const result = await sendData({
            mode: 'json',
            shouldRedirect: true,
            isLastDay: isLastDay,
            currentDayIndex: currentDayIndex
        });

        if (!result?.success) {
            const submitErrorMessage = window.i18n
                ? window.i18n.t('messages.submitError')
                : 'Error submitting diary';
            const errorDetails = result?.error ? `: ${result.error}` : '';
            showToast(`${submitErrorMessage}${errorDetails}`, 'error', 5000);
            updateButtonStates();
        }
    });

    const skipConfirmationModal = document.createElement('div');
    skipConfirmationModal.className = 'modal-overlay';
    skipConfirmationModal.id = 'skipConfirmationModal';
    skipConfirmationModal.innerHTML = `
        <div class="modal">
            <div class="modal-content">
                <h3 data-i18n="modals.confirmSkip.title">Do you really want to skip all time reporting?</h3>
                <p data-i18n="modals.confirmSkip.message">You will be taken directly to the thank-you page.</p>
                <div class="button-container">
                    <button id="confirmSkipCancel" class="btn btn-secondary" data-i18n="buttons.cancel">Cancel</button>
                    <button id="confirmSkipOk" class="btn save-btn" data-i18n="buttons.ok">OK</button>
                </div>
            </div>
        </div>
    `;

    skipConfirmationModal.querySelector('#confirmSkipCancel').addEventListener('click', () => {
        skipConfirmationModal.style.cssText = 'display: none !important';
    });

    skipConfirmationModal.querySelector('#confirmSkipOk').addEventListener('click', () => {
        skipConfirmationModal.style.cssText = 'display: none !important';
        redirectToThankYouPage();
    });

    skipConfirmationModal.addEventListener('click', (e) => {
        if (e.target === skipConfirmationModal) {
            skipConfirmationModal.style.cssText = 'display: none !important';
        }
    });

    // Create loading modal
    const loadingModal = document.createElement('div');
    loadingModal.className = 'modal-overlay';
    loadingModal.id = 'loadingModal';
    loadingModal.innerHTML = `
        <div class="modal loading-modal">
            <div class="modal-content">
                <div class="loading-spinner"></div>
                <h3 data-i18n="modals.loading.title">Submitting your diary...</h3>
                <p data-i18n="modals.loading.message">Please wait while we save your responses.</p>
            </div>
        </div>
    `;

    document.body.appendChild(activitiesModal);
    document.body.appendChild(confirmationModal);
    document.body.appendChild(skipConfirmationModal);
    document.body.appendChild(loadingModal);
    document.body.appendChild(customActivityModal);

    // Apply translations to the newly created modal elements
    if (window.i18n && window.i18n.isReady()) {
        window.i18n.applyTranslations();
    }

    return activitiesModal;
}

// Button management
function createFloatingAddButton() {
    // Check if floating button already exists
    const existingButton = document.querySelector('.floating-add-button');
    if (existingButton) {
        return existingButton;
    }

    const button = document.createElement('button');
    button.className = 'floating-add-button';
    button.innerHTML = '+';
    button.title = window.i18n ? window.i18n.t('modals.addActivity.title') : 'Add Activity';

    const modal = createModal();

    button.addEventListener('click', () => {
        modal.style.display = 'block';
        const currentKey = getCurrentTimelineKey();
        const categories = window.timelineManager.metadata[currentKey].categories;
        renderActivities(categories, document.getElementById('modalActivitiesContainer'));

        if (getIsMobile()) {
            const firstCategory = modal.querySelector('.activity-category');
            if (firstCategory) {
                firstCategory.classList.add('active');
            }
        }
    });

    document.body.appendChild(button);

    // Initialize the footer and header heights
    updateFooterHeight();
    updateHeaderHeight();

    // Add resize observer to update footer height when it changes
    const footer = document.getElementById('instructionsFooter');
    if (footer) {
        const resizeObserver = new ResizeObserver(() => {
            updateFooterHeight();
        });
        resizeObserver.observe(footer);
    }

    // Add resize observer to update header height when it changes
    const header = document.querySelector('.header-section');
    if (header) {
        const resizeObserver = new ResizeObserver(() => {
            updateHeaderHeight();
        });
        resizeObserver.observe(header);
    }

    return button;
}

function updateFloatingButtonPosition() {
    if (!getIsMobile()) return;

    const floatingButton = document.querySelector('.floating-add-button');
    const lastTimelineWrapper = document.querySelector('.last-initialized-timeline-wrapper');

    if (!floatingButton || !lastTimelineWrapper) return;

    // Get the active timeline container within the wrapper
    const activeTimelineContainer = lastTimelineWrapper.querySelector('.timeline-container');
    if (!activeTimelineContainer) return;

    const containerRect = activeTimelineContainer.getBoundingClientRect();
    const buttonWidth = floatingButton.offsetWidth;

    // Position the button 15px to the right of the active timeline container
    const leftPosition = containerRect.right + 15;

    // Ensure button doesn't go off screen (leave 10px margin from screen edge)
    const maxLeft = window.innerWidth - buttonWidth - 10;
    const finalLeft = Math.min(leftPosition, maxLeft);

    // Only update if the calculated position is valid (not negative)
    if (finalLeft >= 0) {
        floatingButton.style.left = `${finalLeft}px`;
    }
}


// Add this function to update the day display
export function updateCurrentDayDisplay() {
    console.log('Updating current day display...');
    // Get current day index from URL or default
    const urlParams = new URLSearchParams(window.location.search);
    const dayIndex = parseInt(urlParams.get('day_label_index')) || 0;

    // Get day labels from study config or timelineManager
    const dayLabels = window.timelineManager?.dayLabels ||
                     window.studyConfigManager?.getDayLabels() ||
                     [];

    // Get study days count
    const studyDaysCount = window.timelineManager?.studyDaysCount ||
                          window.studyConfigManager?.getStudyDaysCount() ||
                          1;

    // Determine day name — use getDayDisplayLabel so display_names translations
    // from studies_config.json are respected for the current language.
    const fallbackDayWord = window.i18n ? window.i18n.t('common.day') : 'Day';
    let dayName = window.studyConfigManager?.getDayDisplayLabel(dayIndex);
    if (!dayName || /^day_\d+$/i.test(String(dayName))) {
        // getDayDisplayLabel returned a generic placeholder — try raw label as last resort
        dayName = (dayLabels.length > dayIndex)
            ? (dayLabels[dayIndex]?.display_name || dayLabels[dayIndex]?.name || `${fallbackDayWord} ${dayIndex + 1}`)
            : `${fallbackDayWord} ${dayIndex + 1}`;
    }

    console.log('[TRAC day-label-debug] updateCurrentDayDisplay resolved', {
        dayIndex,
        dayName,
        selected_language: window.studyConfigManager?.getSelectedLanguage?.(),
        dayLabelRaw: dayLabels[dayIndex] || null,
        dayLabelsCount: Array.isArray(dayLabels) ? dayLabels.length : 0,
    });

    console.log('############################ Current day index:', dayIndex, " Current Day Name:", dayName, 'Total study days:', studyDaysCount);

    // Create or update the display element
    let dayDisplay = document.getElementById('currentDayDisplay');

    if (!dayDisplay) {
        //console.log('Creating current day display element...');
        // Create the element if it doesn't exist
        dayDisplay = document.createElement('div');
        dayDisplay.id = 'currentDayDisplay';
        dayDisplay.className = 'current-day-display';

        // Add CSS styles
        const style = document.createElement('style');
        style.textContent = `
            .current-day-display {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 8px 16px;
                border-radius: 5px;
                font-weight: 600;
                font-size: 14px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                margin: 0 10px;
                min-width: 120px;
                text-align: center;
                border: 2px solid rgba(255,255,255,0.2);
            }

            .current-day-display .day-name {
                font-size: 16px;
                margin-right: 4px;
                margin-left: 4px;
            }

            .current-day-display .day-index {
                font-size: 12px;
                opacity: 0.9;
                background: rgba(255,255,255,0.2);
                padding: 2px 6px;
                border-radius: 10px;
                margin-left: 4px;
            }

            /* For mobile responsiveness */
            @media (max-width: 768px) {
                .current-day-display {
                    padding: 6px 12px;
                    font-size: 12px;
                    min-width: 100px;
                    margin: 5px auto;
                    order: 2; /* Adjust order if needed */
                }

                .current-day-display .day-name {
                    font-size: 14px;
                }

                .current-day-display .day-index {
                    font-size: 10px;
                }
            }
        `;
        document.head.appendChild(style);

        // Find a good place to insert it - perhaps in the timeline-header
        const timelineHeader = document.querySelector('.timeline-header');
        if (timelineHeader) {
            timelineHeader.appendChild(dayDisplay);
        } else {
            // Fallback to header or create a container
            const header = document.querySelector('header');
            if (header) {
                header.appendChild(dayDisplay);
            } else {
                // Insert at the beginning of body
                document.body.insertBefore(dayDisplay, document.body.firstChild);
            }
        }
    }

    const reportingForDayText = window.i18n
        ? window.i18n.t('messages.reportingForDay')
        : 'Reporting for day:';
    const studyDayText = window.i18n
        ? window.i18n.t('messages.studyDayOf', { current: dayIndex + 1, total: studyDaysCount })
        : `Study Day ${dayIndex + 1} of ${studyDaysCount}`;

    // Update the content
    dayDisplay.innerHTML = `
        <span>${reportingForDayText}</span>${' '}
        <span class="day-name"> ${dayName} </span>
        <span class="day-index">${studyDayText}</span>
    `;

    // Add title for hover/tap info
    dayDisplay.title = window.i18n
        ? window.i18n.t('messages.currentDayTooltip', { dayName, current: dayIndex + 1, total: studyDaysCount })
        : `Current: ${dayName} (Day ${dayIndex + 1} of ${studyDaysCount})`;

    return dayDisplay;
}




function updateButtonStates() {
    //console.log('=== updateButtonStates START ===');
    //console.log('Current index:', window.timelineManager.currentIndex);
    //console.log('Total keys:', window.timelineManager.keys);
    //console.log('Keys length:', window.timelineManager.keys.length);

    updateCurrentDayDisplay();

    const undoButton = document.getElementById('undoBtn');
    const cleanRowButton = document.getElementById('cleanRowBtn');
    const nextButtonInTopBar = document.getElementById('nextBtn');
    const backButton = document.getElementById('backBtn');
    const lowerNavSubmitBtn = document.getElementById('navSubmitBtn');

    const currentData = getCurrentTimelineData();
    const isEmpty = currentData.length === 0;

    //console.log('Current data length:', currentData.length);
    //console.log('Is empty:', isEmpty);

    // Check if there's an active timeline with activities
    const activeTimeline = window.timelineManager.activeTimeline;
    const hasActivities = activeTimeline && activeTimeline.querySelector('.activity-block');

    //console.log('Has activities DOM:', hasActivities);

    if (undoButton) undoButton.disabled = isEmpty;
    if (cleanRowButton) cleanRowButton.disabled = !hasActivities;

    // Update Back button state - enable if not on first timeline
    if (backButton) {
        backButton.disabled = window.timelineManager.currentIndex <= 0;
        //console.log('Back button disabled:', backButton.disabled);
    }

    // Get current timeline coverage
    const currentKey = getCurrentTimelineKey();
    // console.log('Current key:', currentKey);

    const currentTimeline = window.timelineManager.metadata[currentKey];
    //console.log('Current timeline metadata:', currentTimeline);

    const currentCoverage = window.getTimelineCoverage() || 0;
    console.log('Current coverage:', currentCoverage, " from window.getTimelineCoverage:", window.getTimelineCoverage());

    // Get minimum coverage requirement for current timeline
    const minCoverage = parseInt(currentTimeline?.minCoverage) || 0;
    const meetsMinCoverage = currentCoverage >= minCoverage;

    console.log('Min coverage:', minCoverage, 'Meets min:', meetsMinCoverage);

    // Check if we're on the last timeline
    const totalTimelines = window.timelineManager.keys.length;
    const isLastTimeline = window.timelineManager.currentIndex === totalTimelines - 1;

    //console.log('Total timelines:', totalTimelines);
    //console.log('Is last timeline:', isLastTimeline);

    const getCoverageForTimeline = (timelineKey) => {
        const activities = window.timelineManager.activities[timelineKey] || [];
        return activities.reduce((total, activity) => {
            const blockLength = parseInt(activity?.blockLength) || 0;
            return total + blockLength;
        }, 0);
    };

    const allTimelinesMeetMinCoverage = window.timelineManager.keys.every((timelineKey) => {
        const timelineMetadata = window.timelineManager.metadata[timelineKey];
        const timelineMinCoverage = parseInt(timelineMetadata?.minCoverage) || 0;
        const timelineCoverage = getCoverageForTimeline(timelineKey);
        return timelineCoverage >= timelineMinCoverage;
    });

    const canProceed = isLastTimeline ? allTimelinesMeetMinCoverage : meetsMinCoverage;

    // Get text values for buttons
    const nextTextTopBarButton = window.i18n ? window.i18n.t('buttons.next') : 'Next Timeline';
    const nextTextLowerSubmitButton = window.i18n ? window.i18n.t('buttons.next') : 'Next Timeline';
    const submitText = window.i18n ? window.i18n.t('buttons.submit') : 'Submit Day';

    //console.log('Button texts - Next:', nextTextTopBarButton, 'Submit:', submitText);

    if (nextButtonInTopBar) {
        //console.log('Next button before update - disabled:', nextButtonInTopBar.disabled, 'innerHTML:', nextButtonInTopBar.innerHTML);

        nextButtonInTopBar.disabled = !canProceed;

        if (isLastTimeline) {
            // On last timeline, show Submit
            nextButtonInTopBar.innerHTML = `<i class="fas fa-check"></i> ${submitText}`;
            //console.log('Setting Next button to SUBMIT mode');
        } else {
            // For other timelines, show Next
            nextButtonInTopBar.innerHTML = `${nextTextTopBarButton} <i class="fas fa-arrow-right"></i>`;
            //console.log('Setting Next button to NEXT mode');
        }

        //console.log('Next button after update - disabled:', nextButtonInTopBar.disabled, 'innerHTML:', nextButtonInTopBar.innerHTML);
    }

    // Update navSubmitBtn to mirror nextButton exactly
    if (lowerNavSubmitBtn) {
        //console.log('Nav button before update - disabled:', lowerNavSubmitBtn.disabled);

        lowerNavSubmitBtn.disabled = !canProceed;

        // Find the span element inside navSubmitBtn
        const navSubmitIcon = lowerNavSubmitBtn.querySelector('i');
        const navSubmitSpan = lowerNavSubmitBtn.querySelector('span');

        if (isLastTimeline) {
            // On last timeline, show Submit with green color
            if (navSubmitSpan) {
                navSubmitSpan.textContent = submitText;
            }
            if (navSubmitIcon) {
                navSubmitIcon.className = 'fas fa-check'; // Check icon for submit
            }
            lowerNavSubmitBtn.classList.add('submit-mode');
            //console.log('Setting lower Nav button to SUBMIT mode');
        } else {
            // For other timelines, show Next with blue color
            if (navSubmitSpan) {
                navSubmitSpan.textContent = nextTextLowerSubmitButton;
            }
            if (navSubmitIcon) {
                navSubmitIcon.className = 'fas fa-arrow-right'; // Arrow icon for next
            }
            lowerNavSubmitBtn.classList.remove('submit-mode');
            //console.log('Setting lower Nav button to NEXT mode');
        }

        //console.log('Nav button after update - disabled:', lowerNavSubmitBtn.disabled);
    }
}

function redirectToThankYouPage() {
    const redirectUrl = window.timelineManager?.general?.primary_redirect_url || 'thank-you.html';
    const currentParams = new URLSearchParams(window.location.search);
    currentParams.set('completion_status', 'skipped');
    const separator = redirectUrl.includes('?') ? '&' : '?';
    const finalUrl = redirectUrl + (currentParams.toString() ? separator + currentParams.toString() : '');
    window.location.href = finalUrl;
}

function showSkipConfirmationModal() {
    createModal();
    const skipConfirmationModal = document.getElementById('skipConfirmationModal');
    if (skipConfirmationModal) {
        skipConfirmationModal.style.display = 'block';
    }
}

let skipReportingButtonInitialized = false;
function initSkipReportingButton() {
    if (skipReportingButtonInitialized) {
        return;
    }

    const skipReportingBtn = document.getElementById('skipReportingBtn');
    if (!skipReportingBtn) {
        return;
    }

    skipReportingBtn.addEventListener('click', showSkipConfirmationModal);
    skipReportingButtonInitialized = true;
}



// Shared debounce variables for both Next button and navigation submit button
let nextButtonLastClick = 0;
const NEXT_BUTTON_COOLDOWN = 500; // 1 second cooldown

// Debounce variables for Back button
let backButtonLastClick = 0;
const BACK_BUTTON_COOLDOWN = 500; // 1 second cooldown (shorter than Next)

// Debounce variables for Undo button
let undoButtonLastClick = 0;
const UNDO_BUTTON_COOLDOWN = 300; // 300ms cooldown

// Shared function to handle Next button logic with debounce
const handleNextButtonAction = () => {
    const currentTime = Date.now();
    if (currentTime - nextButtonLastClick < NEXT_BUTTON_COOLDOWN) {
        console.log('Next button on cooldown');
        return;
    }
    nextButtonLastClick = currentTime;

    const isLastTimeline = window.timelineManager.currentIndex === window.timelineManager.keys.length - 1;

    if (isLastTimeline) {
        // On last timeline, show confirmation modal
        document.getElementById('confirmationModal').style.display = 'block';
    } else {
        // For other timelines, proceed to next timeline
        addNextTimeline();
        window.selectedActivity = null;
        document.querySelectorAll('.activity-button.selected').forEach(btn => {
            btn.classList.remove('selected');
        });
    }
};

// Shared function to handle Back button logic with debounce
const handleBackButtonAction = () => {
    const currentTime = Date.now();
    if (currentTime - backButtonLastClick < BACK_BUTTON_COOLDOWN) {
        console.log('Back button on cooldown');
        return;
    }
    backButtonLastClick = currentTime;

    if (window.timelineManager.currentIndex > 0) {
        goToPreviousTimeline();
    }
};

// Shared function to handle Undo button logic with debounce
const handleUndoButtonAction = () => {
    const currentTime = Date.now();
    if (currentTime - undoButtonLastClick < UNDO_BUTTON_COOLDOWN) {
        console.log('Undo button on cooldown');
        return;
    }
    undoButtonLastClick = currentTime;

    const currentKey = getCurrentTimelineKey();
    const currentData = getCurrentTimelineData();
    if (currentData.length > 0) {
        if (DEBUG_MODE) {
            console.log('Before undo - timelineData:', window.timelineManager.activities);
        }

        // Work with a copy to avoid modifying the original array until validation passes
        const currentDataCopy = [...currentData];
        const lastActivity = currentDataCopy.pop();

        // Update timeline manager activities and validate
        window.timelineManager.activities[currentKey] = currentDataCopy;
        try {
            window.timelineManager.metadata[currentKey].validate();
        } catch (error) {
            console.error('Timeline validation failed:', error);
            // Revert the change
            window.timelineManager.activities[currentKey] = currentData;
            const timeline = window.timelineManager.activeTimeline;
            const lastBlock = timeline.querySelector(`.activity-block[data-id="${lastActivity.id}"]`);
            if (lastBlock) {
                lastBlock.classList.add('invalid');
                setTimeout(() => lastBlock.classList.remove('invalid'), 400);
            }
            return;
        }

        if (DEBUG_MODE) {
            console.log('Removing activity:', lastActivity);
        }

        const timeline = window.timelineManager.activeTimeline;
        const blocks = timeline.querySelectorAll('.activity-block');

        if (DEBUG_MODE) {
            blocks.forEach(block => {
                console.log('Block id:', block.dataset.id, 'Last activity id:', lastActivity.id);
            });
        }
        blocks.forEach(block => {
            if (block.dataset.id === lastActivity.id) {
                if (DEBUG_MODE) {
                    console.log('Removing block with id:', lastActivity.id);
                }
                block.remove();
            }
        });

        updateButtonStates();

        if (DEBUG_MODE) {
            console.log('Final timelineData:', window.timelineManager.activities);
        }
    }
};

let buttonsInitialized = false;
function initButtons() {
    if (buttonsInitialized) return;
    buttonsInitialized = true;

    initSkipReportingButton();

    const cleanRowBtn = document.getElementById('cleanRowBtn');
    const navSubmitBtn = document.getElementById('navSubmitBtn');

    // Initialize the navigation submit button with proper debounce
    if (navSubmitBtn) {
        // Allow pointer events on disabled button to show toast
        navSubmitBtn.style.pointerEvents = 'auto';

        navSubmitBtn.addEventListener('click', () => {
            const nextBtn = document.getElementById('nextBtn');

            // Check if the Next button is disabled
            if (nextBtn && nextBtn.disabled) {
                // Show toast message when trying to click disabled nav button
                const message = window.i18n ?
                    window.i18n.t('messages.timelineMissing') :
                    'There is information missing from this timeline. Would you like to add anything?';
                showToast(message, 'warning', 4000);
                return;
            }

            if (nextBtn && !nextBtn.disabled) {
                // Use the shared debounced function instead of programmatic click
                handleNextButtonAction();
            }
        });
    }

    cleanRowBtn.addEventListener('click', () => {
        const currentKey = getCurrentTimelineKey();
        const currentData = getCurrentTimelineData();
        if (currentData.length > 0) {
            // Get the activities container of the active timeline
            const activeTimeline = window.timelineManager.activeTimeline;
            const activitiesContainer = activeTimeline.querySelector('.activities');

            if (activitiesContainer) {
                // Remove all activity blocks from the DOM
                while (activitiesContainer.firstChild) {
                    activitiesContainer.removeChild(activitiesContainer.firstChild);
                }
            }

            // Clear the activities data for current timeline
            window.timelineManager.activities[currentKey] = [];

            try {
                window.timelineManager.metadata[currentKey].validate();
            } catch (error) {
                console.error('Timeline validation failed:', error);
                const validationErrorMessage = window.i18n
                    ? window.i18n.t('messages.timelineValidationError', { message: error.message })
                    : `Timeline validation error: ${error.message}`;
                alert(validationErrorMessage);
                return;
            }

            updateButtonStates();

            if (DEBUG_MODE) {
                console.log('Timeline data after clean:', window.timelineManager.activities);
            }
        }
    });


    // Add click handler for Undo button using debounced function
    document.getElementById('undoBtn').addEventListener('click', handleUndoButtonAction);

    // Add click handler for Next button
    const nextBtn = document.getElementById('nextBtn');

    // Allow pointer events on disabled button to show toast
    nextBtn.style.pointerEvents = 'auto';

    nextBtn.addEventListener('click', function(e) {
        // Check if button is disabled
        if (nextBtn.disabled) {
            e.preventDefault();
            e.stopPropagation();
            // Show toast message when disabled button is clicked
            const message = window.i18n ?
                window.i18n.t('messages.timelineMissing') :
                'There is information missing from this timeline. Would you like to add anything?';
            showToast(message, 'warning', 4000);
            return;
        }

        // Otherwise proceed with normal action
        handleNextButtonAction();
    });

    // Add click handler for Back button using shared debounced function
    document.getElementById('backBtn').addEventListener('click', handleBackButtonAction);

    // Disable back button initially
    const backButton = document.getElementById('backBtn');
    if (backButton) {
        backButton.disabled = true;
    }
}

initSkipReportingButton();

// Debug overlay functions
function updateDebugOverlay(mouseX, mouseY, timelineRect) {
    const debugOverlay = document.getElementById('debugOverlay');
    if (!debugOverlay) return;

    const isMobile = getIsMobile();

    // In mobile mode, if no timelineRect is provided, get it from active timeline
    if (isMobile && !timelineRect) {
        const activeTimeline = window.timelineManager.activeTimeline;
        if (!activeTimeline) return;
        timelineRect = activeTimeline.getBoundingClientRect();
    }

    let positionPercent, axisPosition, axisSize;

    // Get viewport and header dimensions
    const viewportHeight = window.innerHeight;
    const headerSection = document.querySelector('.header-section');
    const headerBottom = headerSection ? headerSection.getBoundingClientRect().bottom : 0;

    // Calculate available height (space between header bottom and viewport bottom)
    const availableHeight = viewportHeight - headerBottom;

    // Calculate normalized distances relative to available height
    const distanceToBottom = (viewportHeight - mouseY) / availableHeight;
    const distanceToHeader = (mouseY - headerBottom) / availableHeight;

    if (isMobile) {
        // Vertical layout calculations
        const relativeY = mouseY - timelineRect.top;
        positionPercent = (relativeY / timelineRect.height) * 100;
        axisPosition = Math.round(relativeY);
        axisSize = Math.round(timelineRect.height);
    } else {
        // Horizontal layout calculations
        const relativeX = mouseX - timelineRect.left;
        positionPercent = (relativeX / timelineRect.width) * 100;
        axisPosition = Math.round(relativeX);
        axisSize = Math.round(timelineRect.width);
    }

    const minutes = positionToMinutes(positionPercent, isMobile);
    // Format time - no need to adjust minutes since formatTimeHHMM now handles the offset
    const timeString = formatTimeHHMM(minutes);

    debugOverlay.innerHTML = isMobile
        ? `Mouse Position: ${axisPosition}px<br>
           Timeline Height: ${axisSize}px<br>
           Position: ${positionPercent.toFixed(2)}%<br>
           Time: ${timeString}<br>
           Distance to Bottom: ${distanceToBottom.toFixed(3)}<br>
           Distance to Header: ${distanceToHeader.toFixed(3)}`
        : `Mouse Position: ${axisPosition}px<br>
           Timeline Width: ${axisSize}px<br>
           Position: ${positionPercent.toFixed(2)}%<br>
           Time: ${timeString}<br>
           Distance to Bottom: ${distanceToBottom.toFixed(3)}<br>
           Distance to Header: ${distanceToHeader.toFixed(3)}`;
}

// Initialize continuous debug overlay updates for mobile layout
function initDebugOverlay() {
    if (!DEBUG_MODE) return;

    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 50; // Update every 50ms

    // Function to handle both mouse and touch events
    const handleMove = (e) => {
        const currentTime = Date.now();
        if (getIsMobile() && currentTime - lastUpdateTime > UPDATE_INTERVAL) {
            // Get coordinates from either mouse or touch event
            const x = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const y = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
            updateDebugOverlay(x, y);
            lastUpdateTime = currentTime;
        }
    };

    // Add both mouse and touch event listeners
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('touchmove', handleMove);
}

function hideDebugOverlay() {
    const debugOverlay = document.getElementById('debugOverlay');
    if (debugOverlay) {
        debugOverlay.innerHTML = '';
    }
}

function updateGradientBarLayout() {
    const gradientBar = document.querySelector('.gradient-bar');
    if (gradientBar) {
        gradientBar.setAttribute('data-layout', getIsMobile() ? 'vertical' : 'horizontal');
    }
}

// Helper function to scroll to active timeline
function scrollToActiveTimeline() {
    if (!window.timelineManager.activeTimeline) return;

    const activeTimeline = window.timelineManager.activeTimeline.closest('.timeline-container');
    if (!activeTimeline) return;

    if (getIsMobile()) {
        // Mobile: horizontal scroll
        const timelinesWrapper = document.querySelector('.timelines-wrapper');
        if (timelinesWrapper) {
            // Check if wrapper has scrollable overflow
            const hasScrollableOverflow = timelinesWrapper.scrollWidth > timelinesWrapper.clientWidth;

            if (hasScrollableOverflow) {
                // Calculate if timeline is partially or fully hidden
                const timelineRect = activeTimeline.getBoundingClientRect();
                const wrapperRect = timelinesWrapper.getBoundingClientRect();

                // Check if timeline is not fully visible
                const isPartiallyHidden =
                    timelineRect.left < wrapperRect.left ||
                    timelineRect.right > wrapperRect.right;

                if (isPartiallyHidden) {
                    // Scroll to make timeline fully visible
                    timelinesWrapper.scrollTo({
                        left: activeTimeline.offsetLeft,
                        behavior: 'smooth'
                    });
                }
            }
        }
    } else {
        // Desktop: vertical scroll to center
        const windowHeight = window.innerHeight;
        const timelineRect = activeTimeline.getBoundingClientRect();
        const scrollTarget = window.pageYOffset + timelineRect.top - (windowHeight / 2) + (timelineRect.height / 2);

        window.scrollTo({
            top: scrollTarget,
            behavior: 'smooth'
        });
    }
}

function updateTimelineCountVariable() {
    const pastTimelinesWrapper = document.querySelector('.past-initialized-timelines-wrapper');
    if (!pastTimelinesWrapper) return;

    const timelineCount = pastTimelinesWrapper.querySelectorAll('.timeline-container').length;
    pastTimelinesWrapper.style.setProperty('--timeline-count', timelineCount);
}

// Prevent pull-to-refresh on mobile devices
function preventPullToRefresh() {
    // Only prevent overscroll on iOS Safari and Chrome
    document.body.style.overscrollBehavior = 'none';

    // For iOS Safari - only prevent default when at the top of the page and pulling down
    document.addEventListener('touchstart', function(e) {
        // Store the initial touch position
        window.touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
        const touchY = e.touches[0].clientY;
        const touchYDelta = touchY - window.touchStartY;

        // Only prevent default if we're at the top and trying to pull down
        if (window.pageYOffset === 0 && touchYDelta > 0) {
            e.preventDefault();
        }
    }, { passive: false });
}

function updateFooterHeight() {
    const footer = document.getElementById('instructionsFooter');
    if (footer) {
        const footerHeight = footer.offsetHeight;
        document.documentElement.style.setProperty('--footer-height', `${footerHeight}px`);
    }
}

function updateHeaderHeight() {
    const header = document.querySelector('.header-section');
    if (header) {
        const headerHeight = header.offsetHeight;
        document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
    }
}

function handleResize() {
    // updateIsMobile will now handle the reload at breakpoint
    updateIsMobile();
    // Update floating button position, header height, and footer height
    updateFloatingButtonPosition();
    updateHeaderHeight();
    updateFooterHeight();
}

// Loading modal functions
function showLoadingModal() {
    const loadingModal = document.getElementById('loadingModal');
    if (loadingModal) {
        loadingModal.style.display = 'block';
    }
}

function hideLoadingModal() {
    const loadingModal = document.getElementById('loadingModal');
    if (loadingModal) {
        loadingModal.style.cssText = 'display: none !important';
    }
}

// Initialize UI components
export {
    showToast,
    createModal,
    createFloatingAddButton,
    updateFloatingButtonPosition,
    updateButtonStates,
    initButtons,
    updateDebugOverlay,
    hideDebugOverlay,
    updateGradientBarLayout,
    scrollToActiveTimeline,
    updateTimelineCountVariable,
    initDebugOverlay,
    handleResize,
    preventPullToRefresh,
    updateFooterHeight,
    updateHeaderHeight,
    showLoadingModal,
    hideLoadingModal
};
