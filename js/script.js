import { TimelineMarker } from './timeline_marker.js';
import { Timeline } from './timeline.js';
import { TimelineContainer } from './timeline_container.js';
import i18n from './i18n.js';
import {
    loadActivitiesConfig,
    getCachedActivitiesConfig,
    getTimelineCategories,
} from './activities_config.js';
import {
    getCurrentTimelineData,
    getCurrentTimelineKey,
    createTimelineDataFrame,
    sendData,
    validateMinCoverage,
    getTimelineCoverage,
    calculateTimeDifference,
    syncURLParamsToStudy
} from './utils.js';
import { updateIsMobile, getIsMobile } from './globals.js';
import {
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
    updateHeaderHeight,
    updateFooterHeight
} from './ui.js';
import {
    DEBUG_MODE,
    MINUTES_PER_DAY,
    INCREMENT_MINUTES,
    DEFAULT_ACTIVITY_LENGTH,
    TIMELINE_START_HOUR,
    TIMELINE_HOURS
} from './constants.js';
import { checkAndRequestPID } from './utils.js';

// Make window.selectedActivity a global property that persists across DOM changes
window.selectedActivity = null;

// Single timeline management object
window.timelineManager = {
    metadata: {}, // Timeline metadata (former timelines object)
    activities: {}, // Timeline activities (former timelineData object)
    initialized: new Set(), // Tracks initialized timelines
    activeTimeline: null, // Will be set when first timeline is created
    keys: [], // Available timeline keys
    currentIndex: 0, // Current timeline index
    study: {}, // Store URL parameters
    general: {} // Store general configuration
};

// Additional context for custom input activities: manages free text input state for top-level or child items
window.customInputContext = {
    type: null, // 'topLevel' or 'childItem'
    parentActivity: null,
    categoryName: null
};

function clearSelectedActivityButtons() {
    document.querySelectorAll('.activity-button.selected').forEach(btn => {
        btn.classList.remove('selected');
    });
}

function clearActiveActivitySelection() {
    clearSelectedActivityButtons();
    window.selectedActivity = null;
}

function setSingleActiveActivityButton(activityButton) {
    clearSelectedActivityButtons();
    if (activityButton) {
        activityButton.classList.add('selected');
    }
}

function activityIdsEqual(leftId, rightId) {
    return String(leftId) === String(rightId);
}

// Function to calculate timeline coverage in minutes
window.getTimelineCoverage = getTimelineCoverage;

import {
    formatTimeHHMM,
    timeToMinutes,
    findNearestMarkers,
    minutesToPercentage,
    positionToMinutes,
    calculateMinimumBlockWidth,
    hasOverlap,
    canPlaceActivity,
    isTimelineFull,
    isOverlapping,
    generateUniqueId,
    createTimeLabel,
    updateTimeLabel
} from './utils.js';


function initInstructionBanner() {
    const banner = document.getElementById('instructionBanner');
    if (!banner) return;

    const bannerStorageKey = getInstructionBannerStorageKey();

    if (getCurrentDayIndex() !== 0) {
        banner.remove();
        return;
    }

    // Check if user has already closed the banner (using localStorage)
    const bannerClosed = localStorage.getItem(bannerStorageKey);
    if (bannerClosed === 'true') {
        banner.remove();
        return;
    }

    banner.style.display = 'block';

    // Set up close button
    const closeBtn = banner.querySelector('.banner-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            banner.style.display = 'none';
            localStorage.setItem(bannerStorageKey, 'true');
        });
    }
}

function getInstructionBannerStorageKey() {
    const urlParams = new URLSearchParams(window.location.search);
    const pid = urlParams.get('pid') || 'anonymous';
    const studyName = urlParams.get('study_name') || TUD_SETTINGS.DEFAULT_STUDY_NAME;
    return `instructionBannerClosed:${studyName}:${pid}:day1`;
}


// Init keyboard shortcuts for deleting activity blocks.
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
        // Handle both 'd' key (case insensitive) and 'Delete' key
        const isDKey = event.key.toLowerCase() === 'd';
        const isDeleteKey = event.key === 'Delete' || event.key === 'Del';

        if (!isDKey && !isDeleteKey) return;

        // Don't trigger if user is typing in an input field
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }

        // Find the hovered activity block
        const hoveredActivity = document.querySelector('.activity-block:hover');
        if (!hoveredActivity) return;

        // Only allow deleting from the currently active timeline
        if (hoveredActivity.dataset.timelineKey !== getCurrentTimelineKey()) return;

        // Prevent browser default behavior for Delete key (like navigating back in some browsers)
        if (isDeleteKey) {
            event.preventDefault();
        }

        // Delete the activity immediately
        deleteActivityBlock(hoveredActivity);
    });
}

// Delete activity block function, removes from DOM and timeline manager data.
// Required for editing activities.
function deleteActivityBlock(activityBlock) {
    const activityId = activityBlock.dataset.id;
    const timelineKey = activityBlock.dataset.timelineKey;

    if (!activityId || !timelineKey) {
        console.error('Missing activity data');
        return;
    }

    console.log(`=== DELETING ACTIVITY ${activityId} FROM TIMELINE ${timelineKey} ===`);
    console.log('Before deletion - activities:', window.timelineManager.activities[timelineKey]?.map(a => ({id: a.id, activity: a.activity})));

    // Store reference to the timeline
    const timeline = activityBlock.closest('.timeline');

    // Remove from DOM first
    activityBlock.remove();

    // Remove from timeline manager data
    const timelineActivities = window.timelineManager.activities[timelineKey];
    if (timelineActivities) {
        const index = timelineActivities.findIndex(activity => activityIdsEqual(activity.id, activityId));
        if (index !== -1) {
            timelineActivities.splice(index, 1);

            console.log('After deletion (before reassign) - activities:', window.timelineManager.activities[timelineKey]?.map(a => ({id: a.id, activity: a.activity})));

            // CRITICAL: Ensure the array is properly updated by reassigning
            window.timelineManager.activities[timelineKey] = [...timelineActivities];

            console.log('After deletion (after reassign) - activities:', window.timelineManager.activities[timelineKey]?.map(a => ({id: a.id, activity: a.activity})));
            console.log('Number of remaining activities:', window.timelineManager.activities[timelineKey].length);

            // Force a re-render of the timeline's activities container to ensure clean state
            if (timeline) {
                const activitiesContainer = timeline.querySelector('.activities');
                if (activitiesContainer) {
                    console.log('Re-rendering all remaining activities...');

                    // Get remaining activities
                    const remainingActivities = window.timelineManager.activities[timelineKey];
                    console.log('Remaining activities to render (', remainingActivities.length, "):", remainingActivities.map(a => ({id: a.id, activity: a.activity})));

                    // Clear the container
                    activitiesContainer.innerHTML = '';
                    console.log('Activities container cleared');

                    // Recreate all remaining activity blocks
                    remainingActivities.forEach((activityData, idx) => {
                        console.log(`Rendering activity ${idx + 1}/${remainingActivities.length}:`, activityData.id, activityData.activity);

                        // Make sure the activityData has all required fields
                        if (!activityData.startMinutes || !activityData.endMinutes) {
                            console.error('Activity missing minutes:', activityData);
                            return;
                        }

                        // Use your existing function to recreate blocks
                        const result = recreateActivityBlockFromTemplate(activityData);
                        console.log(`Activity ${idx + 1} rendered, block:`, result.block);
                    });

                    console.log('All ', remainingActivities.length, ' activities re-rendered, container children:', activitiesContainer.children.length);

                    // Re-initialize interact.js for the new blocks
                    initTimelineInteraction(timeline);
                    console.log('Timeline interaction re-initialized');
                } else {
                    console.error('Activities container not found in timeline');
                }
            } else {
                console.error('Timeline element not found');
            }
        } else {
            console.error('Activity not found in timelineActivities array');
        }
    } else {
        console.error('timelineActivities not found for key:', timelineKey);
    }

    // Update button states (coverage might have changed)
    updateButtonStates();
    persistPendingTimelineStateSoon();

    console.log(`=== DELETION COMPLETE ===`);
}

function initMobileDelete() {
    const LONG_PRESS_DURATION = 1200;
    const LONG_PRESS_VISUAL_DELAY = 400;
    const LONG_PRESS_MOVE_PX = 6;

    let pressedActivity = null;
    let pressTimer = null;
    let pressStartTime = 0;
    let pressStartX = 0;
    let pressStartY = 0;
    let visualFrame = null;
    let pointerId = null;
    let deleteTriggered = false;

    document.addEventListener('pointerdown', handlePressStart, { passive: false });
    document.addEventListener('pointermove', handlePressMove, { passive: true });
    document.addEventListener('pointerup', handlePressEnd, { passive: true });
    document.addEventListener('pointercancel', handlePressCancel, { passive: true });

    function getOrCreateLongPressIndicator(activityBlock) {
        let indicator = activityBlock.querySelector('.long-press-delete-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'long-press-delete-indicator';
            activityBlock.appendChild(indicator);
        }
        return indicator;
    }

    function updateVisualProgress() {
        if (!pressedActivity || deleteTriggered) {
            visualFrame = null;
            return;
        }

        const elapsed = Date.now() - pressStartTime;
        const visualWindow = LONG_PRESS_DURATION - LONG_PRESS_VISUAL_DELAY;
        const progress = Math.max(0, Math.min(1, (elapsed - LONG_PRESS_VISUAL_DELAY) / visualWindow));
        const indicator = getOrCreateLongPressIndicator(pressedActivity);

        if (progress > 0) {
            indicator.style.opacity = '1';
            indicator.style.setProperty('--long-press-progress', String(progress));
        } else {
            indicator.style.opacity = '0';
            indicator.style.setProperty('--long-press-progress', '0');
        }

        visualFrame = requestAnimationFrame(updateVisualProgress);
    }

    function clearPressTimer() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }

    function clearVisualFrame() {
        if (visualFrame) {
            cancelAnimationFrame(visualFrame);
            visualFrame = null;
        }
    }

    function cleanupPress() {
        clearPressTimer();
        clearVisualFrame();

        if (pressedActivity) {
            pressedActivity.classList.remove('long-press-delete-armed');
            const indicator = pressedActivity.querySelector('.long-press-delete-indicator');
            if (indicator) {
                indicator.style.opacity = '0';
                indicator.style.setProperty('--long-press-progress', '0');
            }
        }

        pressedActivity = null;
        pointerId = null;
        deleteTriggered = false;
    }

    function handlePressStart(e) {
        if (e.button != null && e.button !== 0) {
            return;
        }

        const activityBlock = e.target.closest('.activity-block');
        if (!activityBlock) {
            return;
        }

        if (activityBlock.dataset.timelineKey !== getCurrentTimelineKey()) {
            return;
        }

        if (e.pointerType === 'touch') {
            e.preventDefault();
        }

        cleanupPress();

        pressedActivity = activityBlock;
        pressStartTime = Date.now();
        pressStartX = e.clientX;
        pressStartY = e.clientY;
        pointerId = e.pointerId;

        pressedActivity.classList.add('long-press-delete-armed');
        const indicator = getOrCreateLongPressIndicator(pressedActivity);
        indicator.style.opacity = '0';
        indicator.style.setProperty('--long-press-progress', '0');

        pressTimer = setTimeout(() => {
            if (!pressedActivity) {
                return;
            }
            deleteTriggered = true;
            const blockToDelete = pressedActivity;
            cleanupPress();
            if (blockToDelete.isConnected) {
                deleteActivityBlock(blockToDelete);
            }
        }, LONG_PRESS_DURATION);

        updateVisualProgress();
    }

    function handlePressMove(e) {
        if (!pressedActivity || pointerId !== e.pointerId) {
            return;
        }

        const deltaX = e.clientX - pressStartX;
        const deltaY = e.clientY - pressStartY;
        if (Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_PX) {
            cleanupPress();
        }
    }

    function handlePressEnd(e) {
        if (pointerId !== e.pointerId) {
            return;
        }
        cleanupPress();
    }

    function handlePressCancel(e) {
        if (pointerId !== e.pointerId) {
            return;
        }
        cleanupPress();
    }
}

function translateOrFallback(key, fallback) {
    if (!window.i18n?.isReady()) {
        return fallback;
    }

    const translation = window.i18n.t(key);
    return translation === key ? fallback : translation;
}

function formatDurationForInfo(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) {
        return '—';
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const hh = String(hours).padStart(2, '0');
    const mm = String(mins).padStart(2, '0');

    return `${minutes} min (${hh}:${mm})`;
}

function getActivityBlockInfo(activityBlock) {
    const timelineKey = activityBlock.dataset.timelineKey;
    const activityId = activityBlock.dataset.id;
    const timelineActivities = window.timelineManager.activities[timelineKey] || [];
    const storedActivity = timelineActivities.find(activity => activityIdsEqual(activity.id, activityId));

    const start = storedActivity?.startTime || activityBlock.dataset.start || '—';
    const end = storedActivity?.endTime || activityBlock.dataset.end || '—';
    const durationMinutes = Number.isFinite(Number(storedActivity?.blockLength))
        ? Number(storedActivity.blockLength)
        : calculateTimeDifference(start, end);
    const label = storedActivity?.parentName
        || activityBlock.querySelector('div[class^="activity-block-text"]')?.textContent?.trim()
        || activityBlock.dataset.tooltipText
        || storedActivity?.activity
        || '—';

    return {
        start,
        end,
        duration: formatDurationForInfo(durationMinutes),
        label,
        category: storedActivity?.category || activityBlock.dataset.category || '—',
        name: storedActivity?.activity || activityBlock.dataset.tooltipText || '—',
        code: storedActivity?.codes || storedActivity?.code || activityBlock.dataset.codes || activityBlock.dataset.code || '—'
    };
}

function ensureActivityInfoModal() {
    let modalOverlay = document.getElementById('activityInfoModal');
    if (modalOverlay) {
        return modalOverlay;
    }

    modalOverlay = document.createElement('div');
    modalOverlay.id = 'activityInfoModal';
    modalOverlay.className = 'modal-overlay';
    modalOverlay.innerHTML = `
        <div class="modal activity-info-modal">
            <div class="modal-header">
                <h3>${translateOrFallback('modals.activityContext.infoTitle', 'Activity details')}</h3>
                <button class="modal-close" type="button" aria-label="${translateOrFallback('buttons.close', 'Close')}">&times;</button>
            </div>
            <div class="modal-content">
                <table class="activity-info-table">
                    <tbody id="activityInfoTableBody"></tbody>
                </table>
            </div>
        </div>
    `;

    const closeModal = () => {
        modalOverlay.style.cssText = 'display: none !important';
    };

    modalOverlay.querySelector('.modal-close').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (event) => {
        if (event.target === modalOverlay) {
            closeModal();
        }
    });

    document.body.appendChild(modalOverlay);
    return modalOverlay;
}

function showActivityInfoModal(activityBlock) {
    if (!activityBlock || !activityBlock.isConnected) {
        return;
    }

    const modalOverlay = ensureActivityInfoModal();
    const tableBody = modalOverlay.querySelector('#activityInfoTableBody');
    const info = getActivityBlockInfo(activityBlock);

    const rows = [
        { label: translateOrFallback('modals.activityContext.start', 'Start'), value: info.start },
        { label: translateOrFallback('modals.activityContext.end', 'End'), value: info.end },
        { label: translateOrFallback('modals.activityContext.duration', 'Duration'), value: info.duration },
        { label: translateOrFallback('modals.activityContext.label', 'Label'), value: info.label },
        { label: translateOrFallback('modals.activityContext.category', 'Category'), value: info.category },
        { label: translateOrFallback('modals.activityContext.name', 'Name'), value: info.name },
        { label: translateOrFallback('modals.activityContext.code', 'Code'), value: info.code }
    ];

    tableBody.innerHTML = '';
    rows.forEach((rowData) => {
        const row = document.createElement('tr');
        const labelCell = document.createElement('th');
        const valueCell = document.createElement('td');

        labelCell.textContent = rowData.label;
        valueCell.textContent = rowData.value;

        row.appendChild(labelCell);
        row.appendChild(valueCell);
        tableBody.appendChild(row);
    });

    modalOverlay.style.display = 'block';
}

function initDesktopActivityContextMenu() {
    const MENU_ID = 'activityContextMenu';
    let targetBlock = null;

    function ensureMenu() {
        let menu = document.getElementById(MENU_ID);
        if (menu) {
            return menu;
        }

        menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.className = 'activity-context-menu';
        menu.innerHTML = `
            <button type="button" class="activity-context-menu-item" data-action="show-info">${translateOrFallback('modals.activityContext.showInfo', 'Show info')}</button>
            <button type="button" class="activity-context-menu-item danger" data-action="delete">${translateOrFallback('modals.activityContext.delete', 'Delete')}</button>
        `;

        menu.addEventListener('click', (event) => {
            const actionButton = event.target.closest('.activity-context-menu-item');
            if (!actionButton) {
                return;
            }

            const action = actionButton.dataset.action;
            const blockForAction = targetBlock;
            hideMenu();

            if (!blockForAction || !blockForAction.isConnected) {
                return;
            }

            if (action === 'show-info') {
                showActivityInfoModal(blockForAction);
            } else if (action === 'delete') {
                deleteActivityBlock(blockForAction);
            }
        });

        document.body.appendChild(menu);
        return menu;
    }

    function hideMenu() {
        const menu = document.getElementById(MENU_ID);
        if (!menu) {
            return;
        }

        menu.style.display = 'none';
        targetBlock = null;
    }

    function showMenu(clientX, clientY, activityBlock) {
        const menu = ensureMenu();
        targetBlock = activityBlock;

        menu.style.display = 'block';

        const menuRect = menu.getBoundingClientRect();
        const margin = 8;
        let left = clientX;
        let top = clientY;

        if (left + menuRect.width + margin > window.innerWidth) {
            left = window.innerWidth - menuRect.width - margin;
        }
        if (top + menuRect.height + margin > window.innerHeight) {
            top = window.innerHeight - menuRect.height - margin;
        }

        left = Math.max(margin, left);
        top = Math.max(margin, top);

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }

    document.addEventListener('contextmenu', (event) => {
        if (getIsMobile()) {
            hideMenu();
            return;
        }

        const activityBlock = event.target.closest('.activity-block');
        if (!activityBlock) {
            hideMenu();
            return;
        }

        if (activityBlock.dataset.timelineKey !== getCurrentTimelineKey()) {
            hideMenu();
            return;
        }

        event.preventDefault();
        showMenu(event.clientX, event.clientY, activityBlock);
    });

    document.addEventListener('pointerdown', (event) => {
        const menu = document.getElementById(MENU_ID);
        if (!menu || menu.style.display !== 'block') {
            return;
        }

        if (!event.target.closest('.activity-context-menu')) {
            hideMenu();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideMenu();
        }
    });

    window.addEventListener('resize', hideMenu);
    document.addEventListener('scroll', hideMenu, true);
}



