// Which tab is showing, and which page of the Device tab.
import { app } from './app-state.ts';

export type View = 'comms' | 'map' | 'nodes' | 'device';
export type Page =
  | 'home'
  | 'general'
  | 'radio'
  | 'channels'
  | 'channel'
  | 'channel-share'
  | 'channel-scan'
  | 'position'
  | 'discovery'
  | 'screen'
  | 'bluetooth'
  | 'diagnostics'
  | 'plugins'
  | 'storage'
  | 'app';

/** Where Back goes from each page. */
const PARENT: Partial<Record<Page, Page>> = {
  channel: 'channels',
  'channel-share': 'channel',
  'channel-scan': 'channels',
};

let page: Page = 'home';
const viewHooks: (() => void)[] = [];
const pageHooks: ((left: Page, entered: Page) => void)[] = [];
export const currentPage = () => page;
export const currentView = () => app.dataset.view as View;
export const isShowing = (target: Page) => currentView() === 'device' && page === target;
export function onViewChange(hook: () => void) {
  viewHooks.push(hook);
}
/** Runs when a Device page is left, including by changing tabs. Secrets get cleared here. */
export function onPageChange(hook: (left: Page, entered: Page) => void) {
  pageHooks.push(hook);
}

export function setView(view: View) {
  const previous = currentView();
  app.dataset.view = view;
  for (const button of document.querySelectorAll<HTMLElement>('.rail [data-view-target]')) {
    const active = button.dataset.viewTarget === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  // Leaving the Device tab counts as leaving its page, even though the page stays selected.
  if (previous === 'device' && view !== 'device') for (const hook of pageHooks) hook(page, page);
  for (const hook of viewHooks) hook();
}

export function openPage(target: Page) {
  const left = page;
  page = target;
  for (const section of document.querySelectorAll<HTMLElement>('[data-page]'))
    section.hidden = section.dataset.page !== target;
  document.querySelector<HTMLElement>(`[data-page="${target}"] .page-body`)?.scrollTo({ top: 0 });
  if (currentView() !== 'device') setView('device');
  if (left !== target) for (const hook of pageHooks) hook(left, target);
}

export function backPage() {
  openPage(PARENT[page] ?? 'home');
}

export function initNavigation() {
  for (const button of document.querySelectorAll<HTMLElement>('.rail [data-view-target]'))
    button.addEventListener('click', () => {
      const view = button.dataset.viewTarget as View;
      // Selecting the tab you're already on goes back to its start, like a phone's tab bar.
      if (view === currentView()) {
        if (view === 'device') openPage('home');
        if (view === 'comms') app.classList.remove('has-conversation');
        return;
      }
      setView(view);
    });
  for (const button of document.querySelectorAll<HTMLElement>('[data-page-target]'))
    button.addEventListener('click', () => openPage(button.dataset.pageTarget as Page));
  for (const button of document.querySelectorAll<HTMLElement>('[data-page-back]'))
    button.addEventListener('click', backPage);
  setView('comms');
}
