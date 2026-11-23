import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Pond from './pond/Pond';
import './index.css';

// iOS Safari 的雙指會放大整頁；池子自己處理縮放，所以擋掉瀏覽器的。
document.addEventListener('gesturestart', (event) => event.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Pond />
  </StrictMode>,
);