// Add this after the imports and before other functions
// This creates an activity block element from given activity data. such a block is what is visible on the timeline.
function createActivityBlock(activityData, isFromTemplate = false) {
    const currentBlock = document.createElement('div');
    currentBlock.className = 'activity-block';
    currentBlock.dataset.timelineKey = activityData.timelineKey; //getCurrentTimelineKey();

        // CRITICAL: Every activity MUST have a timelineKey
    if (!activityData.timelineKey) {
        console.error('CRITICAL BUG: Cannot create activity block without timelineKey in supplied activityData.', {
            activityData: activityData,
            stack: new Error().stack
        });
        throw new Error(`Cannot create activity block: missing timelineKey for activity "${activityData.activity || 'unknown'}"`);
    }

    const timelineKey = activityData.timelineKey;
    currentBlock.dataset.timelineKey = timelineKey;


    // Use existing ID or generate new one
    currentBlock.dataset.id = activityData.id || generateUniqueId();

    // Set all data attributes
    currentBlock.dataset.start = activityData.startTime;
    currentBlock.dataset.end = activityData.endTime;
    currentBlock.dataset.length = activityData.blockLength;
    currentBlock.dataset.category = activityData.category;
    currentBlock.dataset.mode = activityData.mode || 'single-choice';
    currentBlock.dataset.count = activityData.count || 1;
    currentBlock.dataset.startMinutes = activityData.startMinutes;
    currentBlock.dataset.endMinutes = activityData.endMinutes;
    currentBlock.dataset.code = activityData.code;

    if (activityData.parentName && activityData.parentName !== activityData.activity) {
        currentBlock.dataset.tooltipText = activityData.parentName; // What's displayed
    } else if (activityData.selections) {
        currentBlock.dataset.tooltipText = activityData.selections.map(s => s.name).join(' | ');
    } else {
        currentBlock.dataset.tooltipText = activityData.activity;
    }

    // Store parent name if this is a child activity
    if (activityData.parentName && activityData.parentName !== activityData.activity) {
        currentBlock.dataset.parentName = activityData.parentName;
        currentBlock.dataset.parentCode = activityData.parentCode;
    }

    console.log("Creating activity block", currentBlock, " from activityData:", activityData);

    // Handle multiple selections (gradient backgrounds)
    if (activityData.selections) {
        const colors = activityData.selections.map(s => s.color);
        const codes = activityData.selections.map(s => s.code);
        currentBlock.dataset.codes = codes.join('|');
        const isMobile = getIsMobile();
        const numSelections = colors.length;
        const percentage = 100 / numSelections;

        if (isMobile) {
            // Horizontal splits for mobile
            const stops = colors.map((color, index) =>
                `${color} ${index * percentage}%, ${color} ${(index + 1) * percentage}%`
            ).join(', ');
            currentBlock.style.background = `linear-gradient(to right, ${stops})`;
        } else {
            // Vertical splits for desktop
            const stops = colors.map((color, index) =>
                `${color} ${index * percentage}%, ${color} ${(index + 1) * percentage}%`
            ).join(', ');
            currentBlock.style.background = `linear-gradient(to bottom, ${stops})`;
        }
    } else {
        currentBlock.style.backgroundColor = activityData.color;
    }

    // Create text content
    const textDiv = document.createElement('div');
    let combinedActivityText;

    if (activityData.selections) {
        // For multiple selections, join names with line break in the text div
        textDiv.innerHTML = activityData.selections.map(s => s.name).join('<br>');
        // But join with vertical separator for storing in timelineManager
        combinedActivityText = activityData.selections.map(s => s.name).join(' | ');
    } else {
        // If this is a child item, display the parent name instead, but store both
        if (activityData.parentName && activityData.parentName !== activityData.activity) {
            textDiv.textContent = activityData.parentName;
            combinedActivityText = activityData.activity;
        } else {
            textDiv.textContent = activityData.activity;
            combinedActivityText = activityData.activity;
        }
    }

    textDiv.style.maxWidth = '90%';
    textDiv.style.overflow = 'hidden';
    textDiv.style.textOverflow = 'ellipsis';
    textDiv.style.whiteSpace = 'nowrap';

    // Set initial class based on length and mode
    const length = parseInt(activityData.blockLength);
    textDiv.className = getIsMobile()
        ? (length >= 60 ? 'activity-block-text-narrow wide resized' : 'activity-block-text-narrow')
        : (length >= 60 ? 'activity-block-text-narrow wide resized' : 'activity-block-text-vertical');

    currentBlock.appendChild(textDiv);

    // Add tooltip to show the selected child item when hovering
    if (activityData.parentName && activityData.parentName !== activityData.activity) {
        currentBlock.setAttribute('title', `${activityData.parentName}: ${activityData.activity}`);
    }

    // Make block keyboard-focusable for arrow-key resize
    currentBlock.tabIndex = 0;
    currentBlock.addEventListener('keydown', (event) => {
        const isLeft  = event.key === 'ArrowLeft';
        const isRight = event.key === 'ArrowRight';
        const isUp    = event.key === 'ArrowUp';
        const isDown  = event.key === 'ArrowDown';
        if (!isLeft && !isRight && !isUp && !isDown) return;

        event.preventDefault();

        const block = event.currentTarget;
        const timelineKey = block.dataset.timelineKey;

        // Only allow editing the currently active timeline
        if (timelineKey !== getCurrentTimelineKey()) return;
        const isMobile = getIsMobile();
        const STEP = 10; // minutes per key press
        const TIMELINE_MIN = 240;  // 04:00
        const TIMELINE_MAX = 1680; // 04:00(+1)

        let startMinutes = parseInt(block.dataset.startMinutes, 10);
        let endMinutes   = parseInt(block.dataset.endMinutes,   10);

        // Arrow semantics:
        //   Desktop: Left/Right => move right edge (end time); Up/Down => move left edge (start time)
        //   Mobile:  Up/Down   => move bottom edge (end time); Left/Right => move top edge (start time)
        let newStart = startMinutes;
        let newEnd   = endMinutes;

        if (!isMobile) {
            if (isRight) newEnd   = Math.min(TIMELINE_MAX, endMinutes   + STEP);
            if (isLeft)  newEnd   = Math.max(startMinutes + STEP, endMinutes - STEP);
            if (isDown)  newStart = Math.max(TIMELINE_MIN, startMinutes + STEP);
            if (isUp)    newStart = Math.min(endMinutes   - STEP, startMinutes - STEP);
        } else {
            if (isDown)  newEnd   = Math.min(TIMELINE_MAX, endMinutes   + STEP);
            if (isUp)    newEnd   = Math.max(startMinutes + STEP, endMinutes - STEP);
            if (isRight) newStart = Math.max(TIMELINE_MIN, startMinutes + STEP);
            if (isLeft)  newStart = Math.min(endMinutes   - STEP, startMinutes - STEP);
        }

        // Basic sanity check
        if (newStart < TIMELINE_MIN || newEnd > TIMELINE_MAX || newEnd <= newStart) return;

        // Overlap check
        if (!canPlaceActivity(newStart, newEnd, block.dataset.id)) {
            block.classList.add('invalid');
            setTimeout(() => block.classList.remove('invalid'), 400);
            return;
        }

        // Commit the change
        const newStartTime = formatTimelineStart(newStart);
        const newEndTime   = formatTimelineEnd(newEnd);

        block.dataset.startMinutes = newStart;
        block.dataset.endMinutes   = newEnd;
        block.dataset.start        = newStartTime;
        block.dataset.end          = newEndTime;
        block.dataset.length       = newEnd - newStart;

        if (!isMobile) {
            block.style.left  = `${minutesToPercentage(newStart)}%`;
            block.style.width = `${((newEnd - newStart) / MINUTES_PER_DAY) * 100}%`;
        } else {
            block.style.top    = `${minutesToPercentage(newStart)}%`;
            block.style.height = `${((newEnd - newStart) / MINUTES_PER_DAY) * 100}%`;
        }

        const timeLabel = block.querySelector('.time-label');
        if (timeLabel) {
            updateTimeLabel(timeLabel, newStartTime, newEndTime, block);
        }

        // Sync to timelineManager
        const currentData = window.timelineManager.activities[timelineKey] || [];
        const activityEntry = currentData.find(a => activityIdsEqual(a.id, block.dataset.id));
        if (activityEntry) {
            activityEntry.startTime    = newStartTime;
            activityEntry.endTime      = newEndTime;
            activityEntry.startMinutes = newStart;
            activityEntry.endMinutes   = newEnd;
            activityEntry.blockLength  = newEnd - newStart;
        }
    });

    // Positioning logic
    const startPositionPercent = minutesToPercentage(activityData.startMinutes);
    const blockSize = ((activityData.endMinutes - activityData.startMinutes) / MINUTES_PER_DAY) * 100;

    // Fixed dimensions for consistency
    const MOBILE_BLOCK_WIDTH = 75;
    const DESKTOP_BLOCK_HEIGHT = 90;
    const MOBILE_OFFSET = 25;
    const DESKTOP_OFFSET = 5;

    if (getIsMobile()) {
        currentBlock.style.height = `${blockSize}%`;
        currentBlock.style.top = `${startPositionPercent}%`;
        currentBlock.style.width = `${MOBILE_BLOCK_WIDTH}%`;
        currentBlock.style.left = `${MOBILE_OFFSET}%`;
    } else {
        currentBlock.style.width = `${blockSize}%`;
        currentBlock.style.left = `${startPositionPercent}%`;
        currentBlock.style.height = '75%';
        currentBlock.style.top = '25%';
    }

    // Return both the block and the standardized activity data
    return {
        block: currentBlock,
        activityData: {
            id: currentBlock.dataset.id,
            activity: combinedActivityText,
            category: activityData.category,
            startTime: activityData.startTime,
            endTime: activityData.endTime,
            blockLength: activityData.blockLength,
            color: activityData.color,
            code: activityData.code,
            codes: activityData.codes,
            parentName: activityData.parentName || combinedActivityText,
            parentCode: activityData.parentCode || null,
            selected: activityData.selected || combinedActivityText,
            isCustomInput: activityData.isCustomInput || false,
            originalSelection: activityData.originalSelection || null,
            startMinutes: activityData.startMinutes,
            endMinutes: activityData.endMinutes,
            mode: activityData.mode || 'single-choice',
            count: activityData.count || 1,
            selections: activityData.selections || null,
            availableOptions: activityData.availableOptions || null,
            timelineKey: timelineKey
        }
    };
}

function initPastTimelineClickHandlers() {
    const pastTimelinesWrapper = document.querySelector('.past-initialized-timelines-wrapper');
    if (!pastTimelinesWrapper) return;

    // Use a single event listener but check state at time of click
    pastTimelinesWrapper.addEventListener('click', async function(event) {
        // Find which timeline container was clicked
        let element = event.target;
        let timelineContainer = null;

        // Walk up the DOM to find the timeline container
        while (element && element !== this) {
            if (element.classList && element.classList.contains('timeline-container')) {
                timelineContainer = element;
                break;
            }
            element = element.parentNode;
        }

        if (!timelineContainer) return;

        // Check if it's still in the past wrapper (might have moved during async ops)
        if (!pastTimelinesWrapper.contains(timelineContainer)) {
            console.log('Timeline container moved during click, ignoring');
            return;
        }

        // Check if it's inactive
        if (timelineContainer.getAttribute('data-active') === 'true') {
            console.log('Clicked active timeline, ignoring');
            return;
        }

        const timelineElement = timelineContainer.querySelector('.timeline');
        if (!timelineElement) return;

        await navigateToTimelineByKey(timelineElement.id);
    });
}

async function navigateToTimelineByKey(targetTimelineKey) {
    const currentTimelineKey = getCurrentTimelineKey();

    if (!targetTimelineKey || targetTimelineKey === currentTimelineKey) {
        return;
    }

    console.log(`Navigating to ${targetTimelineKey} from ${currentTimelineKey}`);

    const targetIndex = window.timelineManager.keys.indexOf(targetTimelineKey);
    const currentIndex = window.timelineManager.keys.indexOf(currentTimelineKey);

    if (targetIndex === -1 || currentIndex === -1) {
        console.warn('Cannot navigate timeline: index not found', {
            targetTimelineKey,
            currentTimelineKey,
            targetIndex,
            currentIndex
        });
        return;
    }

    if (targetIndex < currentIndex) {
        const stepsBack = currentIndex - targetIndex;
        for (let i = 0; i < stepsBack; i++) {
            await goToPreviousTimeline();
        }
    } else {
        const stepsForward = targetIndex - currentIndex;
        for (let i = 0; i < stepsForward; i++) {
            await addNextTimeline();
        }
    }
}


function recreateActivityBlockFromTemplate(activityData) {
    console.log('=== RECREATE ACTIVITY BLOCK START ===');
    console.log('Input activityData:', activityData);

    // Make sure we have an ID
    if (!activityData.id) {
        activityData.id = generateUniqueId();
    }

    const result = createActivityBlock(activityData, true);
    const currentBlock = result.block;

    console.log('Activity block created:', currentBlock);
    console.log('Activity data result:', result.activityData);

    const targetTimelineKey = activityData.timelineKey || getCurrentTimelineKey();
    const targetTimelineElement = document.getElementById(targetTimelineKey) || window.timelineManager.activeTimeline;

    // Get or create activities container
    let activitiesContainer = targetTimelineElement.querySelector('.activities');
    if (!activitiesContainer) {
        console.log('Creating new activities container');
        activitiesContainer = document.createElement('div');
        activitiesContainer.className = 'activities';
        targetTimelineElement.appendChild(activitiesContainer);
    }

    console.log('Activities container:', activitiesContainer);
    console.log('Appending block to container...');
    activitiesContainer.appendChild(currentBlock);
    console.log('Block appended, container children count:', activitiesContainer.children.length);

    // Create time label
    const timeLabel = createTimeLabel(currentBlock);
    updateTimeLabel(timeLabel, activityData.startTime, activityData.endTime, currentBlock);

    // Ensure the activity data in the manager matches
    console.log('Current timeline key:', getCurrentTimelineKey(), 'target timeline key:', targetTimelineKey);

    window.timelineManager.activities[targetTimelineKey] = window.timelineManager.activities[targetTimelineKey] || [];

    // Check if this activity already exists in the manager
    const existingIndex = window.timelineManager.activities[targetTimelineKey].findIndex(a => activityIdsEqual(a.id, activityData.id));
    if (existingIndex === -1) {
        console.log('Adding activity to manager');
        window.timelineManager.activities[targetTimelineKey].push(result.activityData);
    } else {
        console.log('Activity already exists in manager at index', existingIndex);
    }

    console.log('Activities in manager:', window.timelineManager.activities[targetTimelineKey].map(a => a.id));
    console.log('=== RECREATE ACTIVITY BLOCK END ===');

    return result;
}

// NEW: Helper functions to format timeline times based on our 04:00 (240 minutes) rule
function formatTimelineStart(minutes) {
    // Normalize to current day (0-1440)
    const modMinutes = minutes % 1440;
    // For start times, if the time is before 04:00, mark as next day
    const addNextDayMarker = modMinutes < 240;
    return formatTimeHHMM(modMinutes, addNextDayMarker);
}

function formatTimelineEnd(minutes) {
    const modMinutes = minutes % 1440;
    // For end times, we want to mark 04:00 as next day as well (<= 240)
    const addNextDayMarker = modMinutes <= 240;
    return formatTimeHHMM(modMinutes, addNextDayMarker);
}

function isDesktopFixedTimelineOrdering() {
    return !getIsMobile();
}

function setTimelineActiveState(timelineElement, isActive) {
    if (!timelineElement) return;
    timelineElement.setAttribute('data-active', isActive ? 'true' : 'false');
    if (timelineElement.parentElement) {
        timelineElement.parentElement.setAttribute('data-active', isActive ? 'true' : 'false');
    }
}

// Function to restore an existing timeline from past-initialized-timelines-wrapper
async function restoreNextTimeline(nextTimelineIndex, nextTimelineKey) {
    // Increment the current index
    window.timelineManager.currentIndex = nextTimelineIndex;

    try {
        // Load timeline data (for categories/activities)
        const categories = await fetchActivities(nextTimelineKey);

        // Update UI for next timeline with animation
        const nextTimeline = window.timelineManager.metadata[nextTimelineKey];
        const timelineHeader = document.querySelector('.timeline-header');
        const timelineTitle = document.querySelector('.timeline-title');
        const timelineDescription = document.querySelector('.timeline-description');

        // Animation setup
        timelineHeader.classList.remove('flip-animation');
        void timelineHeader.offsetWidth;
        timelineHeader.classList.add('flip-animation');

        // Update content
        timelineTitle.textContent = nextTimeline.name;
        timelineDescription.textContent = nextTimeline.description;

        void timelineHeader.offsetWidth;
        timelineHeader.classList.add('flip-animation');

        timelineHeader.addEventListener('animationend', () => {
            timelineHeader.classList.remove('flip-animation');
        }, {once: true});

        const activeTimelineWrapper = document.querySelector('.last-initialized-timeline-wrapper');
        const pastTimelinesWrapper = document.querySelector('.past-initialized-timelines-wrapper');

        if (isDesktopFixedTimelineOrdering()) {
            const currentTimeline = window.timelineManager.activeTimeline;
            setTimelineActiveState(currentTimeline, false);

            const nextTimelineElement = document.getElementById(nextTimelineKey);
            if (!nextTimelineElement) {
                throw new Error(`Timeline element '${nextTimelineKey}' not found`);
            }

            setTimelineActiveState(nextTimelineElement, true);
            window.timelineManager.activeTimeline = nextTimelineElement;
            initTimelineInteraction(window.timelineManager.activeTimeline);

            renderActivities(categories);
            updateButtonStates();
            scrollToActiveTimeline();

            const backButton = document.getElementById('backBtn');
            if (backButton) {
                backButton.disabled = false;
            }

            const activitiesContainerElement = document.querySelector("#activitiesContainer");
            if (activitiesContainerElement) {
                activitiesContainerElement.setAttribute('data-mode', window.timelineManager.metadata[nextTimelineKey].mode);
            }

            updateFloatingButtonPosition();
            return;
        }

        // Move current timeline to past wrapper
        const currentTimeline = window.timelineManager.activeTimeline;
        if (currentTimeline && currentTimeline.parentElement) {
            currentTimeline.setAttribute('data-active', 'false');
            currentTimeline.parentElement.setAttribute('data-active', 'false');
            pastTimelinesWrapper.appendChild(currentTimeline.parentElement);
            updateTimelineCountVariable();
        }

        // Clear active wrapper
        activeTimelineWrapper.innerHTML = '';

        // Move the next timeline from past wrapper to active wrapper
        const nextTimelineElement = document.getElementById(nextTimelineKey);
        if (nextTimelineElement && nextTimelineElement.parentElement) {
            nextTimelineElement.setAttribute('data-active', 'true');
            nextTimelineElement.parentElement.setAttribute('data-active', 'true');
            activeTimelineWrapper.appendChild(nextTimelineElement.parentElement);

            // Set active timeline reference
            window.timelineManager.activeTimeline = nextTimelineElement;

            // Re-initialize timeline interaction
            initTimelineInteraction(window.timelineManager.activeTimeline);
        }

        // Render activities for restored timeline
        renderActivities(categories);

        // Scroll to active timeline in mobile view
        if (getIsMobile()) {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }

        // Reset button states
        updateButtonStates();

        // Scroll to the active timeline
        scrollToActiveTimeline();

        if (DEBUG_MODE) {
            console.log(`Restored ${nextTimelineKey} timeline from past wrapper`);
            console.log('Timeline data structure:', window.timelineManager.activities);
            // Give short info with number of activities per timeline
            console.log('Activities per timeline:', Object.fromEntries(Object.entries(window.timelineManager.activities).map(([key, activities]) => [key, activities.length])));
        }

        // Update Back button state
        const backButton = document.getElementById('backBtn');
        if (backButton) {
            backButton.disabled = false;
        }

        // Update activities container data-mode
        const activitiesContainerElement = document.querySelector("#activitiesContainer");
        if (activitiesContainerElement) {
            activitiesContainerElement.setAttribute('data-mode', window.timelineManager.metadata[nextTimelineKey].mode);
        }

        // Update floating button position after timeline changes
        updateFloatingButtonPosition();

    } catch (error) {
        console.error(`Error restoring ${nextTimelineKey} timeline:`, error);
        throw new Error(`Failed to restore ${nextTimelineKey} timeline: ${error.message}`);
    }
}

