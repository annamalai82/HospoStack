import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import {
  getVenueId, createMenuCategory, createMenuItem,
  watchCategories, deleteEntireMenu
} from '../lib/data';
import { useEffect } from 'react';

const STEPS = ['source', 'preview', 'review', 'done'];

const SOURCE_TYPES = [
  { id: 'preset',      icon: '⚡', title: 'Sizzle N Sambar preset', blurb: 'Pre-loaded with the full SNS menu — 78 items across 14 categories. One-click import.' },
  { id: 'paste',       icon: '📝', title: 'Paste text',        blurb: 'Paste a plain-text menu. The AI parser will detect items and prices.' },
  { id: 'excel',       icon: '📊', title: 'Excel / CSV',        blurb: 'Upload .xlsx, .xls or .csv. Expects columns: name, category, price.' },
  { id: 'word',        icon: '📄', title: 'Word document',      blurb: 'Upload a .docx file. Converted to text then parsed by AI.' },
  { id: 'pdf-text',    icon: '📑', title: 'PDF (text-based)',   blurb: 'Upload a PDF with selectable text.' },
  { id: 'image',       icon: '📸', title: 'Photo / image',      blurb: 'Snap or upload a handwritten or printed menu photo. AI will read it.' }
];

// Full Sizzle N Sambar menu from East Victoria Park — transcribed from the printed menu
const SNS_PRESET = [
  // VEG STARTERS
  { name: 'Gobi 65',                     category: 'Veg Starters',     price: 15.9, station: 'kitchen' },
  { name: 'Mushroom 65',                 category: 'Veg Starters',     price: 18.9, station: 'kitchen' },
  { name: 'Paneer Tikka (Sizzler)',      category: 'Veg Starters',     price: 18.9, station: 'kitchen' },
  { name: 'Veg Balls Manchurian',        category: 'Veg Starters',     price: 19.9, station: 'kitchen' },
  { name: 'Chilli Paneer',               category: 'Veg Starters',     price: 19.9, station: 'kitchen' },
  { name: 'Medhu Vadai (2pcs)',          category: 'Veg Starters',     price: 10.9, station: 'kitchen' },
  { name: 'Aloo Samosa (2pcs)',          category: 'Veg Starters',     price: 10.9, station: 'kitchen' },
  // NON VEG STARTERS
  { name: 'Prawn Milagu Varuval',        category: 'Non Veg Starters', price: 25.9, station: 'kitchen' },
  { name: 'Meen Varuval (Barramundi)',   category: 'Non Veg Starters', price: 23.9, station: 'kitchen' },
  { name: 'Mutton Chukka',               category: 'Non Veg Starters', price: 23.9, station: 'kitchen' },
  { name: 'Beef Pepper Fry',             category: 'Non Veg Starters', price: 22.9, station: 'kitchen' },
  { name: 'Chicken Maharani (on bone)',  category: 'Non Veg Starters', price: 22.9, station: 'kitchen' },
  { name: 'Chicken 65',                  category: 'Non Veg Starters', price: 19.9, station: 'kitchen' },
  { name: 'Chilli Chicken',              category: 'Non Veg Starters', price: 24.9, station: 'kitchen' },
  { name: 'Chicken Lollypop',            category: 'Non Veg Starters', price: 19.9, station: 'kitchen' },
  { name: 'Tandoori Chicken 4pcs',       category: 'Non Veg Starters', price: 19.9, station: 'kitchen' },
  { name: 'Tandoori Chicken 8pcs',       category: 'Non Veg Starters', price: 29.9, station: 'kitchen' },
  { name: 'Lamb Seekh Kebab (5pcs)',     category: 'Non Veg Starters', price: 21.9, station: 'kitchen' },
  { name: 'Nandu Omlette',               category: 'Non Veg Starters', price: 18.9, station: 'kitchen' },
  { name: 'Kalakki',                     category: 'Non Veg Starters', price: 13.9, station: 'kitchen' },
  // SNS SPECIALS
  { name: 'Kizhi Parotta — Chicken',     category: 'SNS Specials',     price: 25.9, station: 'kitchen', description: 'Flaky parotta filled with curry, sealed in banana leaf, slow-steamed' },
  { name: 'Kizhi Parotta — Goat',        category: 'SNS Specials',     price: 27.9, station: 'kitchen', description: 'Flaky parotta filled with curry, sealed in banana leaf, slow-steamed' },
  { name: 'Paal Parotta Mudpot — Chicken', category: 'SNS Specials',   price: 25.9, station: 'kitchen', description: 'Parotta soaked in coconut milk and South Indian spices' },
  { name: 'Paal Parotta Mudpot — Goat',  category: 'SNS Specials',     price: 27.9, station: 'kitchen', description: 'Parotta soaked in coconut milk and South Indian spices' },
  { name: 'Nalli Fry',                   category: 'SNS Specials',     price: 29.9, station: 'kitchen', description: 'Melt-in-the-mouth mutton shanks, best with malabar parotta or jeera rice' },
  { name: 'Kari Dosa',                   category: 'SNS Specials',     price: 22.9, station: 'kitchen', description: 'Chicken curry with onions, tomatoes & South Indian masalas on a crisp dosa' },
  { name: 'Kothu Parotta — Veg',         category: 'SNS Specials',     price: 19.9, station: 'kitchen' },
  { name: 'Kothu Parotta — Egg',         category: 'SNS Specials',     price: 19.9, station: 'kitchen' },
  { name: 'Kothu Parotta — Chicken',     category: 'SNS Specials',     price: 22.9, station: 'kitchen' },
  { name: 'Kothu Parotta — Mutton',      category: 'SNS Specials',     price: 24.9, station: 'kitchen' },
  { name: 'Neer Dosa with Chicken Ghee Roast', category: 'SNS Specials', price: 23.9, station: 'kitchen' },
  { name: 'Neer Dosa with Sambar & Chutney',   category: 'SNS Specials', price: 19.9, station: 'kitchen' },
  { name: 'Meen Polichathu',             category: 'SNS Specials',     price: 27.9, station: 'kitchen', description: 'Kerala dish — fish smeared in spices, wrapped in banana leaves and steamed' },
  // IDLI
  { name: 'Idli (3pcs)',                 category: 'Idli',             price: 13.9, station: 'kitchen' },
  { name: 'Mini Podi Idli',              category: 'Idli',             price: 16.9, station: 'kitchen' },
  { name: 'Mini Ghee Idli',              category: 'Idli',             price: 16.9, station: 'kitchen' },
  // DOSAI
  { name: 'Plain Dosai',                 category: 'Dosai',            price: 15.9, station: 'kitchen' },
  { name: 'Ghee Dosai',                  category: 'Dosai',            price: 16.9, station: 'kitchen' },
  { name: 'Masala Dosai',                category: 'Dosai',            price: 18.9, station: 'kitchen' },
  { name: 'Ghee Podi Dosai',             category: 'Dosai',            price: 18.9, station: 'kitchen' },
  { name: 'Ghee Podi Masala Dosai',      category: 'Dosai',            price: 20.9, station: 'kitchen' },
  { name: 'Mysore Masala Dosai',         category: 'Dosai',            price: 21.9, station: 'kitchen' },
  { name: 'Paneer Masala Dosai',         category: 'Dosai',            price: 22.9, station: 'kitchen' },
  { name: 'Rava Dosai',                  category: 'Dosai',            price: 18.9, station: 'kitchen' },
  { name: 'Onion Rava Dosai',            category: 'Dosai',            price: 19.9, station: 'kitchen' },
  { name: 'Rava Masala Dosai',           category: 'Dosai',            price: 20.9, station: 'kitchen' },
  { name: 'Rava Ghee Roast',             category: 'Dosai',            price: 20.9, station: 'kitchen' },
  { name: 'Onion Uttappam',              category: 'Dosai',            price: 15.9, station: 'kitchen' },
  { name: 'Vegetable Uttappam',          category: 'Dosai',            price: 17.9, station: 'kitchen' },
  { name: 'Egg Dosai',                   category: 'Dosai',            price: 18.9, station: 'kitchen' },
  // POORI & BATURA
  { name: 'Poori 3pcs with Potato Masala', category: 'Poori & Batura', price: 17.9, station: 'kitchen' },
  { name: 'Channa Batura',               category: 'Poori & Batura',   price: 21.9, station: 'kitchen' },
  // BIRIYANI
  { name: 'Kaikari / Veg Biriyani',      category: 'Biriyani',         price: 19.9, station: 'kitchen' },
  { name: 'Mambas Biriyani — Chicken',   category: 'Biriyani',         price: 23.9, station: 'kitchen', description: 'SNS Special' },
  { name: 'Mambas Biriyani — Goat',      category: 'Biriyani',         price: 25.9, station: 'kitchen', description: 'SNS Special' },
  { name: 'Dum Biriyani — Chicken',      category: 'Biriyani',         price: 23.9, station: 'kitchen' },
  { name: 'Dum Biriyani — Beef',         category: 'Biriyani',         price: 23.9, station: 'kitchen' },
  { name: 'Dum Biriyani — Goat',         category: 'Biriyani',         price: 25.9, station: 'kitchen' },
  { name: 'Dum Biriyani — Fish',         category: 'Biriyani',         price: 28.9, station: 'kitchen' },
  { name: 'Dum Biriyani — Prawns',       category: 'Biriyani',         price: 28.9, station: 'kitchen' },
  // RICE
  { name: 'Plain Rice',                  category: 'Rice',             price: 5.9,  station: 'kitchen' },
  { name: 'Jeera Rice',                  category: 'Rice',             price: 5.9,  station: 'kitchen' },
  { name: 'Matar Pulao',                 category: 'Rice',             price: 9.9,  station: 'kitchen' },
  // INDIAN BREADS
  { name: 'Malabar Parotta',             category: 'Breads',           price: 4.9,  station: 'kitchen' },
  { name: 'Naan — Plain',                category: 'Breads',           price: 5.9,  station: 'kitchen' },
  { name: 'Naan — Butter',               category: 'Breads',           price: 6.9,  station: 'kitchen' },
  { name: 'Naan — Garlic',               category: 'Breads',           price: 5.9,  station: 'kitchen' },
  { name: 'Naan — Chilli',               category: 'Breads',           price: 6.9,  station: 'kitchen' },
  { name: 'Naan — Cheese',               category: 'Breads',           price: 7.5,  station: 'kitchen' },
  { name: 'Tandoori Roti — Plain',       category: 'Breads',           price: 4.9,  station: 'kitchen' },
  { name: 'Tandoori Roti — Butter',      category: 'Breads',           price: 5.9,  station: 'kitchen' },
  // VEG CURRIES
  { name: 'Aloo Gobi',                   category: 'Veg Curries',      price: 18.9, station: 'kitchen' },
  { name: 'Daal Tadka',                  category: 'Veg Curries',      price: 18.9, station: 'kitchen' },
  { name: 'Channa Masala',               category: 'Veg Curries',      price: 18.9, station: 'kitchen' },
  { name: 'Shahi Mushroom Matar',        category: 'Veg Curries',      price: 20.9, station: 'kitchen' },
  { name: 'Veg Jalfrezi',                category: 'Veg Curries',      price: 20.9, station: 'kitchen' },
  { name: 'Pachai Kari Kurma',           category: 'Veg Curries',      price: 20.9, station: 'kitchen' },
  { name: 'Kathrikai Curry (Eggplant Masala)', category: 'Veg Curries', price: 21.9, station: 'kitchen' },
  { name: 'Paneer Butter Masala',        category: 'Veg Curries',      price: 22.9, station: 'kitchen' },
  { name: 'Palak Paneer',                category: 'Veg Curries',      price: 24.9, station: 'kitchen' },
  // CHICKEN CURRIES
  { name: 'Butter Chicken',              category: 'Chicken Curries',  price: 24.9, station: 'kitchen' },
  { name: 'Chettinad Chicken',           category: 'Chicken Curries',  price: 24.9, station: 'kitchen', description: 'SNS Special' },
  { name: 'Chicken Vanutha Curry',       category: 'Chicken Curries',  price: 24.9, station: 'kitchen', description: 'SNS Special' },
  { name: 'Chicken Chettan',             category: 'Chicken Curries',  price: 24.9, station: 'kitchen' },
  { name: 'Spicy Andhra Chicken Curry',  category: 'Chicken Curries',  price: 24.9, station: 'kitchen' },
  { name: 'Chicken Tikka Masala',        category: 'Chicken Curries',  price: 24.9, station: 'kitchen' },
  { name: 'Chicken Jalfrezi',            category: 'Chicken Curries',  price: 24.9, station: 'kitchen' },
  // MUTTON / LAMB / BEEF
  { name: 'Mutton Chukka',               category: 'Mutton Curries',   price: 28.9, station: 'kitchen', description: 'SNS Special' },
  { name: 'Mutton Vanutha Curry',        category: 'Mutton Curries',   price: 28.9, station: 'kitchen' },
  { name: 'Mutton Paya',                 category: 'Mutton Curries',   price: 22.9, station: 'kitchen' },
  { name: 'Lamb Rogan Josh',             category: 'Lamb Curries',     price: 28.9, station: 'kitchen' },
  { name: 'Lamb Korma',                  category: 'Lamb Curries',     price: 28.9, station: 'kitchen' },
  { name: 'Beef Masala',                 category: 'Beef Curries',     price: 27.9, station: 'kitchen' },
  { name: 'Beef Vindaloo',               category: 'Beef Curries',     price: 27.9, station: 'kitchen' },
  // FISH & PRAWNS
  { name: 'Gramathu Meen Kozhambu',      category: 'Fish & Prawns',    price: 28.9, station: 'kitchen' },
  { name: 'Varutharacha Chemeen Curry',  category: 'Fish & Prawns',    price: 28.9, station: 'kitchen' },
  // EGG
  { name: 'Egg Roast (2pcs)',            category: 'Egg',              price: 19.9, station: 'kitchen' },
  // IDIAPPAM / STRING HOPPER
  { name: 'Idiappam 4pcs',               category: 'Idiappam',         price: 11.9, station: 'kitchen' },
  { name: 'Paya with Idiappam — SNS Special', category: 'Idiappam',    price: 29.9, station: 'kitchen' },
  // FRIED RICE / NOODLES
  { name: 'Veg Fried Rice / Schezwan Fried Rice',     category: 'Fried Rice & Noodles', price: 18.9, station: 'kitchen' },
  { name: 'Egg Fried Rice / Schezwan Fried Rice',     category: 'Fried Rice & Noodles', price: 20.9, station: 'kitchen' },
  { name: 'Chicken Fried Rice / Schezwan Fried Rice', category: 'Fried Rice & Noodles', price: 22.9, station: 'kitchen' },
  { name: 'Prawn Fried Rice / Schezwan Fried Rice',   category: 'Fried Rice & Noodles', price: 24.9, station: 'kitchen' },
  { name: 'Hakka Noodles / Schezwan Noodles — Veg',     category: 'Fried Rice & Noodles', price: 18.9, station: 'kitchen' },
  { name: 'Hakka Noodles / Schezwan Noodles — Chicken', category: 'Fried Rice & Noodles', price: 22.9, station: 'kitchen' },
  // SAAPADU
  { name: 'Saapadu — Veg',               category: 'Saapadu (Limited)', price: 21.9, station: 'kitchen', description: 'Fri/Sat/Sun only' },
  { name: 'Saapadu — Chicken',           category: 'Saapadu (Limited)', price: 25.9, station: 'kitchen', description: 'Fri/Sat/Sun only' },
  { name: 'Saapadu — Mutton',            category: 'Saapadu (Limited)', price: 27.9, station: 'kitchen', description: 'Fri/Sat/Sun only' },
  { name: 'Saapadu — Fish',              category: 'Saapadu (Limited)', price: 30.9, station: 'kitchen', description: 'Fri/Sat/Sun only' },
  // DESSERTS
  { name: 'Rasmalai 2pcs',               category: 'Desserts',         price: 7.9,  station: 'kitchen' },
  { name: 'Gulab Jamun 3pcs',            category: 'Desserts',         price: 7.9,  station: 'kitchen' },
  { name: 'Pistachio Kulfi',             category: 'Desserts',         price: 7.9,  station: 'kitchen' },
  // BEVERAGES
  { name: 'Badam Milk (Hot or Cold)',    category: 'Beverages',        price: 6.9,  station: 'bar' },
  { name: 'Filter Coffee',               category: 'Beverages',        price: 4.9,  station: 'bar' },
  { name: 'Masala Chai',                 category: 'Beverages',        price: 4.9,  station: 'bar' },
  { name: 'Lemon Lime Bitters',          category: 'Beverages',        price: 6.9,  station: 'bar' },
  { name: 'Apple Juice',                 category: 'Beverages',        price: 4.9,  station: 'bar' },
  { name: 'Rose Milk',                   category: 'Beverages',        price: 6.9,  station: 'bar' },
  { name: 'Nannari Sarbath',             category: 'Beverages',        price: 6.9,  station: 'bar' },
  { name: 'Soft Drinks — Coke / Coke No Sugar / Sprite / Fanta', category: 'Beverages', price: 5.9, station: 'bar' },
  { name: 'Water Bottle',                category: 'Beverages',        price: 4.9,  station: 'bar' },
  // ACCOMPANIMENTS
  { name: 'Onion Cucumber Raitha',       category: 'Accompaniments',   price: 6.0,  station: 'kitchen' },
  { name: 'Kachumber Salad',             category: 'Accompaniments',   price: 6.0,  station: 'kitchen' },
  { name: 'Tomato Onion Salad',          category: 'Accompaniments',   price: 5.0,  station: 'kitchen' },
  { name: 'Yoghurt',                     category: 'Accompaniments',   price: 4.0,  station: 'kitchen' },
  { name: 'Spicy Mixed Pickle',          category: 'Accompaniments',   price: 4.0,  station: 'kitchen' },
  { name: 'Mint Chutney',                category: 'Accompaniments',   price: 4.0,  station: 'kitchen' }
];

