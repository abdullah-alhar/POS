import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { App } from './app/app';
import './index.css';

// Friendlier messages for empty or invalid number fields in forms.
z.config({
  customError: (issue) => {
    if (issue.code === 'invalid_type' && issue.expected === 'number') return 'Enter a valid number';
    return undefined;
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
