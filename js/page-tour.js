(function () {
  if (window.SyntraePageTour) return;

  const STYLE_ID = 'syntrae-page-tour-style';
  const TOUR_QUERY_PARAM = 'tour';
  const VIEWPORT_PADDING = 20;
  const CARD_GAP = 22;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .syntrae-tour-trigger {
        position: fixed;
        left: 24px;
        bottom: 24px;
        z-index: 1200;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        border: 0;
        border-radius: 999px;
        padding: 14px 18px;
        background: linear-gradient(135deg, rgba(18, 120, 114, 0.96), rgba(23, 151, 144, 0.96));
        color: #f7fff9;
        font: 700 14px/1.1 "Space Grotesk", "Inter", sans-serif;
        letter-spacing: 0.01em;
        box-shadow: 0 22px 46px rgba(18, 53, 58, 0.24);
        cursor: pointer;
        transition: transform .22s ease, box-shadow .22s ease, opacity .22s ease;
      }
      .syntrae-tour-trigger:hover,
      .syntrae-tour-trigger:focus-visible {
        transform: translateY(-2px);
        box-shadow: 0 26px 54px rgba(18, 53, 58, 0.3);
        outline: none;
      }
      .syntrae-tour-trigger svg {
        width: 18px;
        height: 18px;
        flex: 0 0 auto;
      }
      .syntrae-tour-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1250;
        background: transparent;
        opacity: 0;
        pointer-events: none;
        transition: opacity .28s ease;
      }
      .syntrae-tour-backdrop.is-visible {
        opacity: 1;
        pointer-events: auto;
      }
      .syntrae-tour-dimmer {
        position: fixed;
        background: rgba(8, 14, 23, 0.62);
        backdrop-filter: blur(4px);
        transition: left .24s ease, top .24s ease, width .24s ease, height .24s ease;
      }
      .syntrae-tour-spotlight {
        position: fixed;
        pointer-events: none;
        border: 2px solid rgba(177, 241, 232, 0.78);
        background:
          radial-gradient(circle at 18% 16%, rgba(255, 255, 255, 0.2), transparent 42%),
          rgba(239, 255, 250, 0.08);
        box-shadow:
          0 0 0 4px rgba(255, 255, 255, 0.26),
          0 0 0 11px rgba(35, 150, 142, 0.22),
          0 24px 70px rgba(11, 52, 57, 0.34);
        transition: left .24s ease, top .24s ease, width .24s ease, height .24s ease, border-radius .24s ease;
      }
      .syntrae-tour-card {
        position: fixed;
        z-index: 1300;
        width: min(360px, calc(100vw - 32px));
        padding: 20px 20px 18px;
        border-radius: 24px;
        background: rgba(250, 255, 249, 0.98);
        color: #203236;
        box-shadow: 0 34px 80px rgba(8, 18, 28, 0.28);
        border: 1px solid rgba(43, 100, 95, 0.14);
        opacity: 0;
        pointer-events: none;
        transform: translateY(12px) scale(0.98);
        transition: opacity .24s ease, transform .24s ease;
      }
      .syntrae-tour-card.is-visible {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0) scale(1);
      }
      .syntrae-tour-card h3 {
        margin: 10px 0 8px;
        font-size: 32px;
        line-height: 1.05;
        letter-spacing: -0.03em;
        color: #223539;
      }
      .syntrae-tour-card p {
        margin: 0;
        color: #50666b;
        font-size: 15px;
        line-height: 1.6;
      }
      .syntrae-tour-step {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 78px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(18, 120, 114, 0.1);
        color: #127872;
        font: 800 12px/1 "Space Grotesk", "Inter", sans-serif;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .syntrae-tour-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 18px;
      }
      .syntrae-tour-actions-group {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }
      .syntrae-tour-btn {
        border: 1px solid rgba(43, 100, 95, 0.16);
        border-radius: 16px;
        padding: 12px 16px;
        background: #ffffff;
        color: #213439;
        font: 700 14px/1 "Space Grotesk", "Inter", sans-serif;
        cursor: pointer;
        transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease, background .2s ease;
      }
      .syntrae-tour-btn:hover,
      .syntrae-tour-btn:focus-visible {
        transform: translateY(-1px);
        border-color: rgba(18, 120, 114, 0.34);
        box-shadow: 0 12px 22px rgba(18, 53, 58, 0.12);
        outline: none;
      }
      .syntrae-tour-btn--primary {
        border-color: transparent;
        background: linear-gradient(135deg, #1a8d83, #209989);
        color: #f7fff9;
      }
      .syntrae-tour-btn--ghost {
        background: rgba(255, 255, 255, 0.88);
      }
      .syntrae-tour-card[data-placement="right"]::after,
      .syntrae-tour-card[data-placement="left"]::after,
      .syntrae-tour-card[data-placement="top"]::after,
      .syntrae-tour-card[data-placement="bottom"]::after {
        content: "";
        position: absolute;
        width: 18px;
        height: 18px;
        background: rgba(250, 255, 249, 0.98);
        border-left: 1px solid rgba(43, 100, 95, 0.14);
        border-top: 1px solid rgba(43, 100, 95, 0.14);
        transform: rotate(45deg);
      }
      .syntrae-tour-card[data-placement="right"]::after {
        left: -10px;
        top: var(--syntrae-tour-nub-top, 50%);
        margin-top: -9px;
      }
      .syntrae-tour-card[data-placement="left"]::after {
        right: -10px;
        top: var(--syntrae-tour-nub-top, 50%);
        margin-top: -9px;
        transform: rotate(225deg);
      }
      .syntrae-tour-card[data-placement="top"]::after {
        left: var(--syntrae-tour-nub-left, 50%);
        bottom: -10px;
        margin-left: -9px;
        transform: rotate(225deg);
      }
      .syntrae-tour-card[data-placement="bottom"]::after {
        left: var(--syntrae-tour-nub-left, 50%);
        top: -10px;
        margin-left: -9px;
      }
      .syntrae-tour-target {
        position: relative !important;
        z-index: 1278 !important;
        filter: none !important;
        opacity: 1 !important;
        box-shadow:
          0 0 0 3px rgba(255, 255, 255, 0.92),
          0 0 0 10px rgba(84, 214, 198, 0.18),
          0 26px 60px rgba(12, 44, 49, 0.18) !important;
        transition: box-shadow .24s ease, transform .24s ease;
        animation: syntraeTourPulse 2.2s ease-in-out infinite;
      }
      .syntrae-tour-target.syntrae-tour-target--soft {
        box-shadow:
          0 0 0 3px rgba(255, 255, 255, 0.88),
          0 0 0 10px rgba(84, 214, 198, 0.14),
          0 18px 42px rgba(12, 44, 49, 0.12) !important;
      }
      @keyframes syntraeTourPulse {
        0%, 100% {
          box-shadow:
            0 0 0 3px rgba(255, 255, 255, 0.92),
            0 0 0 10px rgba(84, 214, 198, 0.16),
            0 26px 60px rgba(12, 44, 49, 0.18);
        }
        50% {
          box-shadow:
            0 0 0 3px rgba(255, 255, 255, 0.95),
            0 0 0 14px rgba(84, 214, 198, 0.22),
            0 30px 72px rgba(12, 44, 49, 0.22);
        }
      }
      @media (max-width: 860px) {
        .syntrae-tour-trigger {
          left: 16px;
          right: 16px;
          bottom: 16px;
          justify-content: center;
        }
        .syntrae-tour-card {
          width: min(340px, calc(100vw - 24px));
          padding: 18px 18px 16px;
        }
        .syntrae-tour-card h3 {
          font-size: 26px;
        }
        .syntrae-tour-actions {
          flex-direction: column;
          align-items: stretch;
        }
        .syntrae-tour-actions-group {
          width: 100%;
          justify-content: space-between;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function orderedPlacements(preferred) {
    const base = ['right', 'left', 'bottom', 'top'];
    if (!preferred || preferred === 'auto') return base;
    return [preferred, ...base.filter((value) => value !== preferred)];
  }

  function buildTriggerIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3l1.8 3.8L18 8.6l-3 2.9.7 4.2L12 13.8 8.3 15.7l.7-4.2-3-2.9 4.2-1.8L12 3z"></path>
      </svg>
    `;
  }

  function getLocalStorage() {
    try {
      return window.localStorage || null;
    } catch (_) {
      return null;
    }
  }

  class PageTour {
    constructor(config) {
      this.config = Object.assign({
        pageKey: 'page',
        title: 'Page guide',
        triggerText: 'Page guide',
        queryParam: TOUR_QUERY_PARAM,
        autoStart: false,
        autoStartOnce: true,
        steps: []
      }, config || {});
      this.steps = Array.isArray(this.config.steps) ? this.config.steps : [];
      this.index = -1;
      this.active = false;
      this.target = null;
      this.highlightTarget = null;
      this.highlightTargetStyles = null;

      injectStyles();
      this.buildUi();
      if (this.config.showTrigger !== false) {
        this.mountTrigger();
      }
      this.attachEvents();

      if (this.shouldAutoStart()) {
        window.setTimeout(() => this.start({ automatic: true }), this.config.autoDelay || 260);
      }
    }

    buildUi() {
      this.backdrop = document.createElement('div');
      this.backdrop.className = 'syntrae-tour-backdrop';
      this.dimmers = ['top', 'right', 'bottom', 'left'].map((side) => {
        const dimmer = document.createElement('div');
        dimmer.className = `syntrae-tour-dimmer syntrae-tour-dimmer--${side}`;
        this.backdrop.appendChild(dimmer);
        return dimmer;
      });
      this.spotlight = document.createElement('div');
      this.spotlight.className = 'syntrae-tour-spotlight';
      this.backdrop.appendChild(this.spotlight);

      this.card = document.createElement('aside');
      this.card.className = 'syntrae-tour-card';
      this.card.hidden = true;
      this.card.innerHTML = `
        <span class="syntrae-tour-step"></span>
        <h3></h3>
        <p></p>
        <div class="syntrae-tour-actions">
          <button type="button" class="syntrae-tour-btn syntrae-tour-btn--ghost" data-tour-action="skip">Skip</button>
          <div class="syntrae-tour-actions-group">
            <button type="button" class="syntrae-tour-btn syntrae-tour-btn--ghost" data-tour-action="back">Back</button>
            <button type="button" class="syntrae-tour-btn syntrae-tour-btn--primary" data-tour-action="next">Next</button>
          </div>
        </div>
      `;

      document.body.appendChild(this.backdrop);
      document.body.appendChild(this.card);

      this.stepLabel = this.card.querySelector('.syntrae-tour-step');
      this.heading = this.card.querySelector('h3');
      this.copy = this.card.querySelector('p');
      this.skipButton = this.card.querySelector('[data-tour-action="skip"]');
      this.backButton = this.card.querySelector('[data-tour-action="back"]');
      this.nextButton = this.card.querySelector('[data-tour-action="next"]');
    }

    mountTrigger() {
      this.trigger = document.createElement('button');
      this.trigger.type = 'button';
      this.trigger.className = 'syntrae-tour-trigger';
      this.trigger.setAttribute('aria-label', this.config.title || this.config.triggerText || 'Page guide');
      this.trigger.innerHTML = `${buildTriggerIcon()}<span>${this.config.triggerText || 'Page guide'}</span>`;
      document.body.appendChild(this.trigger);
    }

    attachEvents() {
      if (this.trigger) {
        this.trigger.addEventListener('click', () => this.start());
      }
      this.skipButton.addEventListener('click', () => this.finish('skip'));
      this.backButton.addEventListener('click', () => this.goTo(this.index - 1, -1));
      this.nextButton.addEventListener('click', () => {
        if (this.index >= this.steps.length - 1) {
          this.finish('complete');
          return;
        }
        this.goTo(this.index + 1, 1);
      });
      this.backdrop.addEventListener('click', () => this.finish('dismiss'));
      window.addEventListener('resize', () => {
        if (!this.active) return;
        this.positionCard();
      });
      window.addEventListener('scroll', () => {
        if (!this.active) return;
        this.positionCard();
      }, { passive: true });
      document.addEventListener('keydown', (event) => {
        if (!this.active) return;
        if (event.key === 'Escape') {
          this.finish('dismiss');
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          this.nextButton.click();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          if (!this.backButton.hidden) this.backButton.click();
        }
      });
    }

    shouldAutoStart() {
      let requested = false;
      if (typeof this.config.autoStart === 'function') {
        requested = !!this.config.autoStart();
      } else if (this.config.autoStart === true) {
        requested = true;
      } else {
        const params = new URLSearchParams(window.location.search || '');
        const value = params.get(this.config.queryParam || TOUR_QUERY_PARAM);
        requested = value === '1' || value === this.config.pageKey;
      }

      if (!requested) return false;
      if (this.config.autoStartOnce === false) return true;
      return !this.hasSeenAutoTour();
    }

    autoTourStorageKey() {
      return `syntrae.pageTour.seen.${this.config.pageKey || 'page'}`;
    }

    hasSeenAutoTour() {
      const storage = getLocalStorage();
      if (!storage) return false;
      return storage.getItem(this.autoTourStorageKey()) === '1';
    }

    markAutoTourSeen() {
      const storage = getLocalStorage();
      if (!storage) return;
      try {
        storage.setItem(this.autoTourStorageKey(), '1');
      } catch (_) {
        // Non-critical: the tour can still run if storage is unavailable.
      }
    }

    start(options = {}) {
      if (!this.steps.length) return;
      if (options.automatic) {
        this.markAutoTourSeen();
      }
      this.active = true;
      this.card.hidden = false;
      this.backdrop.classList.add('is-visible');
      this.card.classList.add('is-visible');
      if (this.trigger) {
        this.trigger.style.opacity = '0';
        this.trigger.style.pointerEvents = 'none';
      }
      this.goTo(0, 1);
    }

    finish(reason = 'complete') {
      this.active = false;
      this.card.classList.remove('is-visible');
      this.backdrop.classList.remove('is-visible');
      window.setTimeout(() => {
        if (!this.active) this.card.hidden = true;
      }, 260);
      if (this.trigger) {
        this.trigger.style.opacity = '';
        this.trigger.style.pointerEvents = '';
      }
      this.clearTarget();
      if (typeof this.config.onFinish === 'function') {
        this.config.onFinish({
          reason,
          tour: this
        });
      }
    }

    clearTarget() {
      if (this.highlightTarget) {
        this.highlightTarget.classList.remove('syntrae-tour-target', 'syntrae-tour-target--soft');
        if (this.highlightTargetStyles) {
          Object.entries(this.highlightTargetStyles).forEach(([property, value]) => {
            this.highlightTarget.style[property] = value;
          });
        }
      }
      this.target = null;
      this.highlightTarget = null;
      this.highlightTargetStyles = null;
      this.hideSpotlight();
    }

    resolveHighlightTarget(step, element) {
      if (!element || !step?.highlightSelector) return element;
      if (element.matches(step.highlightSelector)) return element;

      const ancestor = element.closest(step.highlightSelector);
      if (ancestor) return ancestor;

      const descendant = element.querySelector(step.highlightSelector);
      if (descendant) return descendant;

      const globalMatch = document.querySelector(step.highlightSelector);
      return globalMatch || element;
    }

    rememberTargetStyles(element) {
      if (!element) return;
      this.highlightTargetStyles = {
        position: element.style.position,
        zIndex: element.style.zIndex,
        isolation: element.style.isolation,
        filter: element.style.filter,
        opacity: element.style.opacity
      };
      const computed = window.getComputedStyle(element);
      if (computed.position === 'static') {
        element.style.position = 'relative';
      }
      element.style.zIndex = '1278';
      element.style.isolation = 'isolate';
      element.style.filter = 'none';
      element.style.opacity = '1';
    }

    hideSpotlight() {
      if (this.spotlight) {
        Object.assign(this.spotlight.style, {
          left: '0px',
          top: '0px',
          width: '0px',
          height: '0px'
        });
      }
      (this.dimmers || []).forEach((dimmer) => {
        Object.assign(dimmer.style, {
          left: '0px',
          top: '0px',
          width: '0px',
          height: '0px'
        });
      });
    }

    updateSpotlight() {
      if (!this.highlightTarget || !this.spotlight || !this.dimmers?.length) return;
      const rect = this.highlightTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const padding = Number.isFinite(this.step?.spotlightPadding) ? this.step.spotlightPadding : 10;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const left = clamp(rect.left - padding, 0, viewportWidth);
      const top = clamp(rect.top - padding, 0, viewportHeight);
      const right = clamp(rect.right + padding, 0, viewportWidth);
      const bottom = clamp(rect.bottom + padding, 0, viewportHeight);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      const targetRadius = parseFloat(window.getComputedStyle(this.highlightTarget).borderRadius) || 18;
      const radius = Math.max(18, targetRadius + padding);

      const [topDimmer, rightDimmer, bottomDimmer, leftDimmer] = this.dimmers;
      Object.assign(topDimmer.style, {
        left: '0px',
        top: '0px',
        width: `${viewportWidth}px`,
        height: `${top}px`
      });
      Object.assign(rightDimmer.style, {
        left: `${right}px`,
        top: `${top}px`,
        width: `${Math.max(0, viewportWidth - right)}px`,
        height: `${height}px`
      });
      Object.assign(bottomDimmer.style, {
        left: '0px',
        top: `${bottom}px`,
        width: `${viewportWidth}px`,
        height: `${Math.max(0, viewportHeight - bottom)}px`
      });
      Object.assign(leftDimmer.style, {
        left: '0px',
        top: `${top}px`,
        width: `${left}px`,
        height: `${height}px`
      });
      Object.assign(this.spotlight.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: `${radius}px`
      });
    }

    resolveStep(startIndex, direction) {
      let cursor = startIndex;
      while (cursor >= 0 && cursor < this.steps.length) {
        const step = this.steps[cursor];
        const element = step && step.selector ? document.querySelector(step.selector) : null;
        if (step && element && (step.allowHidden || isElementVisible(element))) {
          return { index: cursor, step, element };
        }
        cursor += direction || 1;
      }
      return null;
    }

    goTo(startIndex, direction) {
      const resolved = this.resolveStep(startIndex, direction || 1);
      if (!resolved) {
        this.finish('complete');
        return;
      }

      const { index, step, element } = resolved;
      this.index = index;
      this.step = step;
      this.clearTarget();
      this.target = element;

      if (typeof step.beforeShow === 'function') {
        step.beforeShow({
          element,
          tour: this
        });
      }

      this.highlightTarget = this.resolveHighlightTarget(step, element) || element;
      this.rememberTargetStyles(this.highlightTarget);
      this.highlightTarget.classList.add('syntrae-tour-target');
      if (step.highlight === 'soft') {
        this.highlightTarget.classList.add('syntrae-tour-target--soft');
      }

      this.stepLabel.textContent = `${index + 1} of ${this.steps.length}`;
      this.heading.textContent = step.title || 'Guide';
      this.copy.textContent = step.description || '';
      this.backButton.hidden = index === 0;
      this.nextButton.textContent = index === this.steps.length - 1 ? 'Finish' : 'Next';

      const block = step.scrollBlock || 'center';
      this.target.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' });

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          this.updateSpotlight();
          this.positionCard();
        });
      });
      window.setTimeout(() => {
        this.updateSpotlight();
        this.positionCard();
      }, step.delay || 260);
    }

    positionCard() {
      if (!this.active || !this.target || !this.step) return;
      this.updateSpotlight();
      const rect = this.target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const cardRect = this.card.getBoundingClientRect();
      const placements = orderedPlacements(this.step.placement);

      const space = {
        right: viewportWidth - rect.right - VIEWPORT_PADDING,
        left: rect.left - VIEWPORT_PADDING,
        bottom: viewportHeight - rect.bottom - VIEWPORT_PADDING,
        top: rect.top - VIEWPORT_PADDING
      };

      let placement = placements.find((candidate) => {
        if (candidate === 'right' || candidate === 'left') {
          return space[candidate] >= cardRect.width + CARD_GAP;
        }
        return space[candidate] >= cardRect.height + CARD_GAP;
      });

      if (!placement) {
        placement = Object.entries(space).sort((a, b) => b[1] - a[1])[0][0];
      }

      let left = VIEWPORT_PADDING;
      let top = VIEWPORT_PADDING;

      if (placement === 'right') {
        left = rect.right + CARD_GAP;
        top = clamp(rect.top + rect.height / 2 - cardRect.height / 2, VIEWPORT_PADDING, viewportHeight - cardRect.height - VIEWPORT_PADDING);
        const nubTop = clamp(rect.top + rect.height / 2 - top, 24, cardRect.height - 24);
        this.card.style.setProperty('--syntrae-tour-nub-top', `${nubTop}px`);
      } else if (placement === 'left') {
        left = rect.left - cardRect.width - CARD_GAP;
        top = clamp(rect.top + rect.height / 2 - cardRect.height / 2, VIEWPORT_PADDING, viewportHeight - cardRect.height - VIEWPORT_PADDING);
        const nubTop = clamp(rect.top + rect.height / 2 - top, 24, cardRect.height - 24);
        this.card.style.setProperty('--syntrae-tour-nub-top', `${nubTop}px`);
      } else if (placement === 'top') {
        left = clamp(rect.left + rect.width / 2 - cardRect.width / 2, VIEWPORT_PADDING, viewportWidth - cardRect.width - VIEWPORT_PADDING);
        top = rect.top - cardRect.height - CARD_GAP;
        const nubLeft = clamp(rect.left + rect.width / 2 - left, 30, cardRect.width - 30);
        this.card.style.setProperty('--syntrae-tour-nub-left', `${nubLeft}px`);
      } else {
        left = clamp(rect.left + rect.width / 2 - cardRect.width / 2, VIEWPORT_PADDING, viewportWidth - cardRect.width - VIEWPORT_PADDING);
        top = rect.bottom + CARD_GAP;
        const nubLeft = clamp(rect.left + rect.width / 2 - left, 30, cardRect.width - 30);
        this.card.style.setProperty('--syntrae-tour-nub-left', `${nubLeft}px`);
      }

      left = clamp(left, VIEWPORT_PADDING, viewportWidth - cardRect.width - VIEWPORT_PADDING);
      top = clamp(top, VIEWPORT_PADDING, viewportHeight - cardRect.height - VIEWPORT_PADDING);

      this.card.dataset.placement = placement;
      this.card.style.left = `${Math.round(left)}px`;
      this.card.style.top = `${Math.round(top)}px`;
    }
  }

  window.SyntraePageTour = {
    init(config) {
      return new PageTour(config);
    }
  };
})();