export default function MenuImporter({ onDone }) {
  const [step, setStep] = useState('source');
  const [sourceType, setSourceType] = useState(null);
  const [rawText, setRawText] = useState('');
  const [parsedItems, setParsedItems] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [existingCats, setExistingCats] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState('append'); // 'append' | 'replace'
  const [deleteProgress, setDeleteProgress] = useState(null); // { done, total } during replace
  const [imported, setImported] = useState({ items: 0, categories: 0, deleted: 0 });
  const [createCategories, setCreateCategories] = useState(true);

  useEffect(() => watchCategories(setExistingCats), []);

  // ─── Source step → handle each source type ──────────────────────────
  const handleSourceProcess = async (data) => {
    setError('');
    setParsing(true);
    try {
      if (sourceType === 'preset') {
        // Pre-loaded Sizzle N Sambar menu — no AI, no upload
        setParsedItems(SNS_PRESET.map(i => ({ ...i, _include: true })));
        setStep('review');
      } else if (sourceType === 'excel') {
        const items = parseExcel(data);
        setParsedItems(items);
        setStep('review');
      } else if (sourceType === 'word') {
        const text = await parseWord(data);
        setRawText(text);
        const items = await parseWithAI(text);
        setParsedItems(items);
        setStep('review');
      } else if (sourceType === 'paste') {
        const items = await parseWithAI(data);
        setParsedItems(items);
        setStep('review');
      } else if (sourceType === 'pdf-text') {
        // Use FileReader to extract text via the browser's PDF.js if available,
        // otherwise we read as text (some PDFs work, some don't)
        const text = await parsePdfText(data);
        setRawText(text);
        const items = await parseWithAI(text);
        setParsedItems(items);
        setStep('review');
      } else if (sourceType === 'image') {
        const items = await parseImageWithAI(data);
        setParsedItems(items);
        setStep('review');
      }
    } catch (e) {
      setError(e.message || 'Failed to parse');
    } finally {
      setParsing(false);
    }
  };

  // ─── Import to Firestore ─────────────────────────────────────────────
  const handleImport = async () => {
    setImporting(true);
    setDeleteProgress(null);
    let categoriesCreated = 0;
    let itemsCreated = 0;
    let deletedCount = 0;
    try {
      // ── Replace mode: wipe existing menu first ──────────────────────
      if (importMode === 'replace') {
        setDeleteProgress({ done: 0, total: 1, phase: 'Deleting existing menu…' });
        deletedCount = await deleteEntireMenu((done, total) => {
          setDeleteProgress({ done, total, phase: `Deleting… ${done}/${total}` });
        });
        setDeleteProgress({ done: deletedCount, total: deletedCount, phase: 'Deleted. Creating new menu…' });
        // After wipe, existingCats is stale — force empty catMap
        existingCats.length = 0;
      }

      // ── Build category map ─────────────────────────────────────────
      const catMap = new Map();
      existingCats.forEach(c => catMap.set(c.name.toLowerCase().trim(), c.id));

      if (createCategories) {
        const neededCats = new Set(
          parsedItems.filter(i => i._include !== false).map(i => (i.category || 'Other').trim())
        );
        for (const catName of neededCats) {
          if (!catMap.has(catName.toLowerCase())) {
            const id = await createMenuCategory({
              name: catName,
              order: (importMode === 'replace' ? 0 : existingCats.length) + categoriesCreated + 1,
              color: '#ff7a45',
              active: true
            });
            catMap.set(catName.toLowerCase(), id);
            categoriesCreated++;
          }
        }
      }

      // ── Create items ──────────────────────────────────────────────
      for (const item of parsedItems) {
        if (!item._include) continue;
        const catName = (item.category || 'Other').trim();
        const categoryId = catMap.get(catName.toLowerCase());
        if (!categoryId) continue;
        await createMenuItem({
          name: item.name.trim(),
          categoryId,
          price: parseFloat(item.price) || 0,
          station: item.station || 'kitchen',
          description: item.description || '',
          active: true,
          modifierGroupIds: []
        });
        itemsCreated++;
      }

      setImported({ items: itemsCreated, categories: categoriesCreated, deleted: deletedCount });
      setStep('done');
      onDone?.();
    } catch (e) {
      setError('Import failed: ' + (e.message || e));
    } finally {
      setImporting(false);
      setDeleteProgress(null);
    }
  };

  const toggleInclude = (i) => {
    setParsedItems(items => items.map((it, j) => j === i ? { ...it, _include: !it._include } : it));
  };

  const updateItem = (i, field, value) => {
    setParsedItems(items => items.map((it, j) => j === i ? { ...it, [field]: value } : it));
  };

  const removeItem = (i) => {
    setParsedItems(items => items.filter((_, j) => j !== i));
  };

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="importer">
      {/* Stepper */}
      <div className="importer-stepper">
        {['Source', 'Review', 'Done'].map((label, i) => {
          const active = (step === 'source' && i === 0) || (step === 'review' && i === 1) || (step === 'done' && i === 2);
          const done = (i === 0 && step !== 'source') || (i === 1 && step === 'done');
          return (
            <div key={i} className={`importer-step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
              <div className="dot">{done ? '✓' : i + 1}</div>
              <span>{label}</span>
            </div>
          );
        })}
      </div>

      {error && <div className="importer-error">⚠ {error}</div>}

      {/* Step 1: source */}
      {step === 'source' && (
        <SourceStep
          sourceType={sourceType}
          setSourceType={setSourceType}
          onProcess={handleSourceProcess}
          parsing={parsing}
        />
      )}

      {/* Step 2: review */}
      {step === 'review' && (
        <ReviewStep
          items={parsedItems}
          existingCats={existingCats}
          importMode={importMode}
          setImportMode={setImportMode}
          createCategories={createCategories}
          setCreateCategories={setCreateCategories}
          onToggleInclude={toggleInclude}
          onUpdate={updateItem}
          onRemove={removeItem}
          onBack={() => setStep('source')}
          onImport={handleImport}
          importing={importing}
          deleteProgress={deleteProgress}
        />
      )}

      {/* Step 3: done */}
      {step === 'done' && (
        <div className="importer-done">
          <div style={{ fontSize: 56 }}>🎉</div>
          <h2>Menu {importMode === 'replace' ? 'replaced' : 'imported'}</h2>
          {importMode === 'replace' && imported.deleted > 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 13 }}>
              Removed <b style={{ color: 'var(--red)' }}>{imported.deleted}</b> old items &amp; categories.
            </p>
          )}
          <p>
            Added <b style={{ color: 'var(--green)' }}>{imported.items}</b> items
            and <b style={{ color: 'var(--green)' }}>{imported.categories}</b> categories
            to your venue.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button className="btn" onClick={() => {
              setStep('source');
              setSourceType(null);
              setParsedItems([]);
              setRawText('');
              setImported({ items: 0, categories: 0, deleted: 0 });
              setImportMode('append');
            }}>Import another</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Step 1: source picker
// ───────────────────────────────────────────────────────────────────────
function SourceStep({ sourceType, setSourceType, onProcess, parsing }) {
  const [pastedText, setPastedText] = useState('');
  const fileRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    if (sourceType === 'excel') {
      onProcess(await file.arrayBuffer());
    } else if (sourceType === 'word') {
      onProcess(await file.arrayBuffer());
    } else if (sourceType === 'pdf-text') {
      onProcess(await file.arrayBuffer());
    } else if (sourceType === 'image') {
      const b64 = await fileToBase64(file);
      onProcess({ data: b64, mediaType: file.type });
    }
  };

  return (
    <div>
      <h2>Where's the menu coming from?</h2>
      <p style={{ color: 'var(--text-3)', marginBottom: 20, fontSize: 14 }}>
        Pick a source. Different formats use different parsers — Excel maps columns directly,
        text and images go through an AI parser that figures out the structure.
      </p>

      <div className="importer-sources">
        {SOURCE_TYPES.map(s => (
          <button
            key={s.id}
            className={`importer-source-card ${sourceType === s.id ? 'picked' : ''}`}
            onClick={() => setSourceType(s.id)}
          >
            <div className="icon">{s.icon}</div>
            <div className="title">{s.title}</div>
            <div className="blurb">{s.blurb}</div>
          </button>
        ))}
      </div>

      {/* Source-specific UI */}
      {sourceType === 'preset' && (
        <div style={{ marginTop: 20 }}>
          <div style={{
            background: 'var(--bg-2)', padding: 16, borderRadius: 8,
            border: '1px solid var(--border)', marginBottom: 12,
            fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6
          }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
              <div><b style={{ color: 'var(--brand)', fontSize: 22 }}>127</b> <span style={{ color: 'var(--text-3)' }}>items</span></div>
              <div><b style={{ color: 'var(--brand)', fontSize: 22 }}>22</b> <span style={{ color: 'var(--text-3)' }}>categories</span></div>
            </div>
            Pre-loaded menu from the SNS East Victoria Park printed menu. Includes:
            Veg/Non-Veg Starters, SNS Specials (Kizhi Parotta, Paal Parotta, Nalli Fry, Kari Dosa,
            Kothu Parotta, Neer Dosa, Meen Polichathu), Idli, Dosai, Poori & Batura, Biriyani, Rice,
            Indian Breads, Veg / Chicken / Mutton / Lamb / Beef Curries, Fish & Prawns, Egg, Idiappam,
            Fried Rice & Noodles, Saapadu, Desserts, Beverages, Accompaniments.
          </div>
          <button
            className="btn btn-primary btn-lg btn-block"
            disabled={parsing}
            onClick={() => onProcess(null)}
          >
            {parsing ? 'Loading…' : `⚡ Load Sizzle N Sambar menu`}
          </button>
        </div>
      )}

      {sourceType === 'paste' && (
        <div style={{ marginTop: 20 }}>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 8, color: 'var(--text-2)' }}>
            Paste your menu text below — line per item is best, but free-form works too
          </label>
          <textarea
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            placeholder="STARTERS&#10;Samosa - $8&#10;Onion Bhaji - $7&#10;&#10;MAINS&#10;Butter Chicken - $22&#10;Lamb Korma - $24"
            style={{ minHeight: 240, fontFamily: 'var(--font-mono)', fontSize: 14 }}
          />
          <button
            className="btn btn-primary btn-lg btn-block"
            style={{ marginTop: 12 }}
            disabled={!pastedText.trim() || parsing}
            onClick={() => onProcess(pastedText)}
          >
            {parsing ? 'Parsing with AI…' : '✨ Parse with AI'}
          </button>
        </div>
      )}

      {(sourceType === 'excel' || sourceType === 'word' || sourceType === 'pdf-text' || sourceType === 'image') && (
        <div style={{ marginTop: 20 }}>
          <input
            ref={fileRef}
            type="file"
            accept={
              sourceType === 'excel' ? '.xlsx,.xls,.csv' :
              sourceType === 'word'  ? '.docx' :
              sourceType === 'pdf-text' ? '.pdf' :
              'image/*'
            }
            onChange={e => handleFile(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-primary btn-lg btn-block"
            disabled={parsing}
            onClick={() => fileRef.current?.click()}
          >
            {parsing
              ? `${sourceType === 'image' ? 'Reading image with AI' : 'Parsing'}…`
              : `📤 Choose ${sourceType === 'image' ? 'image' : 'file'} to upload`
            }
          </button>
          {sourceType === 'excel' && (
            <div style={{ background: 'var(--bg-2)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.6 }}>
              <b style={{ color: 'var(--text-2)' }}>Expected columns:</b> name, category, price (description and station optional).
              The first row should be headers. Empty rows are skipped.
            </div>
          )}
          {sourceType === 'image' && (
            <div style={{ background: 'var(--bg-2)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.6 }}>
              Works with handwritten menus, photos of printed menus, screenshots. The clearer the image, the better the result.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Step 2: review & edit before commit
// ───────────────────────────────────────────────────────────────────────
function ReviewStep({ items, existingCats, importMode, setImportMode, createCategories, setCreateCategories, onToggleInclude, onUpdate, onRemove, onBack, onImport, importing, deleteProgress }) {
  const includedCount = items.filter(i => i._include !== false).length;
  const newCats = new Set();
  items.forEach(i => {
    if (i._include === false) return;
    const name = (i.category || 'Other').trim().toLowerCase();
    if (!existingCats.find(c => c.name.toLowerCase().trim() === name)) {
      newCats.add(i.category || 'Other');
    }
  });
  const hasExisting = existingCats.length > 0;

  return (
    <div>
      <h2>Review and edit</h2>
      <p style={{ color: 'var(--text-3)', marginBottom: 16, fontSize: 14 }}>
        Found <b style={{ color: 'var(--text)' }}>{items.length}</b> items.
        Untick anything you don't want. Edit inline. Then choose how to import.
      </p>

      {/* ── Replace vs Append toggle ─────────────────────────────── */}
      <div className="import-mode-toggle">
        <button
          className={`import-mode-btn ${importMode === 'append' ? 'active' : ''}`}
          onClick={() => setImportMode('append')}
        >
          <div className="import-mode-icon">➕</div>
          <div>
            <div className="import-mode-label">Add to existing menu</div>
            <div className="import-mode-sub">New items added alongside what's already there</div>
          </div>
        </button>
        <button
          className={`import-mode-btn ${importMode === 'replace' ? 'active replace' : ''}`}
          onClick={() => setImportMode('replace')}
        >
          <div className="import-mode-icon">🔄</div>
          <div>
            <div className="import-mode-label">Replace entire menu</div>
            <div className="import-mode-sub">
              {hasExisting
                ? `Deletes all ${existingCats.length} existing categories + items first`
                : 'Menu is currently empty — same as Add'}
            </div>
          </div>
        </button>
      </div>

      {/* Replace mode warning */}
      {importMode === 'replace' && hasExisting && (
        <div className="import-replace-warning">
          ⚠ <b>This will permanently delete {existingCats.length} categories and all items in them</b> before
          importing. This cannot be undone. Make sure you've reviewed the list below.
        </div>
      )}

      {/* Summary banner */}
      <div className="importer-summary">
        <div className="importer-summary-stat">
          <div className="label">Included</div>
          <div className="value" style={{ color: 'var(--green)' }}>{includedCount}</div>
        </div>
        <div className="importer-summary-stat">
          <div className="label">Excluded</div>
          <div className="value" style={{ color: 'var(--text-3)' }}>{items.length - includedCount}</div>
        </div>
        <div className="importer-summary-stat">
          <div className="label">New categories</div>
          <div className="value" style={{ color: 'var(--brand)' }}>{newCats.size}</div>
        </div>
      </div>

      {/* Auto-create categories toggle */}
      {newCats.size > 0 && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--bg-2)', padding: 12, borderRadius: 8,
          fontSize: 13, color: 'var(--text-2)', marginBottom: 16, cursor: 'pointer'
        }}>
          <input
            type="checkbox"
            checked={createCategories}
            onChange={e => setCreateCategories(e.target.checked)}
            style={{ width: 'auto', margin: 0 }}
          />
          Auto-create {newCats.size} new {newCats.size === 1 ? 'category' : 'categories'}: <b style={{ color: 'var(--brand)' }}>{[...newCats].join(', ')}</b>
        </label>
      )}

      {/* Items table */}
      <div className="importer-items">
        <div className="importer-items-head">
          <div></div>
          <div>Name</div>
          <div>Category</div>
          <div>Price</div>
          <div>Station</div>
          <div></div>
        </div>
        {items.map((it, i) => {
          const included = it._include !== false;
          return (
            <div key={i} className={`importer-item-row ${included ? '' : 'excluded'}`}>
              <label className="importer-include">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => onToggleInclude(i)}
                />
              </label>
              <input
                value={it.name}
                onChange={e => onUpdate(i, 'name', e.target.value)}
                disabled={!included}
              />
              <input
                value={it.category || ''}
                onChange={e => onUpdate(i, 'category', e.target.value)}
                disabled={!included}
                placeholder="Other"
              />
              <input
                type="number"
                step="0.01"
                value={it.price || ''}
                onChange={e => onUpdate(i, 'price', e.target.value)}
                disabled={!included}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <select
                value={it.station || 'kitchen'}
                onChange={e => onUpdate(i, 'station', e.target.value)}
                disabled={!included}
              >
                <option value="kitchen">kitchen</option>
                <option value="bar">bar</option>
              </select>
              <button
                className="icon-btn danger"
                onClick={() => onRemove(i)}
                title="Remove from list"
              >🗑</button>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="empty" style={{ padding: 32 }}>
            <p>Nothing parsed. Try a different source.</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="importer-actions">
        <button className="btn" onClick={onBack} disabled={importing}>← Back</button>
        <button
          className={`btn btn-lg ${importMode === 'replace' ? 'btn-danger' : 'btn-primary'}`}
          disabled={includedCount === 0 || importing}
          onClick={onImport}
        >
          {importing
            ? (deleteProgress
                ? deleteProgress.phase
                : `Importing ${includedCount} items…`)
            : importMode === 'replace'
              ? `🔄 Replace menu with ${includedCount} items`
              : `✓ Add ${includedCount} items`
          }
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Parsers
// ═══════════════════════════════════════════════════════════════════════

function parseExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows
    .map((r, i) => {
      // Lowercase keys
      const k = {};
      Object.entries(r).forEach(([key, val]) => {
        k[key.toLowerCase().trim()] = val;
      });
      const name = k.name || k.item || k['menu item'] || k.dish || '';
      const category = k.category || k.cat || k.section || k.tab || 'Other';
      const price = parseFloat(String(k.price || k.cost || '0').replace(/[^\d.]/g, ''));
      const station = (k.station || 'kitchen').toLowerCase();
      const description = k.description || k.notes || k.desc || '';
      if (!name) return null;
      return {
        name: String(name).trim(),
        category: String(category).trim(),
        price: isNaN(price) ? 0 : price,
        station: ['kitchen', 'bar'].includes(station) ? station : 'kitchen',
        description: String(description).trim(),
        _include: true
      };
    })
    .filter(Boolean);
}

async function parseWord(arrayBuffer) {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function parsePdfText(arrayBuffer) {
  // Load pdfjs via CDN at runtime (avoids bundling ~2MB)
  try {
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
        s.type = 'module';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Failed to load PDF parser'));
        document.head.appendChild(s);
      });
      // Fallback if module didn't expose
      if (!window.pdfjsLib) {
        const pdfjs = await import(/* @vite-ignore */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
        window.pdfjsLib = pdfjs;
      }
    }
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
    }
    return text;
  } catch (e) {
    throw new Error('PDF parsing not available — please copy the text and use Paste Text instead.');
  }
}

async function parseImageWithAI({ data, mediaType }) {
  const prompt = `You are a menu parser. Extract every menu item from this image.

OUTPUT FORMAT — your entire response must be a single valid JSON array with NO preamble, NO markdown fences, NO explanation. Just the array, starting with [ and ending with ].

For each item provide:
- name (string — the dish name only, no price)
- category (string — the section header, e.g. "Starters", "Mains", "Drinks", "Desserts")
- price (number — just the dollar amount, no currency symbol)
- station ("kitchen" or "bar" — bar for drinks/cocktails, kitchen for everything else)
- description (string — any descriptive text, or "" if none)

Example output:
[{"name":"Samosa","category":"Starters","price":8,"station":"kitchen","description":"Crispy pastry with spiced potato"},{"name":"Mango Lassi","category":"Drinks","price":6,"station":"bar","description":""}]

If you cannot read the menu, return: []`;

  const response = await callClaude({
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: prompt }
      ]
    }]
  });
  return extractItemsFromAIResponse(response);
}

async function parseWithAI(text) {
  const prompt = `You are a menu parser. Extract every menu item from this raw text.

OUTPUT FORMAT — your entire response must be a single valid JSON array with NO preamble, NO markdown fences, NO explanation. Just the array.

For each item provide:
- name (string — the dish name only)
- category (string — section header)
- price (number — dollar amount only)
- station ("kitchen" or "bar")
- description (string — or "")

Example output:
[{"name":"Samosa","category":"Starters","price":8,"station":"kitchen","description":""}]

If you cannot find any items, return: []

Menu text:
${text}`;

  const response = await callClaude({
    messages: [{ role: 'user', content: prompt }]
  });
  return extractItemsFromAIResponse(response);
}

// ── Anthropic API caller ────────────────────────────────────────────────────
// Production: set VITE_ANTHROPIC_KEY in Vercel → Project → Settings →
// Environment Variables. Vite bakes it into the bundle at deploy time.
// Local dev: add VITE_ANTHROPIC_KEY=sk-ant-... to a .env.local file.
async function callClaude({ messages, maxTokens = 16000 }) {
  const key = getAnthropicKey();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-api-key': key
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages
    })
  });
  if (!response.ok) {
    const err = await response.text();
    if (response.status === 401) {
      throw new Error('Anthropic API key rejected (401). Check VITE_ANTHROPIC_KEY in Vercel environment variables.');
    }
    throw new Error(`AI parser failed (HTTP ${response.status}): ${err.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.content?.[0]?.text || '';
}

function getAnthropicKey() {
  // 1. Build-time env var — set in Vercel Project → Settings → Environment Variables
  const envKey = import.meta.env.VITE_ANTHROPIC_KEY;
  if (envKey && envKey.trim().startsWith('sk-ant-')) return envKey.trim();

  // 2. Local dev fallback — .env.local file: VITE_ANTHROPIC_KEY=sk-ant-...
  //    (localStorage legacy also accepted so existing dev setups keep working)
  const localKey = localStorage.getItem('hospostack.anthropic_key');
  if (localKey && localKey.trim().startsWith('sk-ant-')) return localKey.trim();

  throw new Error(
    'No Anthropic API key found. ' +
    'Add VITE_ANTHROPIC_KEY to Vercel environment variables and redeploy.'
  );
}

function extractItemsFromAIResponse(text) {
  // Try multiple strategies in order. Don't give up on first failure.
  if (!text || !text.trim()) {
    throw new Error('AI returned an empty response. Check your API key has credit, or try a smaller portion of the menu.');
  }

  // Strategy 1: code fences
  let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '').trim();

  // Strategy 2: find first [ and last ]
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  // Strategy 3: try parsing as-is
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e1) {
    // Strategy 4: AI may have truncated the array — repair common issues
    // e.g. trailing comma, unterminated string, missing closing bracket
    try {
      // Drop everything after the last complete object
      const lastCompleteObj = cleaned.lastIndexOf('}');
      if (lastCompleteObj > 0) {
        const repaired = cleaned.slice(0, lastCompleteObj + 1) + ']';
        parsed = JSON.parse(repaired);
      } else {
        throw e1;
      }
    } catch (e2) {
      // Final fallback: show what AI actually returned
      const preview = text.slice(0, 200).replace(/\n/g, ' ');
      throw new Error(
        `AI response wasn't valid JSON. Got: "${preview}…"\n\n` +
        `Try: shorter input, clearer image, or use the Excel template instead.`
      );
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error('AI returned data but not as a list. Try a clearer source.');
  }
  if (parsed.length === 0) {
    throw new Error('AI couldn\'t find any menu items. The image might be unclear or the text too jumbled.');
  }

  return parsed.map(it => ({
    name: String(it.name || '').trim(),
    category: String(it.category || 'Other').trim(),
    price: parseFloat(it.price) || 0,
    station: ['kitchen', 'bar'].includes(it.station) ? it.station : 'kitchen',
    description: String(it.description || '').trim(),
    _include: true
  })).filter(it => it.name);
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('File read failed'));
    r.readAsDataURL(file);
  });
}
