import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import Modal from 'react-modal';
import { queryClient } from './utils/queryClient';
import { installScrollbarVisibility } from './utils/scrollbarVisibility';

window.addEventListener('auth:changed', () => {
  queryClient.clear();
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
