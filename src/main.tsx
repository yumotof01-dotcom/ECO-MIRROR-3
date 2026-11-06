import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import '../design/prototype.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing');
createRoot(root).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
