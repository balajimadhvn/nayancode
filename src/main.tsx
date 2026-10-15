import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/tokens.css';
import './styles/global.css';
import './core/ui-store';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installChunkRecovery } from './core/chunk-recovery';

installChunkRecovery();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
