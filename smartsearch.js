(() => {
  const SELECTORS = {
    component: '.smartsearch-component',
    form: '.search-component',
    input: '.search-input',
    button: '.search-button',
    results: '.search-results',
    result: '.search-result',
    resultTitle: '.search-result-title',
    resultLink: 'a',
  };

  const CLASS = {
    searching: 'is-searching',
    open: 'is-open',
    hide: 'hide',
    highlight: 'is-highlighted',
    empty: 'smartsearch-empty',
    emptyVisible: 'is-visible',
  };

  const SCORE = {
    titleMatch: 10,
    wordBoundaryBonus: 5,
    textMatch: 3,
    noMatch: -1,
  };

  const SETTINGS = {
    toggleAttribute: 'data-smartsearch-toggle',
    emptyText: 'No matching guides',
    toggleFocusDelayMs: 300,
  };

  const STOP_WORDS = new Set([
    'a','an','and','as','at','be','by','can','do','does','for',
    'from','how','i','in','is','it','my','of','on','or','the','to','with','your',
  ]);

  function unique(values) {
    return Array.from(new Set(values));
  }

  function extractKeywords(query) {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const meaningful = words.filter(w => w.length > 1 && !STOP_WORDS.has(w));
    return unique(meaningful.length ? meaningful : words);
  }

  function startsAtWordBoundary(text, matchIndex) {
    if (matchIndex === 0) return true;
    return !/[a-z0-9]/.test(text[matchIndex - 1]);
  }

  function scoreToken(entry, token) {
    const titleIndex = entry.title.indexOf(token);
    if (titleIndex !== -1) {
      const boundaryBonus = startsAtWordBoundary(entry.title, titleIndex) ? SCORE.wordBoundaryBonus : 0;
      return SCORE.titleMatch + boundaryBonus;
    }
    if (entry.text.includes(token)) return SCORE.textMatch;
    return SCORE.noMatch;
  }

  function scoreEntry(entry, tokens) {
    let total = 0;
    for (const token of tokens) {
      const tokenScore = scoreToken(entry, token);
      if (tokenScore === SCORE.noMatch) return SCORE.noMatch;
      total += tokenScore;
    }
    return total;
  }

  function partitionByMatch(entries, tokens) {
    const matched = [];
    const unmatched = [];
    for (const entry of entries) {
      const score = scoreEntry(entry, tokens);
      if (score >= 0) matched.push({ entry, score });
      else unmatched.push(entry);
    }
    return { matched, unmatched };
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function createMark(text) {
    const mark = document.createElement('mark');
    mark.textContent = text;
    return mark;
  }

  function renderHighlightedText(targetEl, text, tokens) {
    if (!targetEl) return;
    if (!tokens.length) { targetEl.textContent = text; return; }
    const pattern = new RegExp('(' + tokens.map(escapeRegExp).join('|') + ')', 'gi');
    const fragment = document.createDocumentFragment();
    let lastIndex = 0, match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) fragment.append(text.slice(lastIndex, match.index));
      fragment.append(createMark(match[0]));
      lastIndex = match.index + match[0].length;
      if (pattern.lastIndex === match.index) pattern.lastIndex++;
    }
    if (lastIndex < text.length) fragment.append(text.slice(lastIndex));
    targetEl.replaceChildren(fragment);
  }

  function debounceToAnimationFrame(callback) {
    let frameId = 0;
    return (value) => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => { frameId = 0; callback(value); });
    };
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 9);
  }

  function resolveElements(component) {
    const container = component.closest('.nav-search') || component;
    const input = container.querySelector(SELECTORS.input);
    const results = component.querySelector(SELECTORS.results);
    const button = container.querySelector(SELECTORS.button);
    const form = container.querySelector(SELECTORS.form);
    if (!input || !results) return null;
    return { input, results, form, button };
  }

  function ensureComponentId(component) {
    if (!component.id) component.id = 'smartsearch-' + randomId();
  }

  function buildSearchIndex(component, results) {
    return Array.from(results.querySelectorAll(SELECTORS.result)).map((el, position) => {
      const titleEl = el.querySelector(SELECTORS.resultTitle);
      const original = ((titleEl || el).textContent || '').trim();
      if (!el.id) el.id = `${component.id}-result-${position}`;
      el.setAttribute('role', 'option');
      return {
        el, titleEl, original,
        title: original.toLowerCase(),
        text: (el.textContent || '').toLowerCase(),
        marked: false,
      };
    });
  }

  function createEmptyMessage() {
    const el = document.createElement('div');
    el.className = CLASS.empty;
    el.textContent = SETTINGS.emptyText;
    return el;
  }

  function applyAriaRoles(input, results) {
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    results.setAttribute('role', 'listbox');
  }

  function createSearchController({ component, input, results, index, emptyMessage }) {
    let matches = [];
    let activeIndex = -1;

    function clearTitleHighlight(entry) {
      if (!entry.marked) return;
      renderHighlightedText(entry.titleEl, entry.original, []);
      entry.marked = false;
    }

    function setActive(nextIndex) {
      const current = matches[activeIndex];
      if (current) current.el.classList.remove(CLASS.highlight);
      activeIndex = nextIndex;
      const next = matches[activeIndex];
      if (next) {
        next.el.classList.add(CLASS.highlight);
        next.el.scrollIntoView({ block: 'nearest' });
        input.setAttribute('aria-activedescendant', next.el.id);
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function focusNext() {
      if (!matches.length) return false;
      setActive(activeIndex < matches.length - 1 ? activeIndex + 1 : 0);
      return true;
    }

    function focusPrevious() {
      if (!matches.length) return false;
      setActive(activeIndex > 0 ? activeIndex - 1 : matches.length - 1);
      return true;
    }

    function showAllResults() {
      component.classList.remove(CLASS.searching);
      input.setAttribute('aria-expanded', 'false');
      emptyMessage.classList.remove(CLASS.emptyVisible);
      const fragment = document.createDocumentFragment();
      for (const entry of index) {
        entry.el.classList.remove(CLASS.hide, CLASS.highlight);
        clearTitleHighlight(entry);
        fragment.append(entry.el);
      }
      fragment.append(emptyMessage);
      results.replaceChildren(fragment);
      matches = [];
      activeIndex = -1;
    }

    function showMatches(tokens) {
      const { matched, unmatched } = partitionByMatch(index, tokens);
      matched.sort((a, b) => b.score - a.score);
      const fragment = document.createDocumentFragment();
      matches = matched.map(({ entry }) => {
        entry.el.classList.remove(CLASS.hide);
        renderHighlightedText(entry.titleEl, entry.original, tokens);
        entry.marked = true;
        fragment.append(entry.el);
        return entry;
      });
      for (const entry of unmatched) {
        entry.el.classList.add(CLASS.hide);
        entry.el.classList.remove(CLASS.highlight);
        fragment.append(entry.el);
      }
      fragment.append(emptyMessage);
      results.replaceChildren(fragment);
      emptyMessage.classList.toggle(CLASS.emptyVisible, matches.length === 0);
      component.classList.add(CLASS.searching);
      input.setAttribute('aria-expanded', 'true');
      setActive(-1);
    }

    function search(query) {
      const tokens = extractKeywords(query);
      if (!query.trim() || !tokens.length) showAllResults();
      else showMatches(tokens);
    }

    function openActiveResult() {
      const selected = matches[activeIndex];
      if (!selected) return false;
      const link = selected.el.querySelector(SELECTORS.resultLink);
      if (link) window.location.href = link.href;
      return true;
    }

   function close() {
  component.classList.remove(CLASS.searching, CLASS.open);
  input.setAttribute('aria-expanded', 'false');
  input.value = '';
}

    function closeAndBlur() {
      close();
      input.blur();
    }

    return { search, focusNext, focusPrevious, openActiveResult, close, closeAndBlur };
  }

  function preventDefault(event) {
    event.preventDefault();
  }

  function handleKeydown(event, controller) {
    switch (event.key) {
      case 'ArrowDown': if (controller.focusNext()) event.preventDefault(); break;
      case 'ArrowUp': if (controller.focusPrevious()) event.preventDefault(); break;
      case 'Enter': if (controller.openActiveResult()) event.preventDefault(); break;
      case 'Escape': controller.closeAndBlur(); break;
    }
  }

  function bindToggleButton(component, button, input) {
    if (!button) return;
    if (!component.hasAttribute(SETTINGS.toggleAttribute)) {
      button.addEventListener('click', preventDefault);
      return;
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const isOpen = component.classList.toggle(CLASS.open);
      button.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) setTimeout(() => input.focus(), SETTINGS.toggleFocusDelayMs);
      else input.blur();
    });
  }

  function bindEvents(component, elements, controller) {
    const { input, form, button } = elements;
    const scheduleSearch = debounceToAnimationFrame(controller.search);
    if (form) form.addEventListener('submit', preventDefault);
    input.addEventListener('input', (event) => scheduleSearch(event.target.value));
    input.addEventListener('keydown', (event) => handleKeydown(event, controller));
    bindToggleButton(component, button, input);
    document.addEventListener('click', (event) => {
  if (!component.contains(event.target) && !event.target.closest(SELECTORS.button)) {
    component.classList.remove(CLASS.searching);
    input.setAttribute('aria-expanded', 'false');
  }
});
    
  }

  function initComponent(component) {
    if (component.dataset.smartsearchInit) return;
    component.dataset.smartsearchInit = '1';
    const elements = resolveElements(component);
    if (!elements) return;
    ensureComponentId(component);
    const index = buildSearchIndex(component, elements.results);
    const emptyMessage = createEmptyMessage();
    elements.results.append(emptyMessage);
    applyAriaRoles(elements.input, elements.results);
    const controller = createSearchController({
      component,
      input: elements.input,
      results: elements.results,
      index,
      emptyMessage,
    });
    bindEvents(component, elements, controller);
  }

  function run() {
  document.querySelectorAll(SELECTORS.component).forEach(initComponent);
}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();
