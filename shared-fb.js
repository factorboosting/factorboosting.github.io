/* shared-fb.js — Factor Boosting shared behaviors
   Adds: theme toggle, localStorage persistence, mobile nav toggle, factor tooltips.
*/
(function () {
  'use strict';

  // ── Theme ───────────────────────────────────────────────────────────────
  const LS_THEME = 'fb-theme';
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(LS_THEME, t); } catch (e) {}
  }
  function initTheme() {
    let stored = null;
    try { stored = localStorage.getItem(LS_THEME); } catch (e) {}
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored || (prefersDark ? 'dark' : 'light'));
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
    window.dispatchEvent(new CustomEvent('fb:themechange', { detail: document.documentElement.getAttribute('data-theme') }));
  }
  window.fbSetTheme = applyTheme;
  window.fbToggleTheme = toggleTheme;

  // ── Theme toggle button injector ────────────────────────────────────────
  function injectThemeToggle() {
    const nav = document.querySelector('.nav-container');
    if (!nav || nav.querySelector('.theme-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.setAttribute('aria-label', 'Toggle theme');
    btn.innerHTML =
      '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>' +
      '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    btn.addEventListener('click', toggleTheme);
    // Drop inside nav-menu if we can, else append to container
    const toggleHost = nav.querySelector('.nav-toggle');
    if (toggleHost) nav.insertBefore(btn, toggleHost);
    else nav.appendChild(btn);
  }

  // ── Mobile nav ──────────────────────────────────────────────────────────
  function initMobileNav() {
    const toggle = document.querySelector('.nav-toggle');
    const menu   = document.querySelector('.nav-menu');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      menu.classList.toggle('open');
    });
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      toggle.classList.remove('open');
      menu.classList.remove('open');
    }));
  }

  // ── Factor tooltips (ported from your script.js; click-to-open, ESC-close) ─
  function initFactorTooltips() {
    const triggers = document.querySelectorAll('.factor-tooltip-trigger');
    if (triggers.length === 0) return;
    triggers.forEach(trigger => {
      trigger.addEventListener('click', function (e) {
        const isOpen = this.classList.contains('tooltip-open');
        triggers.forEach(t => t.classList.remove('tooltip-open'));
        if (!isOpen) this.classList.add('tooltip-open');
        e.stopPropagation();
      });
    });
    document.addEventListener('click', () => triggers.forEach(t => t.classList.remove('tooltip-open')));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') triggers.forEach(t => t.classList.remove('tooltip-open'));
    });
  }

  // ── Active nav link highlighter ─────────────────────────────────────────
  function initActiveNav() {
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    document.querySelectorAll('.nav-menu a').forEach(a => {
      const href = (a.getAttribute('href') || '').split('/').pop().toLowerCase();
      if (href && (href === page || (page === '' && href === 'index.html'))) {
        a.classList.add('active');
      }
    });
  }

  // Bootstrap theme ASAP (pre-DOM to avoid flash)
  initTheme();

  document.addEventListener('DOMContentLoaded', () => {
    injectThemeToggle();
    initMobileNav();
    initFactorTooltips();
    initActiveNav();
  });
})();