// Function to add next timeline
async function addNextTimeline() {
    if (DEBUG_MODE) {
        console.log(`Current timeline data saved:`, window.timelineManager.activities);
    }

    // Check if we're at the end of timelines before incrementing
    if (window.timelineManager.currentIndex + 1 >= window.timelineManager.keys.length) {
        if (DEBUG_MODE) {
            console.log('All timelines initialized');
        }
        return;
    }

    // Clear selected activity before switching timelines to prevent user from placing primary activity on secondary timeline
        clearActiveActivitySelection();
    console.log('Cleared selected activity before switching timeline to next timeline');

    // Get the next timeline key before incrementing
    const nextTimelineIndex = window.timelineManager.currentIndex + 1;
    const nextTimelineKey = window.timelineManager.keys[nextTimelineIndex];

    // Check if the next timeline already exists in past-initialized-timelines-wrapper
    const pastTimelinesWrapper = document.querySelector('.past-initialized-timelines-wrapper');
    const existingNextTimeline = document.getElementById(nextTimelineKey);

    if (existingNextTimeline && pastTimelinesWrapper.contains(existingNextTimeline.parentElement)) {
        // Timeline exists in past wrapper, restore it instead of creating new one
        if (DEBUG_MODE) {
            console.log(`Restoring existing timeline "${nextTimelineKey}" from past wrapper`);
        }
        await restoreNextTimeline(nextTimelineIndex, nextTimelineKey);
        return;
    }

    // If timeline doesn't exist in past wrapper but exists elsewhere, skip creation
    if (existingNextTimeline || window.timelineManager.initialized.has(nextTimelineKey)) {
        console.warn(`Timeline with key "${nextTimelineKey}" already exists or is initialized, skipping creation`);
        return;
    }

    // Only increment the index after validation passes
    window.timelineManager.currentIndex = nextTimelineIndex;

    try {
        // Load next timeline data
        const categories = await fetchActivities(nextTimelineKey);

        const isMobile = getIsMobile();

        // Update UI for next timeline with animation
        const nextTimeline = window.timelineManager.metadata[nextTimelineKey];
        const timelineHeader = document.querySelector('.timeline-header');
        const timelineTitle = document.querySelector('.timeline-title');
        const timelineDescription = document.querySelector('.timeline-description');

        // First remove any existing animation
        timelineHeader.classList.remove('flip-animation');

        // Force a reflow before starting new animation
        void timelineHeader.offsetWidth;

        // Add animation class before content change
        timelineHeader.classList.add('flip-animation');

        // Update content immediately
        timelineTitle.textContent = nextTimeline.name;
        timelineDescription.textContent = nextTimeline.description;

        // Trigger reflow to ensure animation plays
        void timelineHeader.offsetWidth;

        // Add animation class
        timelineHeader.classList.add('flip-animation');

        // Remove animation class after it finishes
        timelineHeader.addEventListener('animationend', () => {
            timelineHeader.classList.remove('flip-animation');
        }, {once: true});

        // Clear any existing timeline containers to prevent duplicates
        const activeTimelineWrapper = document.querySelector('.last-initialized-timeline-wrapper');
        const inactiveTimelinesWrapper = document.querySelector('.past-initialized-timelines-wrapper');

        if (isDesktopFixedTimelineOrdering()) {
            if (window.timelineManager.currentIndex === 0) {
                activeTimelineWrapper.innerHTML = '';
                inactiveTimelinesWrapper.innerHTML = '';
                console.log('Cleared all timeline wrappers for first timeline initialization');
            }

            const previousTimeline = window.timelineManager.activeTimeline;
            setTimelineActiveState(previousTimeline, false);

            const newTimelineContainer = document.createElement('div');
            newTimelineContainer.className = 'timeline-container';

            const titleDiv = document.createElement('div');
            titleDiv.className = 'title';
            titleDiv.textContent = window.timelineManager.metadata[nextTimelineKey].name;
            newTimelineContainer.appendChild(titleDiv);

            const newTimeline = document.createElement('div');
            newTimeline.className = 'timeline';
            newTimelineContainer.appendChild(newTimeline);

            inactiveTimelinesWrapper.appendChild(newTimelineContainer);

            newTimeline.id = nextTimelineKey;
            newTimeline.setAttribute('data-timeline-type', nextTimelineKey);
            newTimeline.setAttribute('data-mode', window.timelineManager.metadata[nextTimelineKey].mode);
            setTimelineActiveState(newTimeline, true);

            window.timelineManager.activeTimeline = newTimeline;
            window.timelineManager.activities[nextTimelineKey] = window.timelineManager.activities[nextTimelineKey] || [];

            initTimeline(window.timelineManager.activeTimeline);
            renderActivities(categories);
            initTimelineInteraction(window.timelineManager.activeTimeline);

            updateButtonStates();
            scrollToActiveTimeline();

            const backButton = document.getElementById('backBtn');
            if (backButton) {
                backButton.disabled = false;
            }

            const activitiesContainerElement = document.querySelector("#activitiesContainer");
            if (activitiesContainerElement) {
                activitiesContainerElement.setAttribute('data-mode', window.timelineManager.metadata[nextTimelineKey].mode);
            }

            updateFloatingButtonPosition();
            initPastTimelineClickHandlers();
            return;
        }

        // For the first timeline, clear everything to ensure a clean start
        if (window.timelineManager.currentIndex === 0) {
            activeTimelineWrapper.innerHTML = '';
            inactiveTimelinesWrapper.innerHTML = '';
            console.log('Cleared all timeline wrappers for first timeline initialization');
        } else {
            // Move previous timeline to inactive wrapper BEFORE adding new one
            const previousTimeline = window.timelineManager.activeTimeline;
            if (previousTimeline && previousTimeline.parentElement) {
                previousTimeline.setAttribute('data-active', 'false');
                previousTimeline.parentElement.setAttribute('data-active', 'false');

                // Move the previous timeline to the inactive wrapper
                inactiveTimelinesWrapper.appendChild(previousTimeline.parentElement);

                // Update timeline count variable
                updateTimelineCountVariable();
            }

            // Clear any existing containers in the active wrapper to prevent duplicates
            activeTimelineWrapper.innerHTML = '';
        }

        // Desktop mode - create new timeline container
        const newTimelineContainer = document.createElement('div');
        newTimelineContainer.className = 'timeline-container';

        // Add title element
        const titleDiv = document.createElement('div');
        titleDiv.className = 'title';
        titleDiv.textContent = window.timelineManager.metadata[nextTimelineKey].name;
        newTimelineContainer.appendChild(titleDiv);

        const newTimeline = document.createElement('div');
        newTimeline.className = 'timeline';
        newTimelineContainer.appendChild(newTimeline);

        // Add new timeline to active wrapper
        activeTimelineWrapper.appendChild(newTimelineContainer);

        // Initialize new timeline and container with proper IDs and mode
        newTimeline.id = nextTimelineKey;
        newTimeline.setAttribute('data-timeline-type', nextTimelineKey);
        newTimeline.setAttribute('data-active', 'true');
        newTimeline.setAttribute('data-mode', window.timelineManager.metadata[nextTimelineKey].mode);
        newTimelineContainer.setAttribute('data-active', 'true');

        // Set active timeline reference
        window.timelineManager.activeTimeline = newTimeline;

        // Initialize activities array if not exists
        window.timelineManager.activities[nextTimelineKey] = window.timelineManager.activities[nextTimelineKey] || [];

        // Scroll to active timeline in mobile view
        if (getIsMobile()) {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }

        // Initialize timeline with markers and containers
        initTimeline(window.timelineManager.activeTimeline);

        // Render activities for next timeline
        renderActivities(categories);

        // Initialize interaction for the timeline
        initTimelineInteraction(window.timelineManager.activeTimeline);

        // Reset button states
        updateButtonStates();

        // Scroll to the active timeline
        scrollToActiveTimeline();

        if (DEBUG_MODE) {
            console.log(`Switched to ${nextTimelineKey} timeline`);
            console.log('Timeline data structure:', window.timelineManager.activities);
            console.log('Activities per timeline:', Object.fromEntries(Object.entries(window.timelineManager.activities).map(([key, activities]) => [key, activities.length])));
        }

        // Update Back button state
        const backButton = document.getElementById('backBtn');
        if (backButton) {
            backButton.disabled = false;
        }

        // Update activities container data-mode
        const activitiesContainerElement = document.querySelector("#activitiesContainer");
        if (activitiesContainerElement) {
            activitiesContainerElement.setAttribute('data-mode', window.timelineManager.metadata[nextTimelineKey].mode);
        }

        // Update floating button position after timeline changes
        updateFloatingButtonPosition();
        initPastTimelineClickHandlers();

    } catch (error) {
        console.error(`Error switching to ${nextTimelineKey} timeline:`, error);
        throw new Error(`Failed to switch to ${nextTimelineKey} timeline: ${error.message}`);
    }
}

// Function to go back to previous timeline
async function goToPreviousTimeline() {
    if (DEBUG_MODE) {
        console.log(`Going back from timeline ${window.timelineManager.currentIndex}`);
    }

    // Check if we can go back
    if (window.timelineManager.currentIndex <= 0) {
        if (DEBUG_MODE) {
            console.log('Already at first timeline, cannot go back');
        }
        return;
    }

    // Clear selected activity before switching timelines to prevent user from placing primary activity on secondary timeline
        clearActiveActivitySelection();
    console.log('Cleared selected activity before going to previous timeline');

    // Get the previous timeline key
    const previousTimelineIndex = window.timelineManager.currentIndex - 1;
    const previousTimelineKey = window.timelineManager.keys[previousTimelineIndex];

    // Decrement the index
    window.timelineManager.currentIndex = previousTimelineIndex;

    try {
        // Load previous timeline data
        const categories = await fetchActivities(previousTimelineKey);

        // Update UI for previous timeline with animation
        const previousTimeline = window.timelineManager.metadata[previousTimelineKey];
        const timelineHeader = document.querySelector('.timeline-header');
        const timelineTitle = document.querySelector('.timeline-title');
        const timelineDescription = document.querySelector('.timeline-description');

        // First remove any existing animation
        timelineHeader.classList.remove('flip-animation');

        // Force a reflow before starting new animation
        void timelineHeader.offsetWidth;

        // Add animation class before content change
        timelineHeader.classList.add('flip-animation');

        // Update content immediately
        timelineTitle.textContent = previousTimeline.name;
        timelineDescription.textContent = previousTimeline.description;

        // Trigger reflow to ensure animation plays
        void timelineHeader.offsetWidth;

        // Add animation class
        timelineHeader.classList.add('flip-animation');

        // Remove animation class after it finishes
        timelineHeader.addEventListener('animationend', () => {
            timelineHeader.classList.remove('flip-animation');
        }, {once: true});

        const activeTimelineWrapper = document.querySelector('.last-initialized-timeline-wrapper');
        const inactiveTimelinesWrapper = document.querySelector('.past-initialized-timelines-wrapper');

        if (isDesktopFixedTimelineOrdering()) {
            const currentTimeline = window.timelineManager.activeTimeline;
            setTimelineActiveState(currentTimeline, false);

            const previousTimelineElement = document.getElementById(previousTimelineKey);
            if (!previousTimelineElement) {
                throw new Error(`Previous timeline element '${previousTimelineKey}' not found`);
            }

            setTimelineActiveState(previousTimelineElement, true);
            window.timelineManager.activeTimeline = previousTimelineElement;
            initTimelineInteraction(window.timelineManager.activeTimeline);

            renderActivities(categories);
            updateButtonStates();
            scrollToActiveTimeline();

            const activitiesContainerElement = document.querySelector("#activitiesContainer");
            if (activitiesContainerElement) {
                activitiesContainerElement.setAttribute('data-mode', window.timelineManager.metadata[previousTimelineKey].mode);
            }

            updateFloatingButtonPosition();
            initPastTimelineClickHandlers();
            return;
        }

        // Move all future timelines to past wrapper (so they can be restored later)
        const currentTimelineIndex = window.timelineManager.currentIndex + 1; // +1 because we already decremented
        for (let i = currentTimelineIndex; i < window.timelineManager.keys.length; i++) {
            const futureTimelineKey = window.timelineManager.keys[i];
            const futureTimelineElement = document.getElementById(futureTimelineKey);
            if (futureTimelineElement && futureTimelineElement.parentElement) {
                // Move to past wrapper instead of removing
                futureTimelineElement.setAttribute('data-active', 'false');
                futureTimelineElement.parentElement.setAttribute('data-active', 'false');
                inactiveTimelinesWrapper.appendChild(futureTimelineElement.parentElement);
            }
        }

        // Move current timeline to inactive wrapper
        const currentTimeline = window.timelineManager.activeTimeline;
        if (currentTimeline && currentTimeline.parentElement) {
            currentTimeline.setAttribute('data-active', 'false');
            currentTimeline.parentElement.setAttribute('data-active', 'false');

            // Move the current timeline to the inactive wrapper
            inactiveTimelinesWrapper.appendChild(currentTimeline.parentElement);

            // Update timeline count variable
            updateTimelineCountVariable();
        }

        // Clear active wrapper
        activeTimelineWrapper.innerHTML = '';

        // Find the previous timeline in inactive wrapper and move it back to active
        const previousTimelineElement = document.getElementById(previousTimelineKey);
        if (previousTimelineElement && previousTimelineElement.parentElement) {
            // Move previous timeline back to active wrapper
            previousTimelineElement.setAttribute('data-active', 'true');
            previousTimelineElement.parentElement.setAttribute('data-active', 'true');
            activeTimelineWrapper.appendChild(previousTimelineElement.parentElement);

            // Set active timeline reference
            window.timelineManager.activeTimeline = previousTimelineElement;

            // IMPORTANT: Re-initialize timeline interaction for the reactivated timeline
            // This ensures that click events and activity placement still work
            initTimelineInteraction(window.timelineManager.activeTimeline);
        } else {
            // If timeline doesn't exist in inactive wrapper, recreate it
            const newTimelineContainer = document.createElement('div');
            newTimelineContainer.className = 'timeline-container';

            // Add title element
            const titleDiv = document.createElement('div');
            titleDiv.className = 'title';
            titleDiv.textContent = window.timelineManager.metadata[previousTimelineKey].name;
            newTimelineContainer.appendChild(titleDiv);

            const newTimeline = document.createElement('div');
            newTimeline.className = 'timeline';
            newTimelineContainer.appendChild(newTimeline);

            // Add timeline to active wrapper
            activeTimelineWrapper.appendChild(newTimelineContainer);

            // Initialize timeline and container with proper IDs and mode
            newTimeline.id = previousTimelineKey;
            newTimeline.setAttribute('data-timeline-type', previousTimelineKey);
            newTimeline.setAttribute('data-active', 'true');
            newTimeline.setAttribute('data-mode', window.timelineManager.metadata[previousTimelineKey].mode);
            newTimelineContainer.setAttribute('data-active', 'true');

            // Set active timeline reference
            window.timelineManager.activeTimeline = newTimeline;

            // Initialize timeline with markers and containers
            initTimeline(window.timelineManager.activeTimeline);

            // Initialize interaction for the timeline
            initTimelineInteraction(window.timelineManager.activeTimeline);
        }

        // Activities will be restored automatically when the timeline is re-initialized
        // The activity data is already stored in window.timelineManager.activities[previousTimelineKey]

        // Render activities categories for previous timeline
        renderActivities(categories);

        // Scroll to active timeline in mobile view
        if (getIsMobile()) {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }

        // Reset button states
        updateButtonStates();

        // Scroll to the active timeline
        scrollToActiveTimeline();

        if (DEBUG_MODE) {
            console.log(`Switched back to ${previousTimelineKey} timeline`);
            console.log('Timeline data structure:', window.timelineManager.activities);
            console.log('Activities per timeline:', Object.fromEntries(Object.entries(window.timelineManager.activities).map(([key, activities]) => [key, activities.length])));
        }

        // Update activities container data-mode
        const activitiesContainerElement = document.querySelector("#activitiesContainer");
        if (activitiesContainerElement) {
            activitiesContainerElement.setAttribute('data-mode', window.timelineManager.metadata[previousTimelineKey].mode);
        }

        // Update floating button position after timeline changes
        updateFloatingButtonPosition();
        initPastTimelineClickHandlers();

    } catch (error) {
        console.error(`Error switching back to ${previousTimelineKey} timeline:`, error);
        throw new Error(`Failed to switch back to ${previousTimelineKey} timeline: ${error.message}`);
    }
}

function logDebugInfo() {
    if (DEBUG_MODE) {
        console.log('timelineData:', timelineData);
    }
}


// Add a cache for fetched timelines
const timelineFetchCache = new Map();


async function fetchActivities(key) {
    console.log(`Fetching activities configuration for timeline key: ${key}`);

    // Check if we have cached config
    const configData = getCachedActivitiesConfig();
    if (!configData) {
        // This should never happen if init succeeded
        throw new Error('Activities configuration cache is empty. Application was not properly initialized.');
    }

    // Validate min_coverage
    try {
        validateMinCoverage(configData.timeline[key].min_coverage);
    } catch (error) {
        const errorMessage = `Timeline "${key}": ${error.message}`;
        document.getElementById('activitiesContainer').innerHTML =
            `<p style="color: red; padding: 10px; background: #ffebee; border: 1px solid #ef9a9a; border-radius: 4px;">
                ${errorMessage}
            </p>`;
        throw new Error(errorMessage);
    }

    const categories = getTimelineCategories(key, configData);

    // Mark timeline as initialized
    window.timelineManager.initialized.add(key);

    if (DEBUG_MODE) {
        console.log(`Returning cached activities for ${key} with ${categories.length} categories`);
    }

    return categories;
}



// Create a child items modal for activity selection
function createChildItemsModal() {
    // Check if modal already exists
    if (document.getElementById('childItemsModal')) {
        return document.getElementById('childItemsModal');
    }

    const modal = document.createElement('div');
    modal.id = 'childItemsModal';
    modal.className = 'modal';
    modal.style.display = 'none';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';

    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';

    const closeButton = document.createElement('span');
    closeButton.className = 'close';
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    const title = document.createElement('h3');
    title.id = 'childItemsModalTitle';
    title.setAttribute('data-i18n', 'modals.childItems.title');
    title.textContent = window.i18n ? window.i18n.t('modals.childItems.title') : 'Select an option';

    modalHeader.appendChild(title);
    modalHeader.appendChild(closeButton);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    modalBody.id = 'childItemsContainer';

    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modal.appendChild(modalContent);

    document.body.appendChild(modal);

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    return modal;
}


