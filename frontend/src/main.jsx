import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import Modal from 'react-modal';
import { queryClient } from './utils/queryClient';
import { installScrollbarVisibility } from './utils/scrollbarVisibility';
import { useAgentStore } from './store/useAgentStore';
import { useSearchStore } from './store/useSearchStore';
import { useTabsStore } from './store/useTabsStore';

// The account the open tabs belong to: an expired session keeps them (unsaved text included) for
// that account to log back in and save; anyone else logging in gets them closed
let tabsOwnerId = null;

window.addEventListener('auth:changed', ({ detail = {} }) => {
  queryClient.clear();
  if (detail.loggedIn) {
    if (tabsOwnerId && tabsOwnerId !== detail.userId) useTabsStore.getState().resetTabs();
    tabsOwnerId = detail.userId || null;
    return;
  }
  // The session ended: nothing of this account's agent chats stays in memory
  useAgentStore.getState().reset();
  useSearchStore.getState().setSearchMode('keyword');
  if (detail.reason !== 'expired') {
    useTabsStore.getState().resetTabs();
    tabsOwnerId = null;
  }
});

Modal.setAppElement('#root'); // Set the app element for accessibility
installScrollbarVisibility(); // scrollbars show only while their area scrolls
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
