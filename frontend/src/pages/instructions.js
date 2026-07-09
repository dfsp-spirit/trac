import { getIsMobile, updateIsMobile } from '../js/globals.js';
import i18n from '../js/i18n.js';
import { loadActivitiesConfig } from '../js/activities_config.js';
import { renderMarkdown } from '../js/markdown.js';
import { hasPendingExternalTasks } from '../js/utils.js';

function getUrlParams() {
  return new URLSearchParams(window.location.search);
}

function getCurrentLanguageFromUrl() {
  return getUrlParams().get('lang');
}

function normalizeLanguageCode(language) {
  if (typeof language !== 'string') {
    return null;
  }
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized.split('-')[0] || null;
}

function getPreferredLanguage(
  supportedLanguages = [],
  fallbackLanguage = 'en'
) {
  const normalizedSupported = (
    Array.isArray(supportedLanguages) ? supportedLanguages : []
  )
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

  const fromUrl = pickIfSupported(getCurrentLanguageFromUrl());
  if (fromUrl) {
    return fromUrl;
  }

  const browserLanguages =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];

  for (const browserLanguage of browserLanguages) {
    const picked = pickIfSupported(browserLanguage);
    if (picked) {
      return picked;
    }
  }

  return (
    pickIfSupported(fallbackLanguage) ||
    normalizeLanguageCode(fallbackLanguage) ||
    'en'
  );
}

function setLanguageInUrl(language) {
  const url = new URL(window.location.href);
  url.searchParams.set('lang', language);
  window.history.replaceState({}, '', url.toString());
}

function resolveLocalizedStudyText(
  textValue,
  selectedLanguage,
  defaultLanguage = 'en'
) {
  if (typeof textValue === 'string') {
    return textValue;
  }

  if (!textValue || typeof textValue !== 'object') {
    return '';
  }

  return (
    textValue[selectedLanguage] ||
    textValue[defaultLanguage] ||
    textValue.en ||
    Object.values(textValue).find((value) => typeof value === 'string') ||
    ''
  );
}