function renderChildItems(activity, categoryName) {
    const modal = createChildItemsModal();
    const container = document.getElementById('childItemsContainer');
    const title = document.getElementById('childItemsModalTitle');

    // Set the title to the parent activity name
    if (window.i18n && window.i18n.isReady()) {
        const template = window.i18n.t('modals.childItems.titleFor');
        title.textContent = template.replace(/\{activityName\}/g, activity.name);
    } else {
        title.textContent = `Select an option for "${activity.name}"`;
    }

    // Clear previous content
    container.innerHTML = '';

    //console.log(`>>>>Rendering child items for activity "${activity.name}" in category "${categoryName}"`);

    // Create buttons for each child item
    if (activity.childItems && activity.childItems.length > 0) {
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'child-item-buttons';

        activity.childItems.forEach(childItem => {
            //console.log(`>>Adding child item button: "${childItem.name}" with color "${childItem.color || activity.color}"`);
            const button = document.createElement('button');
            button.className = 'child-item-button';

            // Add custom-input class if this is a custom child item
            const is_custom_input = childItem.is_custom_input || false;
            if (is_custom_input) {
                button.classList.add('custom-input');
            }

            button.style.setProperty('--color', childItem.color || activity.color);
            button.dataset.code = childItem.code;

            // Create container for button content (to handle examples layout)
            const buttonContent = document.createElement('div');
            buttonContent.className = 'child-item-button-content';

            // Create name element
            const nameSpan = document.createElement('span');
            nameSpan.className = 'child-item-name';
            nameSpan.textContent = childItem.name;
            buttonContent.appendChild(nameSpan);

            if (childItem.examples) {
                const examplesSpan = document.createElement('span');
                examplesSpan.className = 'child-item-examples';
                examplesSpan.textContent = childItem.examples;
                buttonContent.appendChild(examplesSpan);
            }

            button.appendChild(buttonContent);

            // ... rest of the existing click handler code remains the same
            button.addEventListener('click', () => {
                // Check if this is a custom input child item
                if (is_custom_input) {
                    console.log('>>>>[CHILD ITEM] Custom input child item clicked, showing custom activity modal');

                    // Set context for custom input
                    window.customInputContext = {
                        type: 'childItem',
                        parentActivity: activity,
                        categoryName: categoryName,
                        childItem: childItem
                    };

                    // Close child items modal
                    modal.style.display = 'none';

                    // Show custom activity modal with appropriate title
                    const customActivityModal = document.getElementById('customActivityModal');
                    const customActivityInput = document.getElementById('customActivityInput');
                    const modalTitle = customActivityModal.querySelector('h3');
                    const activitiesModal = document.getElementById('activitiesModal');

                    // Update modal title for child item context
                    if (window.i18n && window.i18n.isReady()) {
                        const template = window.i18n.t('modals.customActivity.childItemTitle');
                        modalTitle.textContent = template.replace(/\{parentActivity\}/g, activity.name);
                    } else {
                        modalTitle.textContent = `Enter custom value for: ${activity.name}`;
                    }

                    customActivityInput.value = ''; // Clear previous input
                    customActivityModal.style.display = 'block';
                    customActivityInput.focus();

                    // SET UP EVENT LISTENERS FOR CUSTOM ACTIVITY MODAL (CHILD ITEM VERSION)
                    const confirmBtn = document.getElementById('confirmCustomActivity');
                    const inputField = document.getElementById('customActivityInput');

                    if (confirmBtn && inputField) {
                        // Remove any existing listeners
                        const newConfirmBtn = confirmBtn.cloneNode(true);
                        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

                        const newInputField = inputField.cloneNode(true);
                        inputField.parentNode.replaceChild(newInputField, inputField);

                        // Handle custom activity submission for child items
                        const handleChildItemCustomActivity = () => {
                            const customText = newInputField.value.trim();
                            if (customText) {
                                // Create child item structure with custom text
                                window.selectedActivity = {
                                    name: customText,
                                    parentName: activity.name,
                                    parentCode: activity.code,
                                    color: childItem.color || activity.color,
                                    category: categoryName,
                                    selected: customText,
                                    originalSelection: childItem.name, // Store what was originally clicked
                                    isCustomInput: true,
                                    code: childItem.code,
                                };

                                // Close modals
                                console.log('>>>>Closing modals after custom child item input');
                                customActivityModal.style.cssText = 'display: none !important';
                                const childItemsModal = document.getElementById('childItemsModal');
                                if (childItemsModal) {
                                    childItemsModal.style.cssText = 'display: none !important';
                                }
                                if (activitiesModal) {
                                    activitiesModal.style.cssText = 'display: none !important';
                                }

                                newInputField.value = '';

                                // Reset context
                                window.customInputContext = { type: null, parentActivity: null, categoryName: null };
                            }
                        };

                        // Add new listeners
                        newConfirmBtn.addEventListener('click', handleChildItemCustomActivity);
                        newInputField.addEventListener('keypress', (e) => {
                            if (e.key === 'Enter') {
                                handleChildItemCustomActivity();
                            }
                        });
                    }

                    return;
                }

                //console.log(`>>[CHILD ITEM] non-custom Selected child item: "${childItem.name}"`);

                // Regular child item selection (not custom)
                window.selectedActivity = {
                    name: childItem.name,
                    parentName: activity.name,
                    parentCode: activity.code,
                    color: childItem.color || activity.color,
                    category: categoryName,
                    selected: childItem.name,
                    isCustomInput: false,
                    code: childItem.code,
                };

                // Close the modal
                modal.style.display = 'none';

                // Also close activities modal if open
                const activitiesModal = document.getElementById('activitiesModal');
                if (activitiesModal) {
                    activitiesModal.style.display = 'none';
                }
            });

            buttonsContainer.appendChild(button);
        });

        container.appendChild(buttonsContainer);
    }

    // Show the modal
    modal.style.display = 'block';
}

function renderActivities(categories, container = document.getElementById('activitiesContainer')) {
    console.log('>>Rendering activities for container:', container.id);
    container.innerHTML = '';

    // Set data-mode attribute based on current timeline's mode
    const currentKey = getCurrentTimelineKey();
    if (currentKey && window.timelineManager.metadata[currentKey]) {
        container.setAttribute('data-mode', window.timelineManager.metadata[currentKey].mode);
    }

    const isMobile = getIsMobile();
    const isModal = container.id === 'modalActivitiesContainer';

    // Only create accordion if this is the modal container and in mobile view
    if (isMobile && isModal) {
        console.log('>>Creating accordion layout for mobile modal activities');
        const accordionContainer = document.createElement('div');
        accordionContainer.className = 'activities-accordion';
        // Set data-mode attribute to match current timeline's mode
        const currentKey = getCurrentTimelineKey();
        if (currentKey && window.timelineManager.metadata[currentKey]) {
            accordionContainer.setAttribute('data-mode', window.timelineManager.metadata[currentKey].mode);
        }

        categories.forEach(category => {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'activity-category';

            const categoryTitle = document.createElement('h3');
            categoryTitle.textContent = category.name;
            categoryDiv.appendChild(categoryTitle);

            const activityButtonsDiv = document.createElement('div');
            activityButtonsDiv.className = 'activity-buttons';

            category.activities.forEach(activity => {
                //console.log(">>>Rendering activity:", activity.name, " of category:", category.name, "in accordion (mobile modal)");
                const activityButton = document.createElement('button');
                const isMultipleChoice = container.getAttribute('data-mode') === 'multiple-choice';
                const is_custom_input = activity.is_custom_input || false;
                activityButton.className = `activity-button ${isMultipleChoice ? 'checkbox-style' : ''}`;
                // Add indicator class if activity has child items
                if (activity.childItems && activity.childItems.length > 0) {
                    activityButton.classList.add('has-child-items');
                }


                activityButton.style.setProperty('--color', activity.color);
                activityButton.dataset.code = activity.code;

                if (isMultipleChoice) {
                    const checkmark = document.createElement('span');
                    checkmark.className = 'checkmark';
                    activityButton.appendChild(checkmark);
                }



                const textSpan = document.createElement('span');
                textSpan.className = 'activity-text';

                // Create name span
                const nameSpan = document.createElement('span');
                nameSpan.className = 'activity-name';
                if (is_custom_input) {
                    activityButton.classList.add('custom-input');
                    nameSpan.classList.add('custom-input');
                }
                nameSpan.textContent = activity.name;
                textSpan.appendChild(nameSpan);

                // Add examples if they exist
                if (activity.examples) {
                    const examplesSpan = document.createElement('span');
                    examplesSpan.className = 'activity-examples';
                    examplesSpan.textContent = activity.examples;
                    textSpan.appendChild(examplesSpan);
                }

                activityButton.appendChild(textSpan);
                activityButton.addEventListener('click', () => {
                    const activitiesContainer = activityButton.closest('#activitiesContainer, #modalActivitiesContainer');
                    const isMultipleChoice = activitiesContainer.getAttribute('data-mode') === 'multiple-choice';
                    const categoryButtons = activityButton.closest('.activity-category').querySelectorAll('.activity-button');

                    // Check if this is the "other not listed" button
                    if (is_custom_input) {
                        // Show custom activity modal
                        console.log('>>[ACTIVITY] Detected "Other not listed" custom input activity button click');
                        console.log('[ACTIVITY] "Other not listed" button clicked, showing custom activity modal');
                        const customActivityModal = document.getElementById('customActivityModal');
                        const customActivityInput = document.getElementById('customActivityInput');
                        const modalTitle = customActivityModal.querySelector('h3');
                        modalTitle.textContent = `Enter custom value for: ${activity.name}`;

                        customActivityInput.value = ''; // Clear previous input
                        customActivityModal.style.display = 'block';
                        customActivityInput.focus(); // Focus the input field

                        // Handle custom activity submission
                        const handleCustomActivity = () => {
                            const customText = customActivityInput.value.trim();
                            if (customText) {
                                // Check if this is a child item custom input
                                if (window.customInputContext && window.customInputContext.type === 'childItem') {
                                    const context = window.customInputContext;

                                    // Create child item structure with custom text
                                    window.selectedActivity = {
                                        name: customText,
                                        parentName: context.parentActivity.name,
                                        parentCode: context.parentActivity.code,
                                        color: context.childItem.color || context.parentActivity.color,
                                        category: context.categoryName,
                                        selected: customText,
                                        originalSelection: context.childItem.name, // Store what was originally clicked
                                        isCustomInput: true,
                                        mode: 'single-choice',
                                        code: context.childItem.code,
                                    };

                                    // Reset context
                                    window.customInputContext = { type: null, parentActivity: null, categoryName: null };

                                } else {
                                    // Original top-level custom input logic
                                    // This branch should not be hit: custom acticvity AND multuople-choice is not supported
                                    if (isMultipleChoice) {
                                        console.error('[ACTIVITY] ERROR: Custom activity input in multiple-choice mode is not supported.');
                                        activityButton.classList.add('selected');
                                        const selectedButtons = Array.from(categoryButtons).filter(btn => btn.classList.contains('selected'));
                                        window.selectedActivity = {
                                            selections: selectedButtons.map(btn => ({
                                                name: btn === activityButton ? customText : btn.querySelector('.activity-text').textContent,
                                                color: btn.style.getPropertyValue('--color')
                                            })),
                                            category: category.name,
                                            codes: selectedButtons.map(btn => btn === activityButton ? null : btn.dataset.code),
                                        };
                                    } else {
                                        clearSelectedActivityButtons();
                                        window.selectedActivity = {
                                            name: customText,
                                            parentName: null,
                                            parentCode: null,
                                            color: activity.color,
                                            category: category.name,
                                            selected: customText,
                                            originalSelection: activity.name, // Store what was originally clicked
                                            isCustomInput: true,
                                            mode: 'single-choice',
                                            code: activity.code,
                                        };
                                        setSingleActiveActivityButton(activityButton);
                                    }
                                }

                                customActivityModal.style.display = 'none';
                                document.getElementById('activitiesModal').style.display = 'none';

                                // Also close child items modal if it's open
                                const childItemsModal = document.getElementById('childItemsModal');
                                if (childItemsModal) {
                                    childItemsModal.style.display = 'none';
                                }
                            }
                        };

                        // Set up event listeners for custom activity modal
                        const confirmBtn = document.getElementById('confirmCustomActivity');
                        const inputField = document.getElementById('customActivityInput');

                        // Remove any existing listeners
                        const newConfirmBtn = confirmBtn.cloneNode(true);
                        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

                        // Add new listeners
                        newConfirmBtn.addEventListener('click', handleCustomActivity);
                        inputField.addEventListener('keypress', (e) => {
                            if (e.key === 'Enter') {
                                handleCustomActivity();
                            }
                        });
                        console.log('window.customInputContext: ', window.customInputContext);
                        return;
                    } else {
                        console.log('[ACTIVITY] This click was not a "Other not listed" activity, continuing...');
                    }

                    // Check if activity has child items
                    if (activity.childItems && activity.childItems.length > 0) {
                        setSingleActiveActivityButton(activityButton);

                        // Show child items modal
                        renderChildItems(activity, category.name);
                        return;
                    }

                    if (isMultipleChoice) {
                        // Toggle selection for this button
                        activityButton.classList.toggle('selected');

                        // Get all selected activities in this category
                        const selectedButtons = Array.from(categoryButtons).filter(btn => btn.classList.contains('selected'));
                        const buttonsArray = Array.from(categoryButtons); // Convert node list to array for map()

                        const availableOptions = buttonsArray.map(btn => ({
                            name: btn.querySelector('.activity-text').textContent,
                            color: btn.style.getPropertyValue('--color')
                        }));

                        if (selectedButtons.length > 0) {
                            window.selectedActivity = {
                                selections: selectedButtons.map(btn => ({
                                    name: btn.textContent,
                                    color: btn.style.getPropertyValue('--color')
                                })),
                                category: category.name,
                                mode: 'multiple-choice',
                                count: selectedButtons.length,
                                availableOptions: availableOptions,
                                isCustomInput: false,
                                codes: selectedButtons.map(btn => btn.dataset.code),
                            };
                        } else {
                            // Only clear window.selectedActivity in multiple-choice mode if user actively deselected
                            // Don't clear if we're in a modal that's about to close
                            const isInModal = activityButton.closest('#modalActivitiesContainer');
                            if (!isInModal) {
                                console.log('[ACTIVITY] Clearing window.selectedActivity - not in modal');
                                clearActiveActivitySelection();
                            } else {
                                console.log('[ACTIVITY] NOT clearing window.selectedActivity - in modal');
                            }
                        }
                    } else {
                        // Single choice mode
                        clearSelectedActivityButtons();
                        window.selectedActivity = {
                            name: activity.name,
                            parentName: null,
                            parentCode: null,
                            color: activity.color,
                            category: category.name,
                            selected: activity.name,
                            //originalSelection: activity.name, // Store what was originally clicked,
                            isCustomInput: is_custom_input, // false
                            mode: 'single-choice',
                            code: activity.code,
                        };
                        console.log('[ACTIVITY] Selected activity:', window.selectedActivity);
                        setSingleActiveActivityButton(activityButton);
                    }
                    // Only close modal in single-choice mode
                    if (!isMultipleChoice) {
                        // Store the selected activity before closing modal to prevent it from being cleared
                        const preservedActivity = window.selectedActivity;

                        // Force close modals with a slight delay on mobile
                        if (getIsMobile()) {
                            setTimeout(() => {
                                const activitiesModal = document.getElementById('activitiesModal');
                                const customActivityModal = document.getElementById('customActivityModal');
                                if (activitiesModal) {
                                    activitiesModal.style.cssText = 'display: none !important';
                                }
                                if (customActivityModal) {
                                    customActivityModal.style.cssText = 'display: none !important';
                                }
                                // Restore window.selectedActivity after modal closes in case it was cleared
                                if (preservedActivity && !window.selectedActivity) {
                                    window.selectedActivity = preservedActivity;
                                    console.log('[MODAL] Restored window.selectedActivity:', window.selectedActivity);
                                } else {
                                    console.log('[MODAL] window.selectedActivity after close:', window.selectedActivity);
                                }
                            }, 50);
                        } else {
                            // Immediate close on desktop
                            const activitiesModal = document.getElementById('activitiesModal');
                            const customActivityModal = document.getElementById('customActivityModal');
                            if (activitiesModal) {
                                activitiesModal.style.cssText = 'display: none !important';
                            }
                            if (customActivityModal) {
                                customActivityModal.style.cssText = 'display: none !important';
                            }
                            // Restore window.selectedActivity after modal closes in case it was cleared
                            if (preservedActivity && !window.selectedActivity) {
                                window.selectedActivity = preservedActivity;
                            }
                        }
                    }
                });
                activityButtonsDiv.appendChild(activityButton);
            });

            categoryDiv.appendChild(activityButtonsDiv);
            accordionContainer.appendChild(categoryDiv);
        });

        container.appendChild(accordionContainer);

        // Add click event listener to category titles
        const categoryTitles = accordionContainer.querySelectorAll('.activity-category h3');
        categoryTitles.forEach(title => {
            title.addEventListener('click', () => {
                const category = title.parentElement;
                category.classList.toggle('active');
            });
        });
    } else {
        console.log(">>Rendering standard layout for activities (not on mobile modal)");
        categories.forEach(category => {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'activity-category';

            const categoryTitle = document.createElement('h3');
            categoryTitle.textContent = category.name;
            categoryDiv.appendChild(categoryTitle);

            const activityButtonsDiv = document.createElement('div');
            activityButtonsDiv.className = 'activity-buttons';

            category.activities.forEach(activity => {
                //console.log(">>>Rendering activity:", activity.name, " of category:", category.name, "(not on mobile modal)");
                const activityButton = document.createElement('button');
                const is_custom_input = activity.is_custom_input || false;
                //console.log(">>> is_custom_input for activity", activity.name, "is", is_custom_input);
                const isMultipleChoice = container.getAttribute('data-mode') === 'multiple-choice';
                activityButton.className = `activity-button ${isMultipleChoice ? 'checkbox-style' : ''}`;
                // Add indicator class if activity has child items
                if (activity.childItems && activity.childItems.length > 0) {
                    activityButton.classList.add('has-child-items');
                }

                activityButton.style.setProperty('--color', activity.color);
                activityButton.dataset.code = activity.code;

                if (isMultipleChoice) {
                    const checkmark = document.createElement('span');
                    checkmark.className = 'checkmark';
                    activityButton.appendChild(checkmark);
                }

                const textSpan = document.createElement('span');
                textSpan.className = 'activity-text';

                // Create name span
                const nameSpan = document.createElement('span');
                nameSpan.className = 'activity-name';
                if (is_custom_input) {
                    activityButton.classList.add('custom-input');
                    nameSpan.classList.add('custom-input');
                }
                nameSpan.textContent = activity.name;
                textSpan.appendChild(nameSpan);

                // Add examples if they exist
                if (activity.examples) {
                    const examplesSpan = document.createElement('span');
                    examplesSpan.className = 'activity-examples';
                    examplesSpan.textContent = activity.examples;
                    textSpan.appendChild(examplesSpan);
                }

                activityButton.appendChild(textSpan);
                activityButton.addEventListener('click', () => {
                    const activitiesContainer = activityButton.closest('#activitiesContainer, #modalActivitiesContainer');
                    const isMultipleChoice = activitiesContainer.getAttribute('data-mode') === 'multiple-choice';
                    const categoryButtons = activityButton.closest('.activity-category').querySelectorAll('.activity-button');

                    // Check if this is the "other not listed" button
                    if (is_custom_input) {
                        // Show custom activity modal
                        console.log('>>>>[ACTIVITY] is_custom_input button clicked, showing custom activity modal');
                        const customActivityModal = document.getElementById('customActivityModal');
                        const customActivityInput = document.getElementById('customActivityInput');
                        customActivityInput.value = ''; // Clear previous input
                        customActivityModal.style.display = 'block';
                        customActivityInput.focus(); // Focus the input field
                        const modalTitle = customActivityModal.querySelector('h3');
                        modalTitle.textContent = `Enter custom value for:  ${activity.name}`;

                        // Handle custom activity submission
                        const handleCustomActivity = () => {
                            const customText = customActivityInput.value.trim();
                            if (customText) {
                                // Check if this is a child item custom input
                                if (window.customInputContext && window.customInputContext.type === 'childItem') {
                                    console.log('>>>>[ACTIVITY] This is a child-level custom input activity');
                                    const context = window.customInputContext;

                                    // Create child item structure with custom text
                                    window.selectedActivity = {
                                        name: customText,
                                        parentName: context.parentActivity.name,
                                        parentCode: context.parentActivity.code,
                                        color: context.childItem.color || context.parentActivity.color,
                                        category: context.categoryName,
                                        selected: customText,
                                        originalSelection: context.childItem.name, // Store what was originally clicked
                                        mode: 'single-choice',
                                        isCustomInput: true,
                                        code: context.childItem.code,
                                    };

                                    // Reset context
                                    window.customInputContext = { type: null, parentActivity: null, categoryName: null };

                                } else {
                                    console.log('>>>>[ACTIVITY] This is a top-level custom input activity');
                                    // Original top-level custom input logic
                                    if (isMultipleChoice) {
                                        console.error("ERROR: cucstom input with multiple-choice is not supported");
                                        activityButton.classList.add('selected');
                                        const selectedButtons = Array.from(categoryButtons).filter(btn => btn.classList.contains('selected'));
                                        window.selectedActivity = {
                                            selections: selectedButtons.map(btn => ({
                                                name: btn === activityButton ? customText : btn.querySelector('.activity-text').textContent,
                                                color: btn.style.getPropertyValue('--color')
                                            })),
                                            category: category.name,
                                            mode: 'multiple-choice',
                                            codes: selectedButtons.map(btn => btn.dataset.code)
                                        };
                                    } else {
                                        clearSelectedActivityButtons();
                                        window.selectedActivity = {
                                            name: customText,
                                            parentName: null,
                                            parentCode: null,
                                            color: activity.color,
                                            category: category.name,
                                            originalSelection: activity.name, // Store what was originally clicked
                                            selected: customText,
                                            mode: 'single-choice',
                                            isCustomInput: true,
                                            code: activity.code,
                                        };
                                        setSingleActiveActivityButton(activityButton);
                                    }
                                }

                                customActivityModal.style.display = 'none';
                                document.getElementById('activitiesModal').style.display = 'none';

                                // Also close child items modal if it's open
                                const childItemsModal = document.getElementById('childItemsModal');
                                if (childItemsModal) {
                                    childItemsModal.style.display = 'none';
                                }
                            }
                        };

                        // Set up event listeners for custom activity modal
                        const confirmBtn = document.getElementById('confirmCustomActivity');
                        const inputField = document.getElementById('customActivityInput');

                        // Remove any existing listeners
                        const newConfirmBtn = confirmBtn.cloneNode(true);
                        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

                        // Add new listeners
                        newConfirmBtn.addEventListener('click', handleCustomActivity);
                        inputField.addEventListener('keypress', (e) => {
                            if (e.key === 'Enter') {
                                handleCustomActivity();
                            }
                        });

                        return;
                    } else {
                        console.log('[ACTIVITY] The button clicked was not a custom input button, proceeding with logic for non-custom buttons...');
                    }

                    // Check if activity has child items
                    if (activity.childItems && activity.childItems.length > 0) {
                        setSingleActiveActivityButton(activityButton);

                        // Show child items modal
                        console.log('>>>>[ACTIVITY] Activity has child items, rendering child items modal');
                        renderChildItems(activity, category.name);
                        return;
                    }
                    console.log('>>>>[ACTIVITY] This activity has no child items, proceeding with selection logic');


                    if (isMultipleChoice) {
                        console.log('>>>>[ACTIVITY] non-custom Multiple-choice mode active');
                        // Toggle selection for this button
                        activityButton.classList.toggle('selected');

                        // Get all selected activities in this category
                        const selectedButtons = Array.from(categoryButtons).filter(btn => btn.classList.contains('selected'));


                        console.log('>>>>[ACTIVITY] Computing available options for multiple-choice selection');
                        console.log('categoryButtons:', categoryButtons);
                        console.log('categoryButtons type:', typeof categoryButtons);
                        console.log('categoryButtons length:', categoryButtons?.length);



                        const buttonsArray = Array.from(categoryButtons); // Convert node list to array, we need map()

                        const availableOptions = buttonsArray.map(btn => ({
                            name: btn.querySelector('.activity-text').textContent,
                            color: btn.style.getPropertyValue('--color')
                        }));

                        if (selectedButtons.length > 0) {
                            window.selectedActivity = {
                                selections: selectedButtons.map(btn => ({
                                    name: btn.querySelector('.activity-text').textContent,
                                    color: btn.style.getPropertyValue('--color'),
                                    code: btn.dataset.code
                                })),
                                category: category.name,
                                mode: 'multiple-choice',
                                isCustomInput: false,
                                availableOptions: availableOptions,
                                codes: selectedButtons.map(btn => btn.dataset.code),
                            };
                        } else {
                            // Only clear window.selectedActivity in multiple-choice mode if user actively deselected
                            // Don't clear if we're in a modal that's about to close
                            const isInModal = activityButton.closest('#modalActivitiesContainer');
                            if (!isInModal) {
                                console.log('[ACTIVITY] Clearing window.selectedActivity - not in modal');
                                clearActiveActivitySelection();
                            } else {
                                console.log('[ACTIVITY] NOT clearing window.selectedActivity - in modal');
                            }
                        }
                        console.log('>>>>[ACTIVITY] window.selectedActivity after multiple-choice selection:', window.selectedActivity);
                    } else {
                        // Single choice mode
                        console.log('>>>>[ACTIVITY] non-custom Single-choice mode active');
                        clearSelectedActivityButtons();
                        window.selectedActivity = {
                            name: activity.name,
                            parentName: null,
                            parentCode: null,
                            color: activity.color,
                            category: category.name,
                            selected: activity.name,
                            originalSelection: null, // this is not a custom input, so no original selection
                            mode: 'single-choice',
                            isCustomInput: is_custom_input,
                            code: activity.code,
                        };
                        console.log('[ACTIVITY] Selected activity after single-choice selection:', window.selectedActivity);
                        setSingleActiveActivityButton(activityButton);
                    }
                    // Only close modal in single-choice mode
                    if (!isMultipleChoice) {
                        // Store the selected activity before closing modal to prevent it from being cleared
                        const preservedActivity = window.selectedActivity;

                        // Force close modals with a slight delay on mobile
                        if (getIsMobile()) {
                            setTimeout(() => {
                                const activitiesModal = document.getElementById('activitiesModal');
                                const customActivityModal = document.getElementById('customActivityModal');
                                if (activitiesModal) {
                                    activitiesModal.style.cssText = 'display: none !important';
                                }
                                if (customActivityModal) {
                                    customActivityModal.style.cssText = 'display: none !important';
                                }
                                // Restore window.selectedActivity after modal closes in case it was cleared
                                if (preservedActivity && !window.selectedActivity) {
                                    window.selectedActivity = preservedActivity;
                                    console.log('[MODAL] Restored window.selectedActivity:', window.selectedActivity);
                                } else {
                                    console.log('[MODAL] window.selectedActivity after close:', window.selectedActivity);
                                }
                            }, 50);
                        } else {
                            // Immediate close on desktop
                            const activitiesModal = document.getElementById('activitiesModal');
                            const customActivityModal = document.getElementById('customActivityModal');
                            if (activitiesModal) {
                                activitiesModal.style.cssText = 'display: none !important';
                            }
                            if (customActivityModal) {
                                customActivityModal.style.cssText = 'display: none !important';
                            }
                            // Restore window.selectedActivity after modal closes in case it was cleared
                            if (preservedActivity && !window.selectedActivity) {
                                window.selectedActivity = preservedActivity;
                            }
                        }
                    }
                });
                activityButtonsDiv.appendChild(activityButton);
            });

            categoryDiv.appendChild(activityButtonsDiv);
            container.appendChild(categoryDiv);
        });
    }
}

