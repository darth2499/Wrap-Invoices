import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { applyTheme, initialTheme } from './components/ThemeToggle.jsx';

applyTheme(initialTheme());

createRoot(document.getElementById('root')).render(<App />);
