import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Pond from './pond/Pond';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Pond />
  </StrictMode>,
);