function initTimeline(timeline) {
    timeline.setAttribute('data-active', 'true');
    timeline.setAttribute('data-layout', getIsMobile() ? 'vertical' : 'horizontal');

    // Remove existing markers
    if (timeline.containerInstance && timeline.containerInstance.hourLabelsContainer) {
        timeline.containerInstance.hourLabelsContainer.innerHTML = '';
    }

    // Create and initialize timeline container
    const timelineContainer = new TimelineContainer(timeline);
    timelineContainer.initialize(getIsMobile()).createMarkers(getIsMobile());

    // Store the container instance and markers on the timeline element for later access
    timeline.containerInstance = timelineContainer;
    timeline.markers = timelineContainer.markers || [];

    // Add window resize handler to update marker positions
    window.addEventListener('resize', () => {
        const newIsMobile = window.innerWidth < 1440;
        timeline.setAttribute('data-layout', newIsMobile ? 'vertical' : 'horizontal');

        // Update dimensions on layout change
        if (newIsMobile) {
            const minHeight = '2500px';
            timeline.style.height = minHeight;
            timeline.style.width = '';
            timeline.parentElement.style.height = minHeight;

            // Update hour label container for mobile
            const hourLabelsContainer = timeline.querySelector('.hour-labels');
            if (hourLabelsContainer) {
                hourLabelsContainer.style.height = '100%';
                hourLabelsContainer.style.width = 'auto';
            }
        } else {
            timeline.style.height = '';
            timeline.style.width = '100%';
            timeline.parentElement.style.height = '';

            // Update hour label container for desktop
            const hourLabelsContainer = timeline.querySelector('.hour-labels');
            if (hourLabelsContainer) {
                hourLabelsContainer.style.width = '100%';
                hourLabelsContainer.style.height = 'auto';
            }
        }

        // Update all markers and their labels if they exist
        if (timeline.markers && timeline.markers.length > 0) {
            timeline.markers.forEach(marker => marker.update(newIsMobile));
        }
    });

    if (DEBUG_MODE) {
        timeline.addEventListener('mousemove', (e) => {
            const rect = timeline.getBoundingClientRect();
            updateDebugOverlay(e.clientX, e.clientY, rect);
        });

        timeline.addEventListener('mouseleave', () => {
            hideDebugOverlay();
        });
    }
}

// Add validation function before the interact.js initialization
function validateActivityBlockTransformation(startMinutes, endMinutes, target) {
    const MIN_BLOCK_LENGTH = 10; // Minimum block length in minutes
    const TIMELINE_START = 240; // 4:00 AM in minutes
    const TIMELINE_END = 1680; // 4:00 AM next day in minutes

    // Normalize end minutes if it wraps to next day
    const normalizedEndMinutes = endMinutes < startMinutes ? endMinutes + 1440 : endMinutes;

    // Calculate block length
    const blockLength = normalizedEndMinutes - startMinutes;

    // Validation checks
    if (blockLength <= 0 || blockLength < MIN_BLOCK_LENGTH) {
        console.warn('Invalid block length:', {
            startTime: formatTimeHHMM(startMinutes),
            endTime: formatTimeHHMM(endMinutes),
            length: blockLength,
            minLength: MIN_BLOCK_LENGTH
        });
        return false;
    }

    if (startMinutes < TIMELINE_START || endMinutes > TIMELINE_END) {
        console.warn('Time out of valid range:', {
            startTime: formatTimeHHMM(startMinutes),
            endTime: formatTimeHHMM(endMinutes),
            validRange: '04:00-04:00(+1)'
        });
        return false;
    }

    return true;
}

