import { createContext, useContext, useEffect, useState } from 'react';

const THEME_KEY = 'hospostack.theme';

export const THEMES = [
  // ── Base themes ──────────────────────────────────────────────────────────
  {
    id: 'dark',
    label: 'Midnight Dark',
    emoji: '🌑',
    group: 'Base',
    description: 'Default deep dark — easy on the eyes at night',
    preview: ['#0b0d10', '#ff7a45', '#e8eaed'],
  },
  {
    id: 'light',
    label: 'Daylight',
    emoji: '☀️',
    group: 'Base',
    description: 'Bright warm-white for well-lit venues',
    preview: ['#f5f5f0', '#c44a1a', '#1a1612'],
  },
  {
    id: 'cinema',
    label: 'Cinema',
    emoji: '🎬',
    group: 'Base',
    description: 'Ultra-dark, low-brightness — perfect for dim service',
    preview: ['#060608', '#ff6030', '#c8c8d8'],
  },

  // ── Curated restaurant themes ─────────────────────────────────────────────
  {
    id: 'royal-saffron',
    label: 'Royal Saffron',
    emoji: '🌼',
    group: 'Indian Luxury',
    description: 'Deep charcoal, saffron orange & antique gold — premium modern Indian',
    preview: ['#1a1510', '#d4891a', '#f5e6c8'],
  },
  {
    id: 'emerald-brass',
    label: 'Emerald & Brass',
    emoji: '🌿',
    group: 'Indian Luxury',
    description: 'Emerald green, brass gold & walnut — rich restobar / night dining',
    preview: ['#0d1a14', '#c9a84c', '#f0e8d6'],
  },
  {
    id: 'kerala-coastal',
    label: 'Kerala Coastal',
    emoji: '🌴',
    group: 'Indian Luxury',
    description: 'Coconut wood, deep green, sand & brass — South Indian coastal elegance',
    preview: ['#1c1508', '#2d6a4f', '#e8d5b0'],
  },
  {
    id: 'midnight-sapphire',
    label: 'Midnight Sapphire',
    emoji: '💎',
    group: 'Indian Luxury',
    description: 'Deep sapphire blue, platinum silver & ice white — modern luxury fine dining',
    preview: ['#0a1430', '#4a8acc', '#e8eef8'],
  },

  // ── Fast Casual ───────────────────────────────────────────────────────────
  {
    id: 'street-neon',
    label: 'Street Food Neon',
    emoji: '🌆',
    group: 'Fast Casual',
    description: 'Mumbai taxi yellow, neon red & turquoise on matte black — high energy QSR',
    preview: ['#0a0a08', '#f5c518', '#00d4d4'],
  },
  {
    id: 'clay-copper',
    label: 'Minimal Clay & Copper',
    emoji: '🏺',
    group: 'Fast Casual',
    description: 'Terracotta, clay beige & copper — calm modern Indian-fusion, readable all day',
    preview: ['#f5ede4', '#b5541c', '#2a1f18'],
  },
  {
    id: 'bollywood-retro',
    label: 'Bollywood Retro',
    emoji: '🎭',
    group: 'Fast Casual',
    description: 'Mustard yellow, retro red & teal — playful vintage Indian cinema feel',
    preview: ['#1a1008', '#e8b84b', '#c0392b'],
  },
  {
    id: 'spicy-curry',
    label: 'Spicy Curry',
    emoji: '🌶',
    group: 'Fast Casual',
    description: 'Tomato red, turmeric yellow & coriander green — bold spice-market energy',
    preview: ['#1a0a08', '#e8472b', '#f0c040'],
  },
  {
    id: 'mango-lassi',
    label: 'Mango Lassi',
    emoji: '🥭',
    group: 'Fast Casual',
    description: 'Sunset mango, creamy peach & soft pink — bright cheerful breakfast/lunch',
    preview: ['#fff5e8', '#ff8c2a', '#3a1a08'],
  },

  // ── Vibrant ───────────────────────────────────────────────────────────────
  {
    id: 'sporty-arena',
    label: 'Sporty Arena',
    emoji: '🏆',
    group: 'Vibrant',
    description: 'Electric blue, neon lime & jet black — energetic sports-bar / cafe',
    preview: ['#0a1020', '#00aaff', '#bfff00'],
  },
  {
    id: 'rose-gold',
    label: 'Rose Gold',
    emoji: '🌹',
    group: 'Vibrant',
    description: 'Rose gold, dusty pink & cream — feminine modern cafe / patisserie',
    preview: ['#1a1014', '#e89b8a', '#f5e0d6'],
  },

  // ── Operational ───────────────────────────────────────────────────────────
  {
    id: 'kitchen-rush',
    label: 'Kitchen Rush',
    emoji: '⚡',
    group: 'Operational',
    description: 'Dark graphite, high-contrast — max readability for KOT & cashier rush',
    preview: ['#1a1a1a', '#ff3b30', '#ffffff'],
  },
];

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(
    () => localStorage.getItem(THEME_KEY) || 'dark'
  );

  const setTheme = (id) => {
    localStorage.setItem(THEME_KEY, id);
    document.documentElement.setAttribute('data-theme', id);
    setThemeState(id);
  };

  useEffect(() => {
    // Apply on mount (handles page refresh)
    document.documentElement.setAttribute('data-theme', theme);
  }, []);  // eslint-disable-line

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
