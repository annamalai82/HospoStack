import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import {
  getVenueId, createMenuCategory, createMenuItem,
  watchCategories
} from '../lib/data';
import { useEffect } from 'react';

const STEPS = ['source', 'preview', 'review', 'done'];

const SOURCE_TYPES = [
  { id: 'paste',       icon: '📝', title: 'Paste text',        blurb: 'Paste a plain-text menu. The AI parser will detect items and prices.' },
  { id: 'excel',       icon: '📊', title: 'Excel / CSV',        blurb: 'Upload .xlsx, .xls or .csv. Expects columns: name, category, price.' },
  { id: 'word',        icon: '📄', title: 'Word document',      blurb: 'Upload a .docx file. Converted to text then parsed by AI.' },
  { id: 'pdf-text',    icon: '📑', title: 'PDF (text-based)',   blurb: 'Upload a PDF with selectable text.' },
  { id: 'image',       icon: '📸', title: 'Photo / image',      blurb: 'Snap or upload a handwritten or printed menu photo. AI will read it.' }
];

export default function MenuImporter({ onDone }) {
  const [step, setStep] = useState('source');
  const [sourceType, setSourceType] = useState(null);
  const [rawText, setRawText] = useState('');
  const [parsedItems, setParsedItems] = useState([]); // [{name, category, price, station, description}]
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [existingCats, setExistingCats] = useState([]);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState({ items: 0, categories: 0 });
  const [createCategories, setCreateCategories] = useState(true);

  useEffect(() => watchCategories(setExistingCats), []);

  // ─── Source step → handle each source type ──────────────────────────
  const handleSourceProcess = async (data) => {
    setError('');
    setParsing(true);
    try {
      if (sourceType === 'excel') {
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
    let categoriesCreated = 0;
    let itemsCreated = 0;
    try {
      // Build a map of category-name → id (existing first)
      const catMap = new Map();
      existingCats.forEach(c => catMap.set(c.name.toLowerCase().trim(), c.id));

      // Create missing categories if user opted in
      if (createCategories) {
        const neededCats = new Set(parsedItems.map(i => (i.category || 'Other').trim()));
        for (const catName of neededCats) {
          if (!catMap.has(catName.toLowerCase())) {
            const id = await createMenuCategory({
              name: catName,
              order: existingCats.length + categoriesCreated + 1,
              color: '#ff7a45',
              active: true
            });
            catMap.set(catName.toLowerCase(), id);
            categoriesCreated++;
          }
        }
      }

      // Create items
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
      setImported({ items: itemsCreated, categories: categoriesCreated });
      setStep('done');
      onDone?.();
    } catch (e) {
      setError('Import failed: ' + (e.message || e));
    } finally {
      setImporting(false);
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
          createCategories={createCategories}
          setCreateCategories={setCreateCategories}
          onToggleInclude={toggleInclude}
          onUpdate={updateItem}
          onRemove={removeItem}
          onBack={() => setStep('source')}
          onImport={handleImport}
          importing={importing}
        />
      )}

      {/* Step 3: done */}
      {step === 'done' && (
        <div className="importer-done">
          <div style={{ fontSize: 56 }}>🎉</div>
          <h2>Menu imported</h2>
          <p>
            Added <b style={{ color: 'var(--green)' }}>{imported.items}</b> menu items
            and <b style={{ color: 'var(--green)' }}>{imported.categories}</b> categories
            to your venue.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button className="btn" onClick={() => {
              setStep('source');
              setSourceType(null);
              setParsedItems([]);
              setRawText('');
              setImported({ items: 0, categories: 0 });
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
function ReviewStep({ items, existingCats, createCategories, setCreateCategories, onToggleInclude, onUpdate, onRemove, onBack, onImport, importing }) {
  const includedCount = items.filter(i => i._include !== false).length;
  const newCats = new Set();
  items.forEach(i => {
    if (i._include === false) return;
    const name = (i.category || 'Other').trim().toLowerCase();
    if (!existingCats.find(c => c.name.toLowerCase().trim() === name)) {
      newCats.add(i.category || 'Other');
    }
  });

  return (
    <div>
      <h2>Review and edit</h2>
      <p style={{ color: 'var(--text-3)', marginBottom: 16, fontSize: 14 }}>
        Found <b style={{ color: 'var(--text)' }}>{items.length}</b> items.
        Untick anything you don't want. Edit fields inline. Then import.
      </p>

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
                <option value="expo">expo</option>
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
          className="btn btn-primary btn-lg"
          disabled={includedCount === 0 || importing}
          onClick={onImport}
        >
          {importing ? 'Importing…' : `✓ Import ${includedCount} items`}
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
        station: ['kitchen', 'bar', 'expo'].includes(station) ? station : 'kitchen',
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
  // Use Claude vision API via the Anthropic /v1/messages endpoint
  const prompt = `This is an image of a restaurant menu. Extract every menu item you can see. For each item, identify:
- name (the dish name)
- category (the section/header it's under, e.g. "Starters", "Mains", "Desserts")
- price (in dollars, just the number)
- station (one of: kitchen, bar, expo — default kitchen unless it's clearly a drink which is bar)
- description (any descriptive text, or empty string)

Return ONLY a JSON array, no markdown, no explanation. Format:
[{"name":"Samosa","category":"Starters","price":8,"station":"kitchen","description":"Crispy pastry with spiced potato"}]

If you can't read the menu clearly, return an empty array [].`;

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
  const prompt = `Below is a restaurant menu in raw text form. Extract every menu item. For each item, identify:
- name
- category (the section header, e.g. "Starters", "Mains", "Drinks")
- price (number only, in dollars)
- station (one of: kitchen, bar, expo — default kitchen; bar for drinks)
- description (any text describing the item, or empty string)

Return ONLY a JSON array, no markdown, no explanation. Format:
[{"name":"Samosa","category":"Starters","price":8,"station":"kitchen","description":""}]

Menu text:
${text}`;

  const response = await callClaude({
    messages: [{ role: 'user', content: prompt }]
  });
  return extractItemsFromAIResponse(response);
}

// Use the Anthropic API directly (works in Claude artifacts and any environment
// where api.anthropic.com is accessible). The key is provided via env or
// localStorage for development. For production, route via a Cloud Function.
async function callClaude({ messages }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-api-key': getAnthropicKey()
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI parser failed: ${err.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.content?.[0]?.text || '';
}

function getAnthropicKey() {
  // Dev mode: read from localStorage. User pastes their own key once.
  const key = localStorage.getItem('hospostack.anthropic_key');
  if (!key) {
    const k = window.prompt(
      'AI parsing needs an Anthropic API key.\n\n' +
      'Get one at console.anthropic.com → API Keys.\n' +
      'It will be saved in this browser only.\n\n' +
      'Paste your key:'
    );
    if (!k) throw new Error('AI parsing cancelled');
    localStorage.setItem('hospostack.anthropic_key', k.trim());
    return k.trim();
  }
  return key;
}

function extractItemsFromAIResponse(text) {
  // Strip code fences if any
  let cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  // Find the JSON array
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error('AI did not return a parsable list. Try with clearer input.');
  }
  cleaned = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error('Not an array');
    return parsed.map(it => ({
      name: String(it.name || '').trim(),
      category: String(it.category || 'Other').trim(),
      price: parseFloat(it.price) || 0,
      station: ['kitchen', 'bar', 'expo'].includes(it.station) ? it.station : 'kitchen',
      description: String(it.description || '').trim(),
      _include: true
    })).filter(it => it.name);
  } catch (e) {
    throw new Error('Could not parse AI output as JSON');
  }
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error('File read failed'));
    r.readAsDataURL(file);
  });
}