function initTimelineInteraction(timeline) {
    if (!timeline) {
        console.error('Timeline must be provided to initTimelineInteraction');
        return;
    }
    const targetTimeline = timeline;

    document.querySelectorAll('.timeline').forEach((timelineElement) => {
        timelineElement.tabIndex = 0;
        const timelineName = window.timelineManager?.metadata?.[timelineElement.id]?.name || 'Timeline';
        timelineElement.setAttribute('aria-label', timelineName);

        if (!timelineElement.dataset.spaceKeyActivationBound) {
            timelineElement.addEventListener('keydown', async (event) => {
                if (event.code !== 'Space' && event.key !== ' ' && event.key !== 'Spacebar') {
                    return;
                }

                event.preventDefault();
                await navigateToTimelineByKey(timelineElement.id);
            });
            timelineElement.dataset.spaceKeyActivationBound = 'true';
        }
    });

    // Initialize interact.js resizable
    interact('.activity-block').resizable({
        onstart: function(event) {
            // Store original values before resize
            const target = event.target;
            target.dataset.originalStart = target.dataset.start;
            target.dataset.originalEnd = target.dataset.end;
            target.dataset.originalLength = target.dataset.length;
            target.dataset.originalHeight = target.style.height;
            target.dataset.originalLeft = target.style.left;
            target.dataset.originalTop = target.style.top;
            target.dataset.originalWidth = target.style.width;
            // Store original raw minutes
            target.dataset.originalStartMinutes = target.dataset.startMinutes || timeToMinutes(target.dataset.start);
            target.dataset.originalEndMinutes = target.dataset.endMinutes || timeToMinutes(target.dataset.end);

            // Ensure autoscroll is enabled when resizing starts
            if (window.autoScrollModule && getIsMobile()) {
                window.autoScrollModule.enable();
            }
        },
        edges: {
            right: !getIsMobile(),
            left: !getIsMobile(),
            bottom: getIsMobile(),
            top: getIsMobile()
        },
        modifiers: [
            interact.modifiers.restrictEdges({
                outer: '.timeline',
                endOnly: true
            }),
            interact.modifiers.restrictSize({
                min: { width: 10, height: 10 }
            }),
            // Add snap modifier for 10-minute intervals
            interact.modifiers.snap({
                targets: [
                    interact.snappers.grid({
                        x: timelineRect => (10 / (24 * 60)) * timelineRect.width, // 10-minute intervals
                        y: timelineRect => (10 / (24 * 60)) * timelineRect.height
                    })
                ],
                range: Infinity,
                relativePoints: [ { x: 0, y: 0 } ]
            })
        ],
        inertia: false,
        listeners: {
            start(event) {
                event.target.classList.add('resizing');
            },
            move(event) {
                const target = event.target;
                const timelineRect = targetTimeline.getBoundingClientRect();
                let startMinutes, endMinutes;

                // Get time label at the beginning of the handler
                const timeLabel = target.querySelector('.time-label');

                target.classList.add('resizing');

                if (getIsMobile()) {
                    // Mobile: Handle vertical resizing
                    if (event.edges.top) {
                        // Get raw cursor position from event coordinates
                        const clientY = event.touches ? event.touches[0].clientY : event.clientY;
                        const timelineRect = targetTimeline.getBoundingClientRect();

                        // Calculate relative Y position within timeline bounds
                        const relativeY = clientY - timelineRect.top;
                        const clampedRelativeY = Math.max(0, Math.min(relativeY, timelineRect.height));
                        const positionPercent = (clampedRelativeY / timelineRect.height) * 100;

                        // Convert to raw minutes using timeline-based position
                        const rawMinutes = positionToMinutes(positionPercent, true);
                        startMinutes = Math.round(rawMinutes / 10) * 10;

                        // Keep original end time fixed
                        endMinutes = parseInt(target.dataset.endMinutes);

                        // Debug logging with accurate values
                        if (DEBUG_MODE) {
                            console.log('[Resize Top Edge]:', {
                                clientY,
                                timelineTop: timelineRect.top,
                                relativeY: clampedRelativeY,
                                timelineHeight: timelineRect.height,
                                position: positionPercent.toFixed(2) + '%',
                                time: formatTimeHHMM(startMinutes),
                                startMinutes,
                                endMinutes,
                                coverage: window.getTimelineCoverage()
                            });
                        }

                        // Validate time order
                        if (startMinutes >= endMinutes) {
                            console.warn('Invalid resize detected (vertical/top): Start time would be after end time', {
                                startTime: formatTimeHHMM(startMinutes),
                                endTime: formatTimeHHMM(endMinutes),
                                blockId: target.dataset.id
                            });
                            target.style.top = target.dataset.originalTop;
                            target.style.height = target.dataset.originalHeight;
                            target.classList.add('invalid');
                            setTimeout(() => target.classList.remove('invalid'), 400);
                            return;
                        }

                        // Validate transformations
                        if (!validateActivityBlockTransformation(startMinutes, endMinutes, target)) {
                            console.warn('Invalid resize detected (vertical/top): Invalid block transformation', {
                                startTime: formatTimeHHMM(startMinutes),
                                endTime: formatTimeHHMM(endMinutes),
                                blockId: target.dataset.id,
                                reason: 'Block transformation validation failed'
                            });
                            target.style.top = target.dataset.originalTop;
                            target.style.height = target.dataset.originalHeight;
                            target.classList.add('invalid');
                            setTimeout(() => target.classList.remove('invalid'), 400);
                            return;
                        }

                        // Check for overlaps
                        if (!canPlaceActivity(startMinutes, endMinutes, target.dataset.id)) {
                            console.warn('Invalid resize detected (vertical/top): Activity overlap', {
                                startTime: formatTimeHHMM(startMinutes),
                                endTime: formatTimeHHMM(endMinutes),
                                blockId: target.dataset.id
                            });
                            target.style.top = target.dataset.originalTop;
                            target.style.height = target.dataset.originalHeight;
                            target.classList.add('invalid');
                            setTimeout(() => target.classList.remove('invalid'), 400);
                            return;
                        }

                        // Update position and size using percentages
                        target.style.top = `${minutesToPercentage(startMinutes)}%`;
                        target.style.height = `${((endMinutes - startMinutes) / MINUTES_PER_DAY) * 100}%`;

                    } else if (event.edges.bottom) {
                        // Keep original start time fixed
                        startMinutes = parseInt(target.dataset.startMinutes);

                        // Get cursor position from event coordinates instead of element rect
                        const clientY = getIsMobile() ? (event.touches ? event.touches[0].clientY : event.clientY) : event.clientY;
                        const timelineRect = targetTimeline.getBoundingClientRect();

                        // Calculate relative Y position within timeline
                        const relativeY = clientY - timelineRect.top;
                        const positionPercent = Math.min(100, Math.max(0, (relativeY / timelineRect.height) * 100));

                        // For vertical bottom-edge resizing we want to allow reaching the timeline end (04:00(+1))
                        const rawMinutes = positionToMinutes(positionPercent, true, { allowEnd: true });

                        endMinutes = Math.round(rawMinutes / 10) * 10;

                        // Debug logging with corrected values
                        if (DEBUG_MODE) {
                            console.log('[Resize Bottom Edge]:', {
                                clientY: clientY,
                                timelineTop: timelineRect.top,
                                relativeY: relativeY,
                                timelineHeight: timelineRect.height,
                                position: positionPercent.toFixed(2) + '%',
                                time: formatTimeHHMM(endMinutes),
                                startMinutes: startMinutes,
                                endMinutes: endMinutes,
                                coverage: window.getTimelineCoverage()
                            });
                        }

                        // Add snap behavior for smoother resizing
                        const currentEndMinutes = parseInt(target.dataset.endMinutes);
                        const minutesDiff = Math.abs(endMinutes - currentEndMinutes);

                        // Only update if the change is at least 10 minutes
                        if (minutesDiff >= 10) {
                            // Validate time order
                            if (endMinutes <= startMinutes) {
                                target.style.height = target.dataset.originalHeight;
                                target.classList.add('invalid');
                                setTimeout(() => target.classList.remove('invalid'), 400);
                                return;
                            }

                            // Validate transformations
                            if (!validateActivityBlockTransformation(startMinutes, endMinutes, target)) {
                                target.style.height = target.dataset.originalHeight;
                                target.classList.add('invalid');
                                setTimeout(() => target.classList.remove('invalid'), 400);
                                return;
                            }

                            // Check for overlaps
                            if (!canPlaceActivity(startMinutes, endMinutes, target.dataset.id)) {
                                target.style.height = target.dataset.originalHeight;
                                target.classList.add('invalid');
                                setTimeout(() => target.classList.remove('invalid'), 400);
                                return;
                            }

                            // Update size using percentages
                            target.style.height = `${((endMinutes - startMinutes) / MINUTES_PER_DAY) * 100}%`;
                        }
                    }
                } else {
                    // Desktop: Handle left and right edge resizing differently
                    const tenMinutesWidth = (10 / (24 * 60)) * 100; // Width of 10-minute interval as percentage

                    if (event.edges.left) {
                        // Left edge resizing - adjust start time
                        const newLeft = (event.rect.left - timelineRect.left) / timelineRect.width * 100;
                        startMinutes = positionToMinutes(newLeft);
                        endMinutes = parseInt(target.dataset.endMinutes);

                        // Debug logging with accurate values
                        if (DEBUG_MODE) {
                            console.log('[Resize Left Edge]:', {
                                newLeft: newLeft.toFixed(2) + '%',
                                time: formatTimelineStart(startMinutes),
                                startMinutes,
                                endMinutes,
                                coverage: window.getTimelineCoverage()
                            });
                        }

                        // Validate time order considering next day times
                        const isEndNextDay = endMinutes < 240 || endMinutes >= 1440;
                        const isStartNextDay = startMinutes < 240 || startMinutes >= 1440;

                        // Check if the times would create an invalid order
                        if ((isStartNextDay === isEndNextDay && startMinutes >= endMinutes) ||
                            (!isStartNextDay && isEndNextDay && startMinutes >= 1440)) {
                            console.warn('Invalid resize detected (horizontal/left): Start time would be after end time', {
                                startTime: formatTimelineStart(startMinutes),
                                endTime: formatTimelineEnd(endMinutes),
                                blockId: target.dataset.id
                            });
                            target.style.left = target.dataset.originalLeft;
                            target.style.width = target.dataset.originalWidth;
                            target.classList.add('invalid');
                            setTimeout(() => target.classList.remove('invalid'), 400);
                            return;
                        }

                        // Validate transformations
                        if (!validateActivityBlockTransformation(startMinutes, endMinutes, target)) {
                            console.warn('Invalid resize detected (horizontal/left): Invalid block transformation', {
                                startTime: formatTimelineStart(startMinutes),
                                endTime: formatTimelineEnd(endMinutes),
                                blockId: target.dataset.id,
                                reason: 'Block transformation validation failed'
                            });
                            target.style.left = target.dataset.originalLeft;
                            target.style.width = target.dataset.originalWidth;
                            target.classList.add('invalid');
                            setTimeout(() => target.classList.remove('invalid'), 400);
                            return;
                        }

                        // Check for overlaps
                        if (!canPlaceActivity(startMinutes, endMinutes, target.dataset.id)) {
                            console.warn('Invalid resize detected (horizontal/left): Activity overlap', {
                                startTime: formatTimelineStart(startMinutes),
                                endTime: formatTimelineEnd(endMinutes),
                                blockId: target.dataset.id
                            });
                            target.style.left = target.dataset.originalLeft;
                            target.style.width = target.dataset.originalWidth;
                            target.classList.add('invalid');
                            setTimeout(() => target.classList.remove('invalid'), 400);
                            return;
                        }

                        // Update position and size
                        target.style.left = `${minutesToPercentage(startMinutes)}%`;
                        target.style.width = `${((endMinutes - startMinutes) / MINUTES_PER_DAY) * 100}%`;

                        // Update data attributes with properly formatted times
                        const newStartTime = formatTimelineStart(startMinutes);
                        const newEndTime = formatTimelineEnd(endMinutes);
                        target.dataset.start = newStartTime;
                        target.dataset.end = newEndTime;
                        target.dataset.startMinutes = startMinutes;
                        target.dataset.endMinutes = endMinutes;
                        target.dataset.length = endMinutes - startMinutes;

                        // Update time label
                        if (timeLabel) {
                            updateTimeLabel(timeLabel, newStartTime, newEndTime, target);
                        }
                    } else if (event.edges.right) {
                        // Right edge resizing - adjust end time using absolute timeline
                        const newRight = (event.rect.right - timelineRect.left) / timelineRect.width * 100;
                        const rawMinutes = positionToMinutes(newRight);
                        endMinutes = Math.round(rawMinutes / 10) * 10;

                        // Maintain original start time in absolute minutes
                        startMinutes = parseInt(target.dataset.startMinutes);

                        // Special case: If we're at the end of timeline (1680 minutes/04:00(+1))
                        const SNAP_THRESHOLD = 99.65;
                        if (newRight >= SNAP_THRESHOLD) {
                            endMinutes = 1680; // Absolute end of timeline (04:00 next day)
                        }

                        // Debug logging with accurate values
                        if (DEBUG_MODE) {
                            console.log('[Resize Right Edge]:', {
                                newRight: newRight.toFixed(2) + '%',
                                time: formatTimelineEnd(endMinutes),
                                startMinutes,
                                endMinutes,
                                coverage: window.getTimelineCoverage()
                            });
                        }

                        // Validate time order considering next day times
                        const isEndNextDay = endMinutes < 240 || endMinutes >= 1440;
                        const isStartNextDay = startMinutes < 240 || startMinutes >= 1440;

                        // Check if the times would create an invalid order
                        if ((isStartNextDay === isEndNextDay && startMinutes >= endMinutes) ||
                            (!isStartNextDay && isEndNextDay && startMinutes >= 1440)) {
                            console.warn('Invalid resize detected (horizontal/right): Start time would be after end time', {
                                startTime: formatTimelineStart(startMinutes),
                                endTime: formatTimelineEnd(endMinutes),
                                blockId: target.dataset.id
                            });
                            target.style.width = target.dataset.originalWidth;
                            target.classList.add('invalid');
                            setTimeout(() => target.classList.remove('invalid'), 400);
                            return;
                        }

                        // Validate transformations with absolute times
                        if (!validateActivityBlockTransformation(startMinutes, endMinutes, target)) {
                            console.warn('Invalid resize detected (horizontal/right): Block transformation validation failed', {
                                startTime: formatTimelineStart(startMinutes),
                                endTime: formatTimelineEnd(endMinutes),
                                blockId: target.dataset.id
                            });
                            target.style.width = target.dataset.originalWidth;
                            target.classList.add('invalid');
                            setTimeout(() => target.classList.remove('invalid'), 400);
                            return;
                        }

                        // Check for activity overlap
                        if (!canPlaceActivity(startMinutes, endMinutes, target.dataset.id)) {
                            console.warn('Invalid resize detected (horizontal/right): Activity overlap', {
                                startTime: formatTimelineStart(startMinutes),
                                endTime: formatTimelineEnd(endMinutes),
                                blockId: target.dataset.id
                            });
                            target.style.width = target.dataset.originalWidth;
                            target.classList.add('invalid');
                            setTimeout(() => target.classList.remove('invalid'), 400);
                            return;
                        }

                        // Update size
                        target.style.width = `${((endMinutes - startMinutes) / MINUTES_PER_DAY) * 100}%`;

                        // Update data attributes with properly formatted times
                        const newStartTime = formatTimelineStart(startMinutes);
                        const newEndTime = formatTimelineEnd(endMinutes);
                        target.dataset.start = newStartTime;
                        target.dataset.end = newEndTime;
                        target.dataset.startMinutes = startMinutes;
                        target.dataset.endMinutes = endMinutes;
                        target.dataset.length = endMinutes - startMinutes;

                        // Update time label
                        if (timeLabel) {
                            updateTimeLabel(timeLabel, newStartTime, newEndTime, target);
                        }
                    }
                }

                // Update time label and dataset
                if (timeLabel) {
                    // Format and update times - (+1) notation is handled automatically
                    const newStartTime = formatTimeHHMM(startMinutes, false);  // Start time
                    const newEndTime = formatTimeHHMM(endMinutes % MINUTES_PER_DAY, true);

                    // Final validation to ensure we never have negative length
                    let timeDiff = endMinutes - startMinutes;
                    if (timeDiff < 0 && !newEndTime.includes('(+1)')) {
                        // If we have negative length and we're not spanning midnight, revert
                        target.dataset.start = target.dataset.originalStart;
                        target.dataset.end = target.dataset.originalEnd;
                        target.dataset.length = target.dataset.originalLength;
                        target.style.left = target.dataset.originalLeft;
                        target.style.width = `${parseFloat(target.dataset.originalLength) * (100 / 1440)}%`;

                        console.warn('Invalid resize detected (final validation): Negative length', {
                            startTime: newStartTime,
                            endTime: newEndTime,
                            length: timeDiff,
                            blockId: target.dataset.id
                        });

                        target.classList.add('invalid');
                        setTimeout(() => target.classList.remove('invalid'), 400);
                        return;
                    }

                    target.dataset.start = newStartTime;
                    target.dataset.end = newEndTime;
                    target.dataset.length = timeDiff;
                    target.dataset.startMinutes = startMinutes;
                    target.dataset.endMinutes = endMinutes;
                    updateTimeLabel(timeLabel, newStartTime, newEndTime, target);

                    // Update text class based on length and mode
                    const textDiv = target.querySelector('div[class^="activity-block-text"]');
                    if (textDiv) {
                        textDiv.className = getIsMobile()
                            ? (timeDiff >= 60 ? 'activity-block-text-narrow wide resized' : 'activity-block-text-narrow')
                            : (timeDiff >= 60 ? 'activity-block-text-narrow wide resized' : 'activity-block-text-vertical');
                    }

                    // Update the activity data in timelineManager
                    const activityId = target.dataset.id;
                    const currentData = getCurrentTimelineData();
                    const activityIndex = currentData.findIndex(activity => activityIdsEqual(activity.id, activityId));

                    if (activityIndex !== -1) {
                        currentData[activityIndex].startTime = newStartTime;
                        currentData[activityIndex].endTime = newEndTime;
                        currentData[activityIndex].blockLength = parseInt(target.dataset.length);

                        // Update the minutes in the activity data
                        currentData[activityIndex].startMinutes = startMinutes;
                        currentData[activityIndex].endMinutes = endMinutes;

                        // Update original values incrementally
                        target.dataset.originalStart = newStartTime;
                        target.dataset.originalEnd = newEndTime;
                        target.dataset.originalLength = target.dataset.length;
                        target.dataset.originalHeight = target.style.height;
                        target.dataset.originalLeft = target.style.left;
                        target.dataset.originalTop = target.style.top;
                        target.dataset.originalWidth = target.style.width;
                        target.dataset.originalStartMinutes = startMinutes;
                        target.dataset.originalEndMinutes = endMinutes;

                        // Validate timeline after resizing activity
                        try {
                            const timelineKey = target.dataset.timelineKey;
                            if (!timelineKey) {
                                throw new Error('Timeline key not found on activity block');
                            }
                            window.timelineManager.metadata[timelineKey].validate();
                        } catch (error) {
                            console.error('Timeline validation failed:', error);
                            // Revert the change
                            target.dataset.start = target.dataset.originalStart;
                            target.dataset.end = target.dataset.originalEnd;
                            target.dataset.length = target.dataset.originalLength;
                            target.style.left = target.dataset.originalLeft;
                            target.style.width = `${parseFloat(target.dataset.originalLength) * (100 / 1440)}%`;
                            target.classList.add('invalid');
                            setTimeout(() => target.classList.remove('invalid'), 400);
                            return;
                        }
                    }
                }
            },
            end(event) {
                event.target.classList.remove('resizing');
                const textDiv = event.target.querySelector('div[class^="activity-block-text"]');
                const timeLabel = event.target.querySelector('.time-label');
                if (timeLabel) {
                    timeLabel.style.display = 'block';
                }
                if (textDiv) {
                    const length = parseInt(event.target.dataset.length);
                    textDiv.className = getIsMobile()
                        ? (length >= 60 ? 'activity-block-text-narrow wide resized' : 'activity-block-text-narrow')
                        : (length >= 60 ? 'activity-block-text-narrow wide resized' : 'activity-block-text-vertical');
                }
                // Disable autoscroll when resizing ends
                if (window.autoScrollModule) {
                    window.autoScrollModule.disable();
                }
                updateButtonStates();
            }
        }
    });

    // Add click and touch handling with debounce
    let lastClickTime = 0;
    const CLICK_DELAY = 300; // milliseconds

    // Unified handler function for both click and touch events
    const handleTimelineInteraction = (e) => {
        console.log('[TIMELINE] Event triggered:', e.type, 'window.selectedActivity:', window.selectedActivity);

        // Only process clicks on the active timeline
        if (!targetTimeline || targetTimeline !== window.timelineManager.activeTimeline) {
            console.log('[TIMELINE] Event ignored - not active timeline');
            return;
        }

        // Prevent double-clicks
        const currentTime = new Date().getTime();
        if (currentTime - lastClickTime < CLICK_DELAY) {
            console.log('[TIMELINE] Event ignored - within click delay');
            return;
        }
        lastClickTime = currentTime;

        if (!window.selectedActivity || e.target.closest('.activity-block')) {
            console.log('[TIMELINE] Event ignored - no window.selectedActivity or clicked on activity block');
            return;
        }

        const currentKey = getCurrentTimelineKey();
        // Check if timeline is full before proceeding
        if (isTimelineFull()) {
            const block = document.createElement('div');
            block.className = 'activity-block invalid';
            setTimeout(() => block.remove(), 400); // Remove after animation
            return;
        }

        // Ensure we're working with the current timeline data
        window.timelineManager.activities[currentKey] = getCurrentTimelineData();

        const rect = targetTimeline.getBoundingClientRect();
        const isMobile = getIsMobile();
        let clickPositionPercent;

        // Get coordinates from either mouse or touch event
        const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0));
        const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : 0));

        if (isMobile) {
            const y = clientY - rect.top;
            const clampedY = Math.max(0, Math.min(y, rect.height));
            clickPositionPercent = (clampedY / rect.height) * 100;
        } else {
            const x = clientX - rect.left;
            const clampedX = Math.max(0, Math.min(x, rect.width));
            clickPositionPercent = (clampedX / rect.width) * 100;
        }

        if (clickPositionPercent >= 100) {
            return;
        }

        // Get minutes and find nearest 10-minute markers
        let clickMinutes = positionToMinutes(clickPositionPercent);
        if (clickMinutes === null) {
            return;
        }

        // In vertical mode, we only need the start time from the click position
        // End time should always be start time + 10 minutes
        const startMinutes = Math.round(clickMinutes / 10) * 10;
        const endMinutes = startMinutes + 10;

        if (isNaN(startMinutes) || isNaN(endMinutes)) {
            console.error('Invalid minutes calculation:', { startMinutes, endMinutes });
            const invalidPlacementMessage = window.i18n
                ? window.i18n.t('messages.invalidPlacement')
                : 'Cannot place activity here due to invalid position.';
            alert(invalidPlacementMessage);
            return;
        }

        // Check if activity can be placed at this position
        if (!canPlaceActivity(startMinutes, endMinutes, null)) {
            console.warn('Invalid activity placement attempt:', {
                activity: window.selectedActivity.name,
                startMinutes,
                endMinutes,
                reason: 'Activity cannot be placed at this position due to overlap or timeline bounds'
            });
            const block = document.createElement('div');
            block.className = 'activity-block invalid';
            block.style.backgroundColor = window.selectedActivity.color;

            // Calculate position percentages
            const startPositionPercent = minutesToPercentage(startMinutes);
            const blockSize = (10 / 1440) * 100;  // 10 minutes as percentage of day

            if (isMobile) {
                block.style.height = `${blockSize}%`;
                block.style.top = `${startPositionPercent}%`;
                block.style.width = '50%';
                block.style.left = '25%';
            } else {
                block.style.width = `${blockSize}%`;
                block.style.left = `${startPositionPercent}%`;
                block.style.height = '50%';
                block.style.top = '25%';
            }

            targetTimeline.appendChild(block);
            setTimeout(() => block.remove(), 400); // Remove after animation
            return;
        }

        // Use the reusable createActivityBlock function instead of manual creation
        const formattedStartTime = formatTimeHHMM(startMinutes, false);
        const formattedEndTime = formatTimeHHMM(endMinutes, true);

        const activityData = {
            activity: window.selectedActivity.selections ?
                window.selectedActivity.selections.map(s => s.name).join(' | ') :
                window.selectedActivity.name,
            category: window.selectedActivity.category,
            code: window.selectedActivity.code,
            codes: window.selectedActivity.codes,
            startTime: formattedStartTime,
            endTime: formattedEndTime,
            blockLength: endMinutes - startMinutes,
            color: window.selectedActivity.color,
            parentName: window.selectedActivity.parentName,
            parentCode: window.selectedActivity.parentCode,
            selected: window.selectedActivity.selected,
            isCustomInput: window.selectedActivity.isCustomInput,
            originalSelection: window.selectedActivity.originalSelection,
            startMinutes: startMinutes,
            endMinutes: endMinutes,
            mode: window.selectedActivity.selections ? 'multiple-choice' : 'single-choice',
            count: window.selectedActivity.selections ? window.selectedActivity.selections.length : 1,
            selections: window.selectedActivity.selections || undefined,
            availableOptions: window.selectedActivity.availableOptions || undefined,
            timelineKey: currentKey
        };

        const result = createActivityBlock(activityData);
        const currentBlock = result.block;

        const activitiesContainer = window.timelineManager.activeTimeline.querySelector('.activities') || (() => {
            const container = document.createElement('div');
            container.className = 'activities';
            window.timelineManager.activeTimeline.appendChild(container);
            return container;
        })();

        // Hide all existing time labels
        activitiesContainer.querySelectorAll('.time-label').forEach(label => {
            label.style.display = 'none';
        });

        activitiesContainer.appendChild(currentBlock);

        // Create time label for both mobile and desktop modes
        const timeLabel = createTimeLabel(currentBlock);
        updateTimeLabel(timeLabel, formattedStartTime, formattedEndTime, currentBlock);
        timeLabel.style.display = 'block'; // Ensure the new label is visible

        // Deselect the activity button after successful placement
        console.log('[ACTIVITY] Clearing window.selectedActivity after successful placement');
        clearActiveActivitySelection();

        // Store in timelineManager
        getCurrentTimelineData().push(result.activityData);
        currentBlock.dataset.id = result.activityData.id;

        // Validate timeline after adding activity
        try {
            const timelineKey = currentBlock.dataset.timelineKey;
            window.timelineManager.metadata[timelineKey].validate();
        } catch (error) {
            console.error('Timeline validation failed:', error);
            console.warn('Invalid activity placement:', {
                activity: result.activityData.activity,
                category: result.activityData.category,
                timelineKey,
                reason: error.message
            });
            // Remove the invalid activity
            getCurrentTimelineData().pop();
            currentBlock.remove();
            const block = document.createElement('div');
            block.className = 'activity-block invalid';
            block.style.backgroundColor = window.selectedActivity.color;
            block.style.width = currentBlock.style.width;
            block.style.height = currentBlock.style.height;
            block.style.top = currentBlock.style.top;
            block.style.left = currentBlock.style.left;
            targetTimeline.appendChild(block);
            setTimeout(() => block.remove(), 400);
            return;
        }

        updateButtonStates();
        persistPendingTimelineStateSoon();

        console.log(`[Drag & Resize] Added event listeners for activity block: ${result.activityData.id}`);

    };

    // Add both click and touch event listeners for better mobile support
    targetTimeline.addEventListener('click', handleTimelineInteraction);

    // Add touch events specifically for mobile devices
    if (getIsMobile()) {
        targetTimeline.addEventListener('touchend', (e) => {
            // Prevent the click event from also firing
            e.preventDefault();
            handleTimelineInteraction(e);
        }, { passive: false });
    }

    // Update existing blocks to include parent/selected attributes if they don't have them
    interact('.activity-block').on('resizeend', function(event) {
        const target = event.target;

        // If this is an existing block and needs parent/selected attributes
        if (target.dataset.id && !target.hasAttribute('data-selected')) {
            const activityId = target.dataset.id;
            const currentData = getCurrentTimelineData();
            const activityData = currentData.find(a => activityIdsEqual(a.id, activityId));

            if (activityData) {
                // If block has parentName but no selected attribute
                if (target.dataset.parentName && !activityData.selected) {
                    // Activity name is stored in dataset or inner text
                    const textDiv = target.querySelector('div[class^="activity-block-text"]');
                    const activityName = textDiv ? textDiv.textContent.trim() : activityData.activity;

                    // Update the data structure
                    activityData.selected = activityData.activity;
                    //activityData.parentName = activityName;

                    // Update the block
                    target.setAttribute('title', `${activityName}: ${activityData.activity}`);
                } else if (!activityData.parentName) {
                    // For items without parent, both are the same
                    //activityData.parentName = activityData.activity;
                    activityData.selected = activityData.activity;
                }
            }
        }

        persistPendingTimelineStateSoon();
    });
}