async function loadStudyConfigForInstructions(language) {
  const urlParams = getUrlParams();
  const studyName =
    urlParams.get('study_name') ||
    window.TUD_SETTINGS?.DEFAULT_STUDY_NAME ||
    null;
  if (!studyName) {
    const noStudiesError = new Error('No studies available.');
    noStudiesError.code = 'NO_STUDIES_AVAILABLE';
    throw noStudiesError;
  }
  const participantId = urlParams.get('pid');
  const apiBaseUrl = window.TUD_SETTINGS?.API_BASE_URL || '/api';
  const endpointUrl = new URL(
    `${apiBaseUrl}/studies/${studyName}/study-config`,
    window.location.origin
  );

  if (participantId) {
    endpointUrl.searchParams.set('participant_id', participantId);
  }
  if (language) {
    endpointUrl.searchParams.set('lang', language);
  }

  const response = await fetch(endpointUrl.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let detailMessage = '';
    let detailCode = '';
    try {
      const payload = await response.json();
      const detail = payload?.detail;
      if (typeof detail === 'string') {
        detailMessage = detail;
      } else if (detail && typeof detail === 'object') {
        detailMessage = detail.message || '';
        detailCode = detail.code || '';
      }
    } catch (_parseError) {
      // keep generic fallback
    }

    const message =
      detailMessage ||
      `Failed to load study-config from backend: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    if (detailCode === 'study_unavailable') {
      error.code = 'STUDY_UNAVAILABLE';
    }
    throw error;
  }

  return await response.json();
}

function renderLanguageSelector(studyConfig, selectedLanguage) {
  const supportedLanguages = studyConfig?.supported_languages || [];
  const existingSelector = document.getElementById('languageSelect');
  if (!Array.isArray(supportedLanguages) || supportedLanguages.length <= 1) {
    existingSelector?.closest('.language-selector-container')?.remove();
    return;
  }

  if (existingSelector) {
    return;
  }

  const selectorContainer = document.createElement('div');
  selectorContainer.className = 'language-selector-container';
  selectorContainer.style.marginBottom = '1rem';

  const label = document.createElement('label');
  label.setAttribute('for', 'languageSelect');
  label.textContent = 'Language';
  label.setAttribute('data-i18n', 'common.language');
  label.style.marginRight = '0.5rem';

  const select = document.createElement('select');
  select.id = 'languageSelect';
  select.setAttribute('aria-label', 'Choose language');
  select.setAttribute('data-i18n-aria-label', 'common.chooseLanguage');

  supportedLanguages.forEach((language) => {
    const option = document.createElement('option');
    option.value = language;
    option.textContent = language.toUpperCase();
    if (language === selectedLanguage) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    const newLanguage = select.value;
    const url = new URL(window.location.href);
    url.searchParams.set('lang', newLanguage);
    window.location.href = url.toString();
  });

  selectorContainer.appendChild(label);
  selectorContainer.appendChild(select);

  const bodyFirstDiv = document.body.querySelector('div');
  if (bodyFirstDiv) {
    bodyFirstDiv.insertBefore(selectorContainer, bodyFirstDiv.firstChild);
  }
}

function applyStudyIntroText(studyConfig) {
  const selectedLanguage =
    studyConfig?.selected_language || getCurrentLanguageFromUrl() || 'en';
  const defaultLanguage = studyConfig?.default_language || 'en';
  const introElement = document.getElementById('study-custom-message-intro');
  if (!introElement) {
    return;
  }

  const resolvedText = resolveLocalizedStudyText(
    studyConfig?.study_text_intro,
    selectedLanguage,
    defaultLanguage
  );

  if (typeof resolvedText === 'string' && resolvedText.trim() !== '') {
    introElement.innerHTML = renderMarkdown(resolvedText);
    introElement.removeAttribute('data-i18n-html');
  }
}

const DEFAULT_STUDY_TEXT_INSTRUCTIONS = {
  en:
    '**Time-Saving Feature:** You do not need to start from scratch every day. After you complete the first day, your schedule will automatically copy over to the next day as a template. Please adapt this template to reflect any changes in your activities for that day.\n\n' +
    '#### How to fill out the diary\n\n' +
    'You will see a list of activities at the bottom of the screen. Click an activity to select it, then click on the timeline to place it, indicating what you were doing throughout the day.\n\n' +
    'You will enter information in two steps for each day:\n\n' +
    '- **Main Activity (Level 1):** Click an activity from the list below to select it, then click on the timeline to show your main activity.\n' +
    '- **Secondary Activity (Level 2):** Use this second timeline only if you were doing two things at once. This is for activities that were happening in the background or simultaneously with your Main Activity, e.g.:\n' +
    '  - Media Multitasking: If you were using a second form of media (e.g., listening to a Podcast while Gaming, or checking Social Media while watching TV).\n' +
    '  - Other Multitasking: If you were doing a non-digital activity simultaneously (e.g., Reading while Commuting, or Knitting while watching TV).\n' +
    '  - Note: If you were focused on only one thing, leave this level blank for that time block.',

  de:
    '**Zeitsparfunktion:** Sie müssen nicht jeden Tag von vorne beginnen. Nachdem Sie den ersten Tag ausgefüllt haben, wird Ihr Zeitplan automatisch als Vorlage für den nächsten Tag übernommen. Bitte passen Sie diese Vorlage an, um Änderungen in Ihren Aktivitäten für diesen Tag widerzuspiegeln.\n\n' +
    '#### So füllen Sie das Tagebuch aus\n\n' +
    'Am unteren Bildschirmrand sehen Sie eine Liste von Aktivitäten. Klicken Sie eine Aktivität an, um sie auszuwählen, und klicken Sie dann auf die Zeitleiste, um anzugeben, was Sie im Laufe des Tages gemacht haben.\n\n' +
    'Für jeden Tag geben Sie die Informationen in zwei Schritten ein:\n\n' +
    '- **Hauptaktivität (Level 1):** Klicken Sie eine Aktivität aus der Liste an, um sie auszuwählen, und klicken Sie dann auf die Zeitleiste, um Ihre Hauptaktivität darzustellen.\n' +
    '- **Nebenaktivität (Level 2):** Verwenden Sie diese zweite Zeitleiste nur, wenn Sie zwei Dinge gleichzeitig getan haben. Dies gilt für Aktivitäten, die im Hintergrund oder gleichzeitig mit Ihrer Hauptaktivität stattfanden, z. B.:\n' +
    '  - Medien-Multitasking: Wenn Sie ein zweites Medium genutzt haben (z. B. einen Podcast hören beim Spielen oder soziale Medien checken beim Fernsehen).\n' +
    '  - Sonstiges Multitasking: Wenn Sie gleichzeitig eine nicht-digitale Aktivität ausgeführt haben (z. B. Lesen während des Pendelns oder Stricken beim Fernsehen).\n' +
    '  - Hinweis: Wenn Sie sich nur auf eine Sache konzentriert haben, lassen Sie dieses Level für diesen Zeitraum leer.',

  sv:
    '**Tidsbesparande funktion:** Du behöver inte börja från början varje dag. Efter att du har slutfört den första dagen kopieras ditt schema automatiskt till nästa dag som en mall. Anpassa gärna mallen så att den speglar förändringar i dina aktiviteter den dagen.\n\n' +
    '#### Så fyller du i dagboken\n\n' +
    'Du ser en lista med aktiviteter längst ner på skärmen. Klicka på en aktivitet för att välja den, och klicka sedan på tidslinjen för att visa vad du gjorde under dagen.\n\n' +
    'Du fyller i information i två steg för varje dag:\n\n' +
    '- **Huvudaktivitet (Nivå 1):** Klicka på en aktivitet från listan för att välja den, och klicka sedan på tidslinjen för att visa din huvudaktivitet.\n' +
    '- **Sekundär aktivitet (Nivå 2):** Använd denna andra tidslinje endast om du gjorde två saker samtidigt. Den är till för aktiviteter som pågick i bakgrunden eller samtidigt med din huvudaktivitet, t.ex.:\n' +
    '  - Mediemultitasking: Om du använde en andra medieform (t.ex. lyssnade på en podd medan du spelade, eller kollade sociala medier medan du tittade på TV).\n' +
    '  - Annan multitasking: Om du gjorde en icke-digital aktivitet samtidigt (t.ex. läste medan du pendlade, eller stickade medan du tittade på TV).\n' +
    '  - Obs: Om du fokuserade på endast en sak, lämna den här nivån tom för det tidsblocket.',

  fi:
    '**Aikaa säästävä ominaisuus:** Sinun ei tarvitse aloittaa alusta joka päivä. Kun olet täyttänyt ensimmäisen päivän, aikataulusi kopioidaan automaattisesti seuraavalle päivälle malliksi. Muokkaa tätä mallia vastaamaan kyseisen päivän muutoksia.\n\n' +
    '#### Kuinka täyttää päiväkirja\n\n' +
    'Näet näytön alareunassa listan toiminnoista. Klikkaa toimintoa valitaksesi sen ja klikkaa sitten aikajanaa osoittaaksesi, mitä teit päivän aikana.\n\n' +
    'Syötät tiedot kahdessa vaiheessa jokaiselle päivälle:\n\n' +
    '- **Päätoiminto (Taso 1):** Klikkaa toimintoa listasta valitaksesi sen ja klikkaa sitten aikajanaa näyttääksesi päätoimintosi.\n' +
    '- **Sivutoiminto (Taso 2):** Käytä tätä toista aikajanaa vain, jos teit kahta asiaa samanaikaisesti. Tämä koskee toimintoja, jotka tapahtuivat taustalla tai yhtä aikaa päätoimintosi kanssa, esim.:\n' +
    '  - Median moniajo: Jos käytit toista mediaa samanaikaisesti (esim. kuuntelit podcastia pelatessa tai selasit sosiaalista mediaa katsoessasi televisiota).\n' +
    '  - Muu moniajo: Jos teit samanaikaisesti ei-digitaalista toimintaa (esim. luit matkustaessasi tai neuloit katsoessasi televisiota).\n' +
    '  - Huom: Jos keskityit vain yhteen asiaan, jätä tämä taso tyhjäksi kyseiseltä ajanjaksolta.',

  pl:
    '**Funkcja oszczędzania czasu:** Nie musisz zaczynać od zera każdego dnia. Po ukończeniu pierwszego dnia, Twój plan dnia automatycznie skopiuje się na następny dzień jako szablon. Proszę dostosować ten szablon do zmian w Twoich aktywnościach w danym dniu.\n\n' +
    '#### Jak wypełnić dziennik\n\n' +
    'Na dole ekranu zobaczysz listę aktywności. Kliknij aktywność, aby ją wybrać, a następnie kliknij na osi czasu, aby wskazać, co robiłeś przez cały dzień.\n\n' +
    'Wprowadzisz informacje w dwóch krokach dla każdego dnia:\n\n' +
    '- **Główna aktywność (Poziom 1):** Kliknij aktywność z listy, aby ją wybrać, a następnie kliknij na osi czasu, aby pokazać swoją główną aktywność.\n' +
    '- **Aktywność poboczna (Poziom 2):** Użyj tej drugiej osi czasu tylko wtedy, gdy robiłeś dwie rzeczy jednocześnie. Jest to dla aktywności, które działy się w tle lub równolegle z Twoją główną aktywnością, np.:\n' +
    '  - Multitasking medialny: Jeśli używałeś drugiego medium (np. słuchanie podcastu podczas grania, lub sprawdzanie mediów społecznościowych podczas oglądania telewizji).\n' +
    '  - Inny multitasking: Jeśli wykonywałeś jednocześnie aktywność niedigitalną (np. czytanie podczas podróży, lub robienie na drutach podczas oglądania telewizji).\n' +
    '  - Uwaga: Jeśli skupiłeś się tylko na jednej rzeczy, pozostaw ten poziom pusty dla tego okresu czasu.',

  fr:
    "**Fonction gain de temps :** Vous n'avez pas besoin de recommencer à zéro chaque jour. Après avoir rempli le premier jour, votre emploi du temps sera automatiquement copié au jour suivant comme modèle. Veuillez adapter ce modèle pour refléter les changements dans vos activités pour cette journée.\n\n" +
    '#### Comment remplir le journal\n\n' +
    "Vous verrez une liste d'activités en bas de l'écran. Cliquez sur une activité pour la sélectionner, puis cliquez sur la chronologie pour indiquer ce que vous faisiez pendant la journée.\n\n" +
    'Vous saisirez les informations en deux étapes pour chaque jour :\n\n' +
    '- **Activité principale (Niveau 1) :** Cliquez sur une activité de la liste pour la sélectionner, puis cliquez sur la chronologie pour indiquer votre activité principale.\n' +
    '- **Activité secondaire (Niveau 2) :** Utilisez cette deuxième chronologie uniquement si vous faisiez deux choses à la fois. Cela concerne les activités qui se déroulaient en arrière-plan ou simultanément avec votre activité principale, par ex. :\n' +
    '  - Multitâche médiatique : Si vous utilisiez un deuxième média (par ex., écouter un podcast en jouant, ou consulter les réseaux sociaux en regardant la télévision).\n' +
    '  - Autre multitâche : Si vous faisiez une activité non numérique simultanément (par ex., lire en vous déplaçant, ou tricoter en regardant la télévision).\n' +
    '  - Remarque : Si vous vous concentriez sur une seule chose, laissez ce niveau vide pour cette période.',

  es:
    '**Función de ahorro de tiempo:** No necesita empezar desde cero cada día. Después de completar el primer día, su horario se copiará automáticamente al día siguiente como plantilla. Adapte esta plantilla para reflejar los cambios en sus actividades de ese día.\n\n' +
    '#### Cómo completar el diario\n\n' +
    'Verá una lista de actividades en la parte inferior de la pantalla. Haga clic en una actividad para seleccionarla, luego haga clic en la línea de tiempo para indicar lo que estuvo haciendo durante el día.\n\n' +
    'Introducirá la información en dos pasos para cada día:\n\n' +
    '- **Actividad Principal (Nivel 1):** Haga clic en una actividad de la lista para seleccionarla, luego haga clic en la línea de tiempo para mostrar su actividad principal.\n' +
    '- **Actividad Secundaria (Nivel 2):** Utilice esta segunda línea de tiempo solo si estaba haciendo dos cosas a la vez. Es para actividades que ocurrían en segundo plano o simultáneamente con su Actividad Principal, p. ej.:\n' +
    '  - Multitarea de medios: Si estaba utilizando un segundo medio (p. ej., escuchar un Podcast mientras juega, o revisar las Redes Sociales mientras ve la televisión).\n' +
    '  - Otra multitarea: Si estaba haciendo una actividad no digital simultáneamente (p. ej., Leer mientras se desplaza, o Tejer mientras ve la televisión).\n' +
    '  - Nota: Si se centró en una sola cosa, deje este nivel en blanco para ese bloque de tiempo.',
};

function applyStudyInstructionsText(studyConfig) {
  const selectedLanguage =
    studyConfig?.selected_language || getCurrentLanguageFromUrl() || 'en';
  const defaultLanguage = studyConfig?.default_language || 'en';
  const instructionsElement = document.getElementById(
    'study-custom-message-instructions'
  );
  if (!instructionsElement) {
    return;
  }

  const resolvedText = resolveLocalizedStudyText(
    studyConfig?.study_text_instructions,
    selectedLanguage,
    defaultLanguage
  );

  if (typeof resolvedText === 'string' && resolvedText.trim() !== '') {
    instructionsElement.innerHTML = renderMarkdown(resolvedText);
    return;
  }

  // Fallback: use the built-in default text for studies that don't provide study_text_instructions
  const fallbackText = resolveLocalizedStudyText(
    DEFAULT_STUDY_TEXT_INSTRUCTIONS,
    selectedLanguage,
    defaultLanguage
  );
  if (fallbackText) {
    instructionsElement.innerHTML = renderMarkdown(fallbackText);
  }
}

function buildPostDiaryLandingUrlWithCurrentParams(studyConfig) {
  const currentUrl = new URL(window.location.href);
  const hasPendingTasks = hasPendingExternalTasks(studyConfig);
  const targetPath = hasPendingTasks ? 'tasks.html' : 'thank-you.html';
  const redirectUrl = new URL(targetPath, currentUrl.href);
  currentUrl.searchParams.forEach((value, key) => {
    redirectUrl.searchParams.set(key, value);
  });
  if (!redirectUrl.searchParams.has('completion_status')) {
    redirectUrl.searchParams.set('completion_status', 'completed');
  }
  return redirectUrl.toString();
}

async function markInstructionsCompletedInBackend() {
  const urlParams = getUrlParams();
  const studyName =
    urlParams.get('study_name') ||
    window.TUD_SETTINGS?.DEFAULT_STUDY_NAME ||
    null;
  if (!studyName) {
    return;
  }
  const participantId = urlParams.get('pid');
  if (!participantId) {
    return;
  }

  const apiBaseUrl = window.TUD_SETTINGS?.API_BASE_URL || '/api';
  const endpointUrl = new URL(
    `${apiBaseUrl}/studies/${studyName}/participants/${participantId}/instructions/complete`,
    window.location.origin
  );

  const response = await fetch(endpointUrl.toString(), {
    method: 'POST',
    keepalive: true,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ completed: true }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to persist instructions completion: ${response.status}`
    );
  }
}

