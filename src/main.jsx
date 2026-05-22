import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
import { initNative } from './lib/native';

// Boot native integrations (status bar, orientation, wake lock, back button).
// Runs after React hydrates so plugins are ready; safe no-op in browser.
initNative().catch(console.warn);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
