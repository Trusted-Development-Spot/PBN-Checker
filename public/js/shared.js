/**
 * PBN Skye — Shared Vanilla JS Utility
 * Handles Dark/Light Mode, Mobile Navigation, and Shared Components
 */

(function () {
  'use strict';

  // 1. Theme Management
  const THEME_STORAGE_KEY = 'pbnskye_theme';

  function initTheme() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme === 'dark' || (!savedTheme && prefersDark);

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    updateThemeToggleButtons(isDark);
  }

  function toggleTheme() {
    const isCurrentlyDark = document.documentElement.classList.contains('dark');
    const newTheme = !isCurrentlyDark;

    if (newTheme) {
      document.documentElement.classList.add('dark');
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
    }
    updateThemeToggleButtons(newTheme);
  }

  function updateThemeToggleButtons(isDark) {
    const toggleBtns = document.querySelectorAll('[data-theme-toggle]');
    toggleBtns.forEach((btn) => {
      const sunIcon = btn.querySelector('.theme-icon-sun');
      const moonIcon = btn.querySelector('.theme-icon-moon');
      const textSpan = btn.querySelector('.theme-text');

      if (sunIcon && moonIcon) {
        if (isDark) {
          sunIcon.classList.remove('hidden');
          moonIcon.classList.add('hidden');
          btn.setAttribute('aria-label', 'Switch to light mode');
          if (textSpan) textSpan.textContent = 'Light';
        } else {
          sunIcon.classList.add('hidden');
          moonIcon.classList.remove('hidden');
          btn.setAttribute('aria-label', 'Switch to dark mode');
          if (textSpan) textSpan.textContent = 'Dark';
        }
      }
    });
  }

  // 2. Mobile Menu Management
  function initMobileMenu() {
    const menuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    if (!menuBtn || !mobileMenu) return;

    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const isExpanded = menuBtn.getAttribute('aria-expanded') === 'true';
      menuBtn.setAttribute('aria-expanded', (!isExpanded).toString());
      mobileMenu.classList.toggle('hidden');
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!mobileMenu.contains(e.target) && !menuBtn.contains(e.target)) {
        mobileMenu.classList.add('hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // 3. Highlight Active Navigation Link
  function highlightActiveNav() {
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('nav a[href], #mobile-menu a[href]');

    navLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (!href) return;
      const linkPath = href.split('/').pop() || 'index.html';

      if (linkPath === currentPath || (currentPath === '' && linkPath === 'index.html')) {
        link.classList.add('text-indigo-600', 'dark:text-indigo-400', 'font-semibold');
        link.classList.remove('text-slate-600', 'dark:text-slate-300');
      }
    });
  }

  // 4. FAQ Accordion Handler (if present on the page)
  function initFaqAccordion() {
    const faqButtons = document.querySelectorAll('[data-faq-toggle]');
    faqButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const targetId = button.getAttribute('data-faq-toggle');
        const targetContent = document.getElementById(targetId);
        const icon = button.querySelector('[data-faq-icon]');

        if (!targetContent) return;

        const isHidden = targetContent.classList.contains('hidden');
        if (isHidden) {
          targetContent.classList.remove('hidden');
          button.setAttribute('aria-expanded', 'true');
          if (icon) icon.style.transform = 'rotate(180deg)';
        } else {
          targetContent.classList.add('hidden');
          button.setAttribute('aria-expanded', 'false');
          if (icon) icon.style.transform = 'rotate(0deg)';
        }
      });
    });
  }

  // Bind Events on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMobileMenu();
    highlightActiveNav();
    initFaqAccordion();

    // Attach theme toggle listeners
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.addEventListener('click', toggleTheme);
    });
  });

  // Expose toggleTheme globally if needed
  window.toggleTheme = toggleTheme;
})();
