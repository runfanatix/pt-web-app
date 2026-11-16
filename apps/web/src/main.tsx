import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/plan.css';
import './styles/session.css';
import './styles/run.css';
import { DemoBanner } from './demo/DemoBanner.tsx';
import { installDemo, isDemo } from './demo/demo.tsx';

if (isDemo) installDemo();
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App />
    {isDemo && <DemoBanner />}
  </StrictMode>,
);