// Add the missing updateLayout function
function updateLayout() {
  const isMobile = getIsMobile();
  document.body.classList.toggle('mobile-layout', isMobile);
  document.body.classList.toggle('desktop-layout', !isMobile);

  // Update orientation classes
  const isHorizontal = window.innerWidth > window.innerHeight;
  document.body.classList.toggle('is-horizontal', isHorizontal);
  document.body.classList.toggle('is-vertical', !isHorizontal);
}

// Initialize i18n when the module loads
(async () => {
  try {
    let studyConfig = null;
    const requestedLanguage =
      getCurrentLanguageFromUrl() || getPreferredLanguage();

    try {
      studyConfig = await loadStudyConfigForInstructions(
        requestedLanguage || undefined
      );
      // Store globally for footer.js and other consumers
      window.TUD_STUDY_CONFIG = studyConfig;
      window.dispatchEvent(new CustomEvent('tud:studyConfigReady'));
    } catch (studyConfigError) {
      if (
        studyConfigError?.code === 'STUDY_UNAVAILABLE' ||
        studyConfigError?.status === 403
      ) {
        const currentUrl = new URL(window.location.href);
        const redirectUrl = new URL('../index.html', currentUrl.href);
        currentUrl.searchParams.forEach((value, key) => {
          redirectUrl.searchParams.set(key, value);
        });
        window.location.href = redirectUrl.toString();
        return;
      }
      console.warn(
        'Could not load study-config for instructions page:',
        studyConfigError.message
      );
    }

    const selectedLanguage = getPreferredLanguage(
      studyConfig?.supported_languages || [],
      requestedLanguage ||
        studyConfig?.selected_language ||
        studyConfig?.default_language ||
        'en'
    );
    if (!requestedLanguage && selectedLanguage) {
      setLanguageInUrl(selectedLanguage);
    }

    if (studyConfig) {
      if (studyConfig.participant_has_completed_study === true) {
        window.location.href =
          buildPostDiaryLandingUrlWithCurrentParams(studyConfig);
        return;
      }
      renderLanguageSelector(studyConfig, selectedLanguage);
    }

    const activitiesConfig = await loadActivitiesConfig({
      lang: selectedLanguage,
      settingsBasePath: '../settings',
      preferBackend: true,
      requireBackend: false,
      useCache: true,
    });
    const language =
      selectedLanguage || activitiesConfig?.general?.language || 'en';
    console.log('Loading language:', language);
    await i18n.init(language);
    i18n.applyTranslations();
    if (studyConfig) {
      applyStudyIntroText(studyConfig);
      applyStudyInstructionsText(studyConfig);
    }
    console.log('i18n initialized successfully');
  } catch (error) {
    console.error('Error initializing i18n:', error);
    // Fallback to English if there's any error
    await i18n.init('en');
    i18n.applyTranslations();
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  const continueBtn = document.getElementById('continueBtn');
  const progressBar = document.getElementById('progressBar');

  // Function to create URL with preserved parameters
  function createUrlWithParams(targetPath) {
    const currentUrl = new URL(window.location.href);
    const redirectUrl = new URL(
      targetPath,
      currentUrl.origin + currentUrl.pathname.replace(/[^/]*$/, '')
    );

    // Preserve all existing URL parameters
    currentUrl.searchParams.forEach((value, key) => {
      // Don't override 'instructions' param if it's the target destination
      if (targetPath === '../index.html' && key === 'instructions') {
        return;
      }
      redirectUrl.searchParams.set(key, value);
    });

    // Add instructions=completed for final redirect
    if (targetPath === '../index.html') {
      redirectUrl.searchParams.set('instructions', 'completed');
    }

    return redirectUrl.toString();
  }

  // Update progress bar
  if (progressBar) {
    progressBar.style.transition = 'width 0.6s ease';
    progressBar.style.width = '100%';
  }

  // Handle orientation changes
  let orientationTimeout;
  function updateLayoutClass() {
    clearTimeout(orientationTimeout);
    orientationTimeout = setTimeout(() => {
      const isHorizontal = window.innerWidth > window.innerHeight;
      document.body.classList.toggle('is-horizontal', isHorizontal);
      document.body.classList.toggle('is-vertical', !isHorizontal);
    }, 100);
  }

  // Update layout class on load and resize with passive event listener
  updateLayoutClass();
  window.addEventListener('resize', updateLayoutClass, { passive: true });

  // Lazy load images with IntersectionObserver
  const lazyImageObservers = new Map();
  const lazyImages = document.querySelectorAll('.gif-container[data-src]');
  lazyImages.forEach((container) => {
    const img = container.querySelector('img');
    if (img) {
      const observer = new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              img.src = container.dataset.src;
              observer.unobserve(entry.target);
              lazyImageObservers.delete(container);
            }
          });
        },
        { rootMargin: '50px', threshold: 0.1 }
      );
      observer.observe(container);
      lazyImageObservers.set(container, observer);
    }
  });

  // Handle start button click
  if (continueBtn) {
    console.log('Continue button found, adding click handler');
    continueBtn.addEventListener('click', (e) => {
      console.log('Continue button clicked:', e);
      markInstructionsCompletedInBackend().catch((error) => {
        console.warn(
          'Could not persist instructions completion:',
          error.message
        );
      });
      const targetUrl = createUrlWithParams('../index.html');
      console.log('Redirecting to:', targetUrl);
      window.location.href = targetUrl;
    });
  } else {
    console.error('Continue button not found!');
  }

  // Cleanup function
  function cleanup() {
    if (orientationTimeout) clearTimeout(orientationTimeout);
    lazyImageObservers.forEach((observer) => observer.disconnect());
    lazyImageObservers.clear();
    window.removeEventListener('resize', updateLayoutClass);
  }

  // Clean up when page is unloaded
  window.addEventListener('unload', cleanup);
});

// Initial layout
updateLayout();

// Update on resize with debouncing
let resizeTimeout;
window.addEventListener(
  'resize',
  () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      updateIsMobile();
      updateLayout();
    }, 100);
  },
  { passive: true }
);