export function loadTimelineFromJSON(jsonData) {
    console.log('loadTimelineFromJSON: Loading data for', jsonData.length, 'activities');

    // Group activities by timelineKey
    const activitiesByTimeline = {};
    jsonData.forEach(activity => {
        if (!activitiesByTimeline[activity.timelineKey]) {
            activitiesByTimeline[activity.timelineKey] = [];
        }
        activitiesByTimeline[activity.timelineKey].push(activity);
    });

    // Process each timeline
    Object.keys(activitiesByTimeline).forEach(timelineKey => {
        console.log(`Loading ${activitiesByTimeline[timelineKey].length} activities for timeline "${timelineKey}"`);

        // Check if this timeline exists
        if (!window.timelineManager.metadata[timelineKey]) {
            console.warn(`Timeline "${timelineKey}" not found in metadata`);
            return;
        }

        // Switch to this timeline if it's not the current one
        const currentKey = getCurrentTimelineKey();
        if (currentKey !== timelineKey) {
            // Find the timeline index
            const targetIndex = window.timelineManager.keys.indexOf(timelineKey);
            if (targetIndex !== -1 && targetIndex !== window.timelineManager.currentIndex) {
                console.log(`Switching to timeline "${timelineKey}" (index ${targetIndex})`);

                // Update current index and active timeline
                window.timelineManager.currentIndex = targetIndex;
                const timelineElement = document.getElementById(timelineKey);
                if (timelineElement) {
                    window.timelineManager.activeTimeline = timelineElement;

                    // Update UI to reflect the switch
                    const timeline = window.timelineManager.metadata[timelineKey];
                    const timelineTitle = document.querySelector('.timeline-title');
                    const timelineDescription = document.querySelector('.timeline-description');

                    if (timelineTitle) timelineTitle.textContent = timeline.name;
                    if (timelineDescription) timelineDescription.textContent = timeline.description;

                    // Update activities container mode
                    const activitiesContainer = document.querySelector("#activitiesContainer");
                    if (activitiesContainer) {
                        activitiesContainer.setAttribute('data-mode', timeline.mode);
                    }
                }
            }
        }

        // Clear existing activities for this timeline
        window.timelineManager.activities[timelineKey] = [];

        // Load activities in sorted order
        const sortedActivities = activitiesByTimeline[timelineKey].sort((a, b) => a.startMinutes - b.startMinutes);
        sortedActivities.forEach(activityData => {
            recreateActivityBlockFromTemplate(activityData);
        });
    });

    // Switch back to first timeline for better UX
    if (window.timelineManager.currentIndex !== 0) {
        window.timelineManager.currentIndex = 0;
        const firstTimelineKey = window.timelineManager.keys[0];
        const firstTimelineElement = document.getElementById(firstTimelineKey);
        if (firstTimelineElement) {
            window.timelineManager.activeTimeline = firstTimelineElement;

            // Update UI
            const timeline = window.timelineManager.metadata[firstTimelineKey];
            const timelineTitle = document.querySelector('.timeline-title');
            const timelineDescription = document.querySelector('.timeline-description');

            if (timelineTitle) timelineTitle.textContent = timeline.name;
            if (timelineDescription) timelineDescription.textContent = timeline.description;

            // Update activities container
            const activitiesContainer = document.querySelector("#activitiesContainer");
            if (activitiesContainer) {
                activitiesContainer.setAttribute('data-mode', timeline.mode);
            }
        }
    }

    updateButtonStates();
    console.log('Finished loading timeline data');
}

export function loadTimelineFromJSONOldAndCurrentlyUnused(jsonData) {
    console.log('loadTimelineFromJSON: Loading timeline data from JSON...');
    console.trace('loadTimelineFromJSON called from:');

    // Group activities by timelineKey
    const activitiesByTimeline = {};
    jsonData.forEach(activity => {
        if (!activitiesByTimeline[activity.timelineKey]) {
            activitiesByTimeline[activity.timelineKey] = [];
        }
        activitiesByTimeline[activity.timelineKey].push(activity);
    });

    // Process each timeline
    Object.keys(activitiesByTimeline).forEach(timelineKey => {
        console.log(`loadTimelineFromJSON: === PROCESSING TIMELINE: ${timelineKey} ===`);
        console.log(`loadTimelineFromJSON: Number of activities for ${timelineKey}:`, activitiesByTimeline[timelineKey].length);
        // Check if this timeline exists in our metadata
        if (!window.timelineManager.metadata[timelineKey]) {
            console.warn(`loadTimelineFromJSON: Timeline "${timelineKey}" not found in metadata, skipping activities`);
            return;
        }

        // Clear existing activities for this timeline
        window.timelineManager.activities[timelineKey] = [];

        // Switch to this timeline temporarily to create DOM elements
        const timelineElement = document.getElementById(timelineKey);
        if (timelineElement) {
            window.timelineManager.activeTimeline = timelineElement;

            // Load activities in sorted order
            const sortedActivities = activitiesByTimeline[timelineKey].sort((a, b) => a.startMinutes - b.startMinutes);
            sortedActivities.forEach(activityData => {
                recreateActivityBlockFromTemplate(activityData);
            });

            console.log(`loadTimelineFromJSON: Loaded ${sortedActivities.length} activities for timeline "${timelineKey}"`);
        } else {
            console.warn(`loadTimelineFromJSON: Timeline element "${timelineKey}" not found in DOM`);
        }
    });

    updateButtonStates();
    console.log(`loadTimelineFromJSON: Loaded ${jsonData.length} total activities from JSON`);
}


/**
 * Converts absolute minutes since midnight to frontend HH:MM/(+1) notation.
 *
 * @param {number} minutes Absolute minutes value.
 * @param {boolean} isEndTime Whether the value is an end time.
 * @returns {string} Formatted frontend time string (e.g. `14:10` or `00:50(+1)`).
 */
function minutesSinceMidnightToHHMM(minutes, isEndTime = false) {
    return formatTimeHHMM(minutes, isEndTime);
}

/// Transform backend activities response to frontend format.
/// This is for answer from endpoint like /studies/{study_name}/participants/{participant_uid}/day_label_index/{day_index}/activities/.
/// The backend uses some different field names and formats (snake_case instead of CamelCase), so we need to convert them.
function transformBackendActivitiesResponse(backendData) {
    try {
        // Extract mapping logic into separate function
        const mapActivityItem = (activity) => ({
            timelineKey: activity.timeline_key,
            activity: activity.activity,
            category: activity.category || "Travel & Transit",
            startTime: minutesSinceMidnightToHHMM(activity.start_minutes, false),
            endTime: minutesSinceMidnightToHHMM(activity.end_minutes, true),
            blockLength: activity.duration,
            color: activity.color || '#cccccc',
            parentName: activity.parent_activity || null,
            parentCode: activity.parent_activity_code || null,
            isCustomInput: activity.is_custom_input || false,
            originalSelection: activity.original_selection || null,
            startMinutes: activity.start_minutes,
            endMinutes: activity.end_minutes,
            mode: activity.timeline_mode,
            selections: activity.selections || null,
            availableOptions: activity.available_options || null,
            count: activity.selections ? activity.selections.length : 1,
            id: activity.activity_id_backend || generateUniqueId(),
            code: activity.activity_code,
            day_label_index: activity.day_label_index,
            day_label: activity.day_label || null,
        });

        const backendJson = backendData;

        // Apply mapping to both activities arrays separately
        // Keep them separate as they are different things
        backendData.activities = backendJson.activities
            ? backendJson.activities.map(mapActivityItem)
            : [];

        backendData.template_activities = backendJson.template_activities
            ? backendJson.template_activities.map(mapActivityItem)
            : [];

    } catch (error) {
        console.error("Error transforming backend response, returning empty array. Error details:", error);
        return [];
    }

    console.log("Returning transformed activities: ", backendData.activities);
    console.log("Transformed template activities: ", backendData.template_activities);
    return backendData;
}


function showTemplateBanner(templateSourceDay) {
    // Check if banner already exists
    const existingBanner = document.getElementById('templateBanner');
    if (existingBanner) {
        existingBanner.remove();
    }

    // Create banner element
    const banner = document.createElement('div');
    banner.id = 'templateBanner';
    banner.className = 'template-banner';
    banner.style.cssText = `
        background-color: #4CAF50; /* Green for positive/helpful message */
        color: white;
        padding: 12px 20px;
        position: relative;
        z-index: 999;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        font-size: 15px;
        line-height: 1.4;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        max-width: 1200px;
        margin: 0 auto;
    `;

    const text = document.createElement('span');
    text.innerHTML = i18n.t('messages.templateLoadedBanner', { day: templateSourceDay });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = i18n.t('buttons.close');
    closeBtn.style.cssText = `
        background: none;
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s;
        flex-shrink: 0;
        margin-left: 15px;
    `;

    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    });
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.backgroundColor = 'transparent';
    });

    closeBtn.addEventListener('click', () => {
        banner.style.display = 'none';
    });

    content.appendChild(text);
    content.appendChild(closeBtn);
    banner.appendChild(content);

    // Insert after any existing instruction banner, or at top of body
    const instructionBanner = document.getElementById('instructionBanner');
    if (instructionBanner && instructionBanner.parentNode) {
        instructionBanner.parentNode.insertBefore(banner, instructionBanner.nextSibling);
    } else {
        document.body.insertBefore(banner, document.body.firstChild);
    }

}

function resolveDisplayDayLabel(dayLabel) {
    if (!dayLabel) {
        return dayLabel;
    }

    if (typeof dayLabel === 'object') {
        return dayLabel.display_name || dayLabel.name || String(dayLabel);
    }

    const studyDayLabels = window.timelineManager?.studyConfig?.day_labels;
    if (!Array.isArray(studyDayLabels)) {
        return dayLabel;
    }

    const matched = studyDayLabels.find((label) => {
        if (!label || typeof label !== 'object') {
            return false;
        }
        return label.name === dayLabel || label.display_name === dayLabel;
    });

    if (!matched) {
        return dayLabel;
    }

    return matched.display_name || matched.name || dayLabel;
}

function getCurrentDayIndex() {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('day_label_index')) || 0;
}

function normalizeLanguageCode(language) {
    if (typeof language !== 'string') {
        return null;
    }
    const normalized = language.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    const primarySubtag = normalized.split('-')[0];
    if (!/^[a-z]{2}$/.test(primarySubtag)) {
        return null;
    }
    return primarySubtag;
}

function getPreferredLanguage(supportedLanguages = [], fallbackLanguage = 'en') {
    const normalizedSupported = (Array.isArray(supportedLanguages) ? supportedLanguages : [])
        .map((language) => normalizeLanguageCode(language))
        .filter(Boolean);
    const supportedSet = new Set(normalizedSupported);

    const pickIfSupported = (candidate) => {
        const normalizedCandidate = normalizeLanguageCode(candidate);
        if (!normalizedCandidate) {
            return null;
        }
        if (supportedSet.size === 0 || supportedSet.has(normalizedCandidate)) {
            return normalizedCandidate;
        }
        return null;
    };

    const urlLanguage = new URLSearchParams(window.location.search).get('lang');
    const fromUrl = pickIfSupported(urlLanguage);
    if (fromUrl) {
        return fromUrl;
    }

    const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];

    for (const browserLanguage of browserLanguages) {
        const picked = pickIfSupported(browserLanguage);
        if (picked) {
            return picked;
        }
    }

    return pickIfSupported(fallbackLanguage)
        || normalizedSupported[0]
        || normalizeLanguageCode(fallbackLanguage)
        || 'en';
}

const PENDING_TIMELINE_STATE_KEY = 'trac.pendingTimelineState.v1';
const DRAFT_TIMELINE_STATE_KEY = 'trac.timelineDraftState.v1';
const DRAFT_TIMELINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getPendingTimelineContext() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
        pid: urlParams.get('pid') || '',
        study_name: urlParams.get('study_name') || TUD_SETTINGS.DEFAULT_STUDY_NAME,
        day_label_index: String(parseInt(urlParams.get('day_label_index')) || 0),
    };
}

function hasAnyLocalActivities() {
    return Object.values(window.timelineManager?.activities || {}).some(
        activities => Array.isArray(activities) && activities.length > 0
    );
}

function clearStoredTimelineState() {
    sessionStorage.removeItem(PENDING_TIMELINE_STATE_KEY);
    localStorage.removeItem(DRAFT_TIMELINE_STATE_KEY);
}

function storeTimelineState(storage, key, payload) {
    try {
        storage.setItem(key, JSON.stringify(payload));
        return true;
    } catch (error) {
        console.warn(`Failed to store timeline state in ${key}:`, error);
        return false;
    }
}

function readStoredTimelineState(storage, key) {
    const raw = storage.getItem(key);
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.warn(`Invalid stored timeline state payload for ${key}, clearing it:`, error);
        storage.removeItem(key);
        return null;
    }
}

function isStoredTimelineStateFresh(payload) {
    const savedAt = Number(payload?.savedAt);
    if (!Number.isFinite(savedAt)) {
        return false;
    }

    return Date.now() - savedAt <= DRAFT_TIMELINE_MAX_AGE_MS;
}

window.__TRAC_CAPTURE_PENDING_STATE = function capturePendingTimelineState() {
    try {
        if (!window.timelineManager || !window.timelineManager.activities) {
            return false;
        }

        const allActivities = Object.values(window.timelineManager.activities)
            .flat()
            .filter(activity => activity && activity.timelineKey);

        if (!allActivities.length) {
            clearStoredTimelineState();
            return false;
        }

        const payload = {
            ...getPendingTimelineContext(),
            savedAt: Date.now(),
            currentIndex: window.timelineManager.currentIndex,
            activities: JSON.parse(JSON.stringify(allActivities)),
        };

        const storedInSession = storeTimelineState(sessionStorage, PENDING_TIMELINE_STATE_KEY, payload);
        const storedInLocal = storeTimelineState(localStorage, DRAFT_TIMELINE_STATE_KEY, payload);
        return storedInSession || storedInLocal;
    } catch (error) {
        console.warn('Failed to store pending timeline state:', error);
        return false;
    }
};

window.__TRAC_CLEAR_PENDING_STATE = clearStoredTimelineState;

function persistPendingTimelineStateSoon() {
    window.clearTimeout(window.__TRAC_PERSIST_DRAFT_TIMER);
    window.__TRAC_PERSIST_DRAFT_TIMER = window.setTimeout(() => {
        if (typeof window.__TRAC_CAPTURE_PENDING_STATE === 'function') {
            window.__TRAC_CAPTURE_PENDING_STATE();
        }
    }, 100);
}

async function tryRestorePendingTimelineState(participantId, studyName, dayIndex) {
    const sessionPayload = readStoredTimelineState(sessionStorage, PENDING_TIMELINE_STATE_KEY);
    const localPayload = readStoredTimelineState(localStorage, DRAFT_TIMELINE_STATE_KEY);

    let payload = sessionPayload;
    if (!payload && localPayload && isStoredTimelineStateFresh(localPayload)) {
        payload = localPayload;
    }

    if (!payload) {
        if (localPayload && !isStoredTimelineStateFresh(localPayload)) {
            localStorage.removeItem(DRAFT_TIMELINE_STATE_KEY);
        }
        return false;
    }

    const expected = {
        pid: participantId || '',
        study_name: studyName || '',
        day_label_index: String(dayIndex),
    };

    const sameContext =
        payload?.pid === expected.pid &&
        payload?.study_name === expected.study_name &&
        payload?.day_label_index === expected.day_label_index;

    if (!sameContext) {
        if (localPayload && payload === localPayload) {
            localStorage.removeItem(DRAFT_TIMELINE_STATE_KEY);
        }
        return false;
    }

    if (hasAnyLocalActivities()) {
        clearStoredTimelineState();
        return false;
    }

    const restoredActivities = Array.isArray(payload.activities) ? payload.activities : [];
    if (!restoredActivities.length) {
        clearStoredTimelineState();
        return false;
    }

    const restoredKeys = [
        ...new Set(
            restoredActivities
                .map(activity => activity.timelineKey)
                .filter(key => window.timelineManager.keys.includes(key))
        ),
    ];

    if (!restoredKeys.length) {
        clearStoredTimelineState();
        return false;
    }

    console.log(`Restoring ${restoredActivities.length} pending activities after reload.`);

    for (const timelineKey of restoredKeys) {
        const targetIndex = window.timelineManager.keys.indexOf(timelineKey);
        if (targetIndex < 0) {
            continue;
        }

        while (window.timelineManager.currentIndex < targetIndex) {
            await addNextTimeline();
        }

        window.timelineManager.activities[timelineKey] = [];
        const timelineActivities = restoredActivities
            .filter(activity => activity.timelineKey === timelineKey)
            .sort((a, b) => (a.startMinutes || 0) - (b.startMinutes || 0));

        timelineActivities.forEach(activity => {
            recreateActivityBlockFromTemplate(activity);
        });
    }

    while (window.timelineManager.currentIndex > 0) {
        await goToPreviousTimeline();
    }

    updateButtonStates();
    if (typeof window.__TRAC_CAPTURE_PENDING_STATE === 'function') {
        window.__TRAC_CAPTURE_PENDING_STATE();
    }
    return true;
}

function isInstructionsPagePath(pathname = window.location.pathname) {
    return pathname.includes('/instructions/') || /\/pages\/instructions(?:\.html)?$/.test(pathname);
}

function ensureLanguageSelector(supportedLanguages, selectedLanguage) {
    if (!Array.isArray(supportedLanguages) || supportedLanguages.length <= 1) {
        return;
    }

    const controlsContainer = document.querySelector('.header-section .controls');
    if (!controlsContainer) {
        return;
    }

    const normalizedSelectedLanguage = normalizeLanguageCode(selectedLanguage);
    const existingSelector = document.getElementById('languageSelectMain');
    if (existingSelector) {
        existingSelector.value = normalizedSelectedLanguage || existingSelector.value;
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '0.4rem';
    wrapper.style.marginLeft = '0.5rem';

    const label = document.createElement('label');
    label.setAttribute('for', 'languageSelectMain');
    label.textContent = 'Language';
    label.setAttribute('data-i18n', 'common.language');
    label.style.fontSize = '0.85rem';

    const select = document.createElement('select');
    select.id = 'languageSelectMain';
    select.setAttribute('aria-label', 'Choose language');
    select.setAttribute('data-i18n-aria-label', 'common.chooseLanguage');

    supportedLanguages.forEach((language) => {
        const normalizedLanguage = normalizeLanguageCode(language) || language;
        const option = document.createElement('option');
        option.value = normalizedLanguage;
        option.textContent = normalizedLanguage.toUpperCase();
        if (normalizedLanguage === normalizedSelectedLanguage) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    select.addEventListener('change', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('lang', select.value);
        window.location.href = url.toString();
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    controlsContainer.appendChild(wrapper);
}

function getDayButtonDisplayLabel(dayIndex) {
    const displayLabel = window.studyConfigManager?.getDayDisplayLabel(dayIndex) || `day_${dayIndex + 1}`;

    if (/^day_\d+$/i.test(String(displayLabel))) {
        const dayWord = window.i18n && window.i18n.isReady()
            ? i18n.t('common.day')
            : 'Day';
        return `${dayWord} ${dayIndex + 1}`;
    }

    return displayLabel;
}

async function saveAndSwitchToDay(targetDayIndex) {
    const currentDayIndex = getCurrentDayIndex();
    if (targetDayIndex === currentDayIndex) {
        return;
    }

    const row = document.getElementById('previousDaysSwitchRow');
    const rowButtons = row ? row.querySelectorAll('button') : [];
    rowButtons.forEach((button) => {
        button.disabled = true;
    });

    const result = await sendData({
        mode: 'json',
        shouldRedirect: false,
        isLastDay: false,
        currentDayIndex
    });

    if (!result?.success) {
        if (window.showToast) {
            const submitErrorMessage = window.i18n
                ? window.i18n.t('messages.submitError')
                : 'Error submitting diary';
            const errorDetails = result?.error ? `: ${result.error}` : '';
            window.showToast(`${submitErrorMessage}${errorDetails}`, 'error', 5000);
        }

        rowButtons.forEach((button) => {
            button.disabled = false;
        });
        return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('day_label_index', String(targetDayIndex));
    window.location.href = url.toString();
}

function renderPreviousDaysSwitchRow() {
    const controlsContainer = document.querySelector('.header-section .controls');
    if (!controlsContainer || !controlsContainer.parentElement) {
        return;
    }

    const currentDayIndex = getCurrentDayIndex();
    const availableDayIndices = Array.isArray(window.timelineManager?.dayIndicesWithData)
        ? window.timelineManager.dayIndicesWithData
        : [];

    const switchTargetDayIndices = [...new Set(availableDayIndices)]
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value !== currentDayIndex)
        .sort((left, right) => left - right);

    const shouldShow = Boolean(TUD_SETTINGS.SHOW_PREVIOUS_DAYS_BUTTONS) && switchTargetDayIndices.length > 0;

    let existingRow = document.getElementById('previousDaysSwitchRow');
    if (!shouldShow) {
        if (existingRow) {
            existingRow.remove();
        }
        return;
    }

    if (!existingRow) {
        existingRow = document.createElement('div');
        existingRow.id = 'previousDaysSwitchRow';
        existingRow.className = 'previous-days-switch-row';
        controlsContainer.insertAdjacentElement('afterend', existingRow);
    }

    existingRow.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'previous-days-switch-label';
    label.setAttribute('data-i18n', 'messages.goBackToEditPreviousDays');
    label.textContent = window.i18n && window.i18n.isReady()
        ? i18n.t('messages.goBackToEditPreviousDays')
        : 'Switch to day:';
    existingRow.appendChild(label);

    for (const dayIndex of switchTargetDayIndices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn previous-day-btn';
        button.textContent = getDayButtonDisplayLabel(dayIndex);

        button.addEventListener('click', async () => {
            await saveAndSwitchToDay(dayIndex);
        });

        existingRow.appendChild(button);
    }

    if (window.i18n && window.i18n.isReady()) {
        i18n.applyTranslations(existingRow);
    }
}


async function init() {
    console.log('==================== Initializing TUD frontend application... ====================');
    try {
        await window.studyConfigManager?.initializeStudyConfig();

        const currentStudy = window.studyConfigManager?.getCurrentStudy();
        if (!currentStudy) {
            throw new Error('Failed to load study configuration');
        }

        console.log('[TRAC day-label-debug] after initializeStudyConfig', {
            selected_language: currentStudy.selected_language,
            default_language: currentStudy.default_language,
            supported_languages: currentStudy.supported_languages,
            first_day_label: currentStudy.day_labels?.[0] || null,
            day_labels_count: Array.isArray(currentStudy.day_labels) ? currentStudy.day_labels.length : 0,
            url_lang: new URLSearchParams(window.location.search).get('lang'),
        });

        console.log(`Study: ${currentStudy.name} (${currentStudy.name_short})`);
        console.log(`Days: ${window.studyConfigManager.getStudyDaysCount()}`);
        console.log(`Source: ${currentStudy.source || 'file'}`);

        ensureLanguageSelector(currentStudy.supported_languages || [], currentStudy.selected_language || currentStudy.default_language || 'en');

        // Reinitialize timelineManager with an empty study object
        window.timelineManager = {
            metadata: {},
            activities: {},
            initialized: new Set(),
            activeTimeline: null,
            keys: [],
            currentIndex: 0,
            study: {},
            general: {},
            dayIndicesWithData: []
        };

        // Store study info in timelineManager for easy access
        window.timelineManager.studyConfig = currentStudy;
        window.timelineManager.studyDaysCount = window.studyConfigManager.getStudyDaysCount();
        window.timelineManager.dayLabels = currentStudy.day_labels;

        // Now sync URL parameters so they are stored in timelineManager.study
        syncURLParamsToStudy();

        checkAndRequestPID();
        preventPullToRefresh();
        let configLoadBackendSuccess = false;

        // Get URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const participantId = urlParams.get('pid');
        const studyName = urlParams.get('study_name') || TUD_SETTINGS.DEFAULT_STUDY_NAME;
        const templateUser = (urlParams.get('template_user') || '').trim() || null;
        const selectedLanguage = getPreferredLanguage(
            currentStudy.supported_languages || [],
            urlParams.get('lang') || currentStudy.selected_language || currentStudy.default_language || 'en'
        );

        // Keep shared study cache aligned with effective language choice.
        currentStudy.selected_language = selectedLanguage;
        ensureLanguageSelector(currentStudy.supported_languages || [], selectedLanguage);

        console.log('[TRAC day-label-debug] selected language before i18n/backend activities fetch', {
            selectedLanguage,
            url_lang: urlParams.get('lang'),
            currentStudy_selected_language: currentStudy.selected_language,
            currentStudy_default_language: currentStudy.default_language,
            supported_languages: currentStudy.supported_languages,
        });

        try {
            await i18n.init(selectedLanguage);
            i18n.applyTranslations();
        } catch (i18nPreloadError) {
            console.warn('Failed to preload i18n before backend config fetch:', i18nPreloadError);
        }

        const urlLangNormalized = normalizeLanguageCode(urlParams.get('lang'));
        if (!urlLangNormalized || urlLangNormalized !== selectedLanguage) {
            urlParams.set('lang', selectedLanguage);
            window.history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}`);
            window.timelineManager.study.lang = selectedLanguage;
        }

        const dayIndex = getCurrentDayIndex();

        // ===== FETCH ACTIVITIES CONFIG FROM BACKEND =====
        let configData = null;

        if (!participantId || !studyName) {
            throw new Error('Missing participant ID or study name in URL parameters');
        }

        const footerStatus = document.getElementById('footer_backend_status');
        const updateFooterBackendStatus = (statusKey, color, fallbackText) => {
            if (!footerStatus) {
                return;
            }

            footerStatus.setAttribute('data-i18n', statusKey);
            footerStatus.textContent = window.i18n && window.i18n.isReady()
                ? i18n.t(statusKey)
                : fallbackText;
            footerStatus.style.color = color;
        };

        try {
            configData = await loadActivitiesConfig({
                participantId,
                studyName,
                lang: selectedLanguage,
                apiBaseUrl: TUD_SETTINGS.API_BASE_URL,
                settingsBasePath: 'settings',
                preferBackend: true,
                requireBackend: true,
                useCache: true,
            });
            console.log('Successfully loaded activities config from backend');
            document.title = configData.general.app_name || 'Time Use Diary';
            configLoadBackendSuccess = true;

        } catch (error) {
            console.error('Failed to load activities config from backend:', error);
            configLoadBackendSuccess = false;
            if(footerStatus) {
                    updateFooterBackendStatus('footer.backend_status_error', 'red', 'Backend error');
            } else {
                console.warn('Footer status element not found, cannot display backend error status');
            }
            document.title = 'Time Use Diary';
            throw new Error(`Cannot load activities configuration: ${error.message}. The application requires backend configuration to run.`);
        }

        // Save global configuration
        window.timelineManager.general = configData.general;

        // Initialize i18n (internationalization) system
        let language = configData.general.language || 'en';

        // Override with URL/study-selected language if available
        if (selectedLanguage) {
            language = selectedLanguage;
        } else if (currentStudy.default_language) {
            language = currentStudy.default_language;
        }

        await i18n.init(language);
        i18n.applyTranslations();
        renderPreviousDaysSwitchRow();

        if (footerStatus) {
            if (configLoadBackendSuccess) {
                updateFooterBackendStatus('footer.backend_status_connected', '#ccc', 'Connected to backend');
            } else {
                updateFooterBackendStatus('footer.backend_status_error', 'red', 'Backend error');
            }
        }


        // Handle instructions or redirection if needed
        const instructionsConfig = configData.general?.instructions;

        if (instructionsConfig && !new URLSearchParams(window.location.search).has('instructions')) {
            if (!isInstructionsPagePath()) {
                const currentParams = new URLSearchParams(window.location.search);
                let redirectPath;

                // Determine the redirect path based on configuration type
                if (typeof instructionsConfig === 'boolean') {
                    // Boolean: true = default instructions, false = no instructions
                    if (instructionsConfig === true) {
                        redirectPath = 'pages/instructions.html'; // Default
                    } else {
                        redirectPath = null; // No redirection
                    }
                } else if (typeof instructionsConfig === 'string') {
                    // String: could be URL or path
                    const trimmed = instructionsConfig.trim();
                    if (trimmed === '') {
                        redirectPath = null;
                    } else if (trimmed.startsWith('/') ||
                            trimmed.startsWith('./') ||
                            trimmed.startsWith('../') ||
                            trimmed.endsWith('.html')) {
                        // Relative path or HTML file
                        redirectPath = trimmed;
                    } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                        // Full URL - redirect immediately
                        const redirectUrl = new URL(trimmed);
                        currentParams.forEach((value, key) => {
                            redirectUrl.searchParams.append(key, value);
                        });
                        window.location.href = redirectUrl.toString();
                        return;
                    } else {
                        // Assume relative path
                        redirectPath = trimmed;
                    }
                }

                if (redirectPath) {
                    const redirectUrl = new URL(redirectPath, window.location.href);
                    currentParams.forEach((value, key) => {
                        redirectUrl.searchParams.append(key, value);
                    });
                    window.location.href = redirectUrl.toString();
                    return;
                }
            }
        } else if (isInstructionsPagePath()) {
            // Check if we should redirect back from instructions page
            const shouldStayOnInstructions = instructionsConfig &&
                (typeof instructionsConfig === 'boolean' && instructionsConfig === true) ||
                (typeof instructionsConfig === 'string' && instructionsConfig.trim() !== '');

            if (!shouldStayOnInstructions) {
                const currentParams = new URLSearchParams(window.location.search);
                const redirectUrl = new URL('index.html', window.location.href);
                currentParams.forEach((value, key) => {
                    redirectUrl.searchParams.append(key, value);
                });
                window.location.href = redirectUrl.toString();
                return;
            }
        }

        // Initialize timeline management structure with timeline keys
        window.timelineManager.keys = Object.keys(configData.timeline);
        window.timelineManager.keys.forEach(timelineKey => {
            window.timelineManager.metadata[timelineKey] = new Timeline(timelineKey, configData.timeline[timelineKey]);
            window.timelineManager.activities[timelineKey] = [];
        });

        // Create timelines wrapper if it doesn't exist
        const timelinesWrapper = document.querySelector('.timelines-wrapper');
        if (!timelinesWrapper) {
            throw new Error('Timelines wrapper not found');
        }

        // Get max day index from study config
        const maxDayIndex = window.studyConfigManager.getStudyDaysCount() - 1;

        if (dayIndex > maxDayIndex) {
            console.warn(`Day index ${dayIndex} is out of range. Adjusting to last day (${maxDayIndex})`);
            urlParams.set('day_label_index', maxDayIndex);
            window.history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}`);
        } else {
            console.log(`Current day index from URL: ${dayIndex}`);
        }

        // Initialize first timeline using addNextTimeline
        window.timelineManager.currentIndex = -1; // Start at -1 so first addNextTimeline() sets to 0
        await addNextTimeline(); // Only add first timeline initially

        const restoredPendingState = await tryRestorePendingTimelineState(participantId, studyName, dayIndex);
        if (restoredPendingState) {
            console.log('Successfully restored pending timeline activities from session state.');
        }

        let loadedActivitiesFromBackend = restoredPendingState;

        // Helper to load a list of activities (already transformed to frontend format)
        // into the currently initialized timeline manager.
        const loadActivitiesIntoTimelineManager = async (activitiesToLoad) => {
            if (!activitiesToLoad || activitiesToLoad.length === 0) {
                return false;
            }

            const loadedTimelineKeySet = new Set(activitiesToLoad.map(a => a.timelineKey));
            const loadedTimelineKeys = window.timelineManager.keys.filter(key => loadedTimelineKeySet.has(key));

            for (let i = 0; i < loadedTimelineKeys.length; i++) {
                const timelineKey = loadedTimelineKeys[i];

                if (i === 0) {
                    const firstTimelineActivities = activitiesToLoad.filter(
                        a => a.timelineKey === timelineKey
                    );
                    window.timelineManager.activities[timelineKey] = firstTimelineActivities;

                    firstTimelineActivities.forEach(activityData => {
                        recreateActivityBlockFromTemplate(activityData);
                    });
                } else {
                    console.log(`Creating timeline ${timelineKey} (${i + 1}/${loadedTimelineKeys.length})`);

                    const originalIndex = window.timelineManager.currentIndex;
                    const targetIndex = window.timelineManager.keys.indexOf(timelineKey);

                    if (targetIndex > originalIndex) {
                        while (window.timelineManager.currentIndex < targetIndex) {
                            await addNextTimeline();
                        }

                        const timelineActivities = activitiesToLoad.filter(
                            a => a.timelineKey === timelineKey
                        );

                        if (timelineActivities.length > 0) {
                            window.timelineManager.activities[timelineKey] = timelineActivities;

                            timelineActivities.forEach(activityData => {
                                recreateActivityBlockFromTemplate(activityData);
                            });
                        }

                        while (window.timelineManager.currentIndex > 0) {
                            await goToPreviousTimeline();
                        }
                    }
                }
            }

            updateButtonStates();
            return true;
        };

        // Cross-user template copy: POST to DB BEFORE the normal GET so the GET returns the
        // copied activities as regular data.  The operation is idempotent – days that already
        // have target data are skipped by the backend.
        if (templateUser && participantId && studyName && !restoredPendingState) {
            try {
                const copyUrl = new URL(`${TUD_SETTINGS.API_BASE_URL}/template-activities`, window.location.origin);
                copyUrl.searchParams.set('study', studyName);
                copyUrl.searchParams.set('source_user', templateUser);
                copyUrl.searchParams.set('target_user', participantId);

                console.log(`Copying cross-user template activities via POST: ${copyUrl.toString()}`);
                const copyResponse = await fetch(copyUrl.toString(), {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' },
                });

                if (copyResponse.ok) {
                    const copyPayload = await copyResponse.json();
                    console.log('Cross-user template copy result:', copyPayload);
                    if (copyPayload.copied_days_count > 0) {
                        showTemplateBanner(templateUser);
                    }
                } else {
                    console.warn(`Template copy endpoint returned ${copyResponse.status}; source data may not be available yet.`);
                }
            } catch (error) {
                console.warn('Error during cross-user template copy, continuing without template:', error.message);
            }
        }

        // Load existing activities from backend if available
        if (participantId && studyName && !restoredPendingState) {
            console.log(`Attempting to load existing activities for participant ${participantId}, study ${studyName}, day index ${dayIndex}`);

            try {
                const backendUrl = `${TUD_SETTINGS.API_BASE_URL}/studies/${studyName}/participants/${participantId}/activities?day_label_index=${dayIndex}`;

                console.log(`Fetching existing activities from: ${backendUrl}`);

                const response = await fetch(backendUrl, {
                    headers: {
                        'Accept': 'application/json',
                    }
                });

                if (response.ok) {
                    const backendData = await response.json();
                    console.log('Successfully loaded existing activities from backend:', backendData);

                    window.timelineManager.dayIndicesWithData = Array.isArray(backendData.day_indices_with_data)
                        ? backendData.day_indices_with_data
                        : [];
                    renderPreviousDaysSwitchRow();

                    const transformedData = transformBackendActivitiesResponse(backendData);
                    console.log('Transformed backend activities data:', transformedData);

                    let activitiesToLoad = null;

                    if (transformedData && transformedData.activities && transformedData.activities.length > 0) {
                        console.log('Existing activities found in backend data, will load these.');
                        activitiesToLoad = transformedData.activities;
                    } else if (!loadedActivitiesFromBackend && transformedData.template_activities && transformedData.template_activities.length > 0) {
                        console.log('No existing activities found, but template activities are available. Will load template activities.');
                        activitiesToLoad = transformedData.template_activities;

                        if (transformedData.template_source_day_label) {
                            const displayTemplateDayLabel = resolveDisplayDayLabel(transformedData.template_source_day_label);
                            showTemplateBanner(displayTemplateDayLabel);
                        }
                    }

                    if (await loadActivitiesIntoTimelineManager(activitiesToLoad)) {
                        loadedActivitiesFromBackend = true;
                    }

                } else if (response.status === 404) {
                    console.log(`No existing data found for participant ${participantId}, study ${studyName}, day index ${dayIndex}. Starting fresh.`);
                } else {
                    console.warn(`Backend returned ${response.status} for existing data request, continuing without preload`);
                }
            } catch (error) {
                console.warn('Error fetching existing activities from backend, continuing without preload:', error.message);
            }
        }

        console.log("Initializing past timeline click handlers...");
        initPastTimelineClickHandlers();

        console.log('Timeline structure after initialization:', {
            keys: window.timelineManager.keys,
            currentIndex: window.timelineManager.currentIndex,
            configSource: 'backend',
            activities: Object.keys(window.timelineManager.activities).reduce((acc, key) => {
                acc[key] = window.timelineManager.activities[key].length + ' activities';
                return acc;
            }, {}),
            initialized: Array.from(window.timelineManager.initialized)
        });

        setTimeout(() => {
            console.log('=== POST-PRELOAD DEBUG ===');

            // Check data structure
            Object.keys(window.timelineManager.activities).forEach(timelineKey => {
                const activities = window.timelineManager.activities[timelineKey];
                console.log(`Timeline "${timelineKey}" has ${activities.length} activities in data`);

                // Check if timeline DOM element exists and has activities container
                const timelineElement = document.getElementById(timelineKey);
                if (timelineElement) {
                    const activitiesContainer = timelineElement.querySelector('.activities');
                    console.log(`Timeline "${timelineKey}" DOM:`, {
                        elementExists: !!timelineElement,
                        hasActivitiesContainer: !!activitiesContainer,
                        activitiesContainerChildren: activitiesContainer ? activitiesContainer.children.length : 0
                    });
                }
            });

            // Count all activity blocks in DOM
            const allActivityBlocks = document.querySelectorAll('.activity-block');
            console.log(`Total activity blocks in DOM: ${allActivityBlocks.length}`);
        }, 500);

        // Update gradient bar layout
        updateGradientBarLayout();

        // Create and show floating add button for mobile
        createFloatingAddButton();
        if (getIsMobile()) {
            document.querySelector('.floating-add-button').style.display = 'flex';
            updateFloatingButtonPosition();
        }

        // Set initial data-mode on activities container
        const activitiesContainerElement = document.querySelector("#activitiesContainer");
        const currentKey = getCurrentTimelineKey();
        if (currentKey && window.timelineManager.metadata[currentKey]) {
            activitiesContainerElement.setAttribute('data-mode', window.timelineManager.metadata[currentKey].mode);
        }

        // Scroll to first timeline in mobile layout
        scrollToActiveTimeline();

        initButtons();
        initKeyboardShortcuts();
        initInstructionBanner();
        initMobileDelete();
        initDesktopActivityContextMenu();

        // Initialize header and footer heights early
        updateHeaderHeight();
        updateFooterHeight();

        // Add resize event listener with debounce
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                handleResize();
            }, 100);
        });

        // Add scroll listener to update button position
        window.addEventListener('scroll', () => {
            if (getIsMobile()) {
                updateFloatingButtonPosition();
            }
        });

        // Initialize debug overlay
        initDebugOverlay();

        if (DEBUG_MODE) {
            console.log('Initialized timeline structure:', window.timelineManager);
        }
    } catch (error) {
        console.error('Failed to initialize application:', error);
        const errorTitle = window.i18n?.isReady()
            ? i18n.t('errors.loadingActivitiesConfigurationTitle')
            : 'Error loading activities configuration:';
        const errorHelp = window.i18n?.isReady()
            ? i18n.t('errors.loadingActivitiesConfigurationHelp')
            : 'The application requires a valid backend connection to load the appropriate activities for your study.';
        document.getElementById('activitiesContainer').innerHTML =
            '<p style="color: red; padding: 20px; background: #ffebee; border: 2px solid #ef9a9a; border-radius: 8px; margin: 20px;">' +
            `<strong>${errorTitle}</strong><br>${error.message}<br><br>${errorHelp}</p>`;
    }
    updateButtonStates();
}

init().catch(error => {
    console.error('Failed to initialize application:', error);
    const shortError = window.i18n?.isReady()
        ? i18n.t('errors.loadingActivitiesShort')
        : 'Error loading activities. Please refresh the page to try again. Error:';
    document.getElementById('activitiesContainer').innerHTML =
        `<p style="color: red;">${shortError} ${error.message}</p>`;
});

window.addEventListener('beforeunload', () => {
    if (typeof window.__TRAC_CAPTURE_PENDING_STATE === 'function') {
        window.__TRAC_CAPTURE_PENDING_STATE();
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && typeof window.__TRAC_CAPTURE_PENDING_STATE === 'function') {
        window.__TRAC_CAPTURE_PENDING_STATE();
    }
});

// Export addNextTimeline, goToPreviousTimeline and renderActivities for ui.js
export { addNextTimeline, goToPreviousTimeline, renderActivities };
