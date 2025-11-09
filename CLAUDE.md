# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CC Charts Pro is a Figma plugin that generates professional financial charts using Capital.com API data. The plugin creates vector charts directly in Figma with support for candlestick and line charts across multiple markets (Stocks, Crypto, Forex, Indices, Commodities, ETFs).

## Architecture

The plugin consists of three main components:

1. **ui.html** - Plugin UI with live chart preview using HTML5 Canvas
2. **code.js** - Figma plugin backend that generates vector charts in Figma
3. **worker.js** - Cloudflare Worker proxy that handles Capital.com API authentication and data transformation

### Data Flow
```
Figma Plugin (ui.html) → Cloudflare Worker (worker.js) → Capital.com API
                       ← Yahoo Finance-compatible format ←

Figma Plugin (code.js) ← Chart generation request ← UI
                       → Vector chart in Figma →
```

## Development Commands

### Cloudflare Worker Development

**Initial Setup:**
```bash
# Login to Cloudflare (required once)
wrangler login

# Set required secrets for production
wrangler secret put CAPITAL_API_KEY
wrangler secret put CAPITAL_IDENTIFIER
wrangler secret put CAPITAL_PASSWORD
```

**For local development**, create a `.dev.vars` file (not tracked in git):
```bash
CAPITAL_API_KEY=your_api_key_here
CAPITAL_IDENTIFIER=your_email@example.com
CAPITAL_PASSWORD=your_password_here
```

**Development and Deployment:**
```bash
# Test worker locally (uses .dev.vars for secrets)
wrangler dev

# Deploy worker to production (uses wrangler secrets)
wrangler deploy
```

### Figma Plugin Development
1. Open Figma Desktop App
2. Go to **Plugins** > **Development** > **Import plugin from manifest...**
3. Select `manifest.json` from this directory
4. Make changes to `code.js` or `ui.html`
5. Reload plugin in Figma to see changes

**Note:** When testing locally, update the API URL in `ui.html` line 1486 and 1526 to `http://localhost:8787` when running `wrangler dev`.

## Capital.com API Integration

### Session Management (worker.js)
- Sessions are created using API key + email/password authentication
- Sessions are valid for 10 minutes, cached for 9 minutes in memory
- Auto-refresh occurs when session expires
- Security headers: `CST` and `X-SECURITY-TOKEN`

### API Credentials
Credentials are managed securely through Cloudflare Worker environment variables:
- **Secrets** (set via `wrangler secret put`):
  - `CAPITAL_API_KEY` - Capital.com API key
  - `CAPITAL_IDENTIFIER` - Capital.com login email
  - `CAPITAL_PASSWORD` - Capital.com password
- **Environment Variables** (configured in wrangler.toml):
  - `CAPITAL_API_BASE` - API base URL (default: `https://demo-api-capital.backend-capital.com`)

**Important:** Never commit credentials to the repository. Use `.gitignore` to exclude `.env` and sensitive files.

**To switch to live API:** Update `CAPITAL_API_BASE` in `wrangler.toml` to `https://api-capital.backend-capital.com`

### Data Format Conversion
The worker converts Capital.com's response to Yahoo Finance-compatible format (worker.js:306-351) to maintain compatibility with existing chart rendering code. This includes:
- Timestamp conversion from ISO strings to Unix timestamps
- OHLC data extraction from bid/ask prices
- Volume data normalization

### Instrument Symbol Format
Capital.com uses EPICs (e.g., `AAPL` for stocks, `BTCUSD` for crypto, `EURUSD` for forex). The UI maintains comprehensive instrument lists in ui.html:541-889.

### Resolution/Interval Fallback System
The worker implements automatic fallback for unsupported resolutions (worker.js:18-145):
- If a resolution fails (400/404), tries fallback resolutions in order
- Example: MINUTE → MINUTE_5 → MINUTE_15 → MINUTE_30 → HOUR → HOUR_4 → DAY → WEEK
- Custom epic resolution via market search if symbol not found

## Chart Generation

### Two Chart Types
1. **Candlestick Charts** (code.js:10-467) - Shows OHLC data with wicks and bodies
2. **Line Charts** (code.js:469-791) - Shows close prices as a connected line

Both use the same layout system and support the same customization options.

### Chart Layout System
Both chart types use a **dynamic layout system** that:
1. Measures price label text widths first (temporary text nodes)
2. Calculates chart area width based on measured text
3. Positions elements with proper spacing (24px gaps, consistent padding)
4. Ensures price labels don't overlap with chart area

**Key Layout Variables** (code.js):
- `leftPadding: 24px` - Space from left edge
- `gapBetweenChartAndPrices: 24px` - Gap between chart and price labels
- `framePadding: 24px` - Right edge padding
- `topPadding: 40px` - Space for title
- `bottomPadding: 40px` - Space for date labels

### Vector Generation Details
- Uses Figma's vector API (lines, rectangles, vector paths)
- Layers: Background → Grid → Labels, Candles/Line, Volume (optional)
- Grid lines use `dashPattern` property for dashed appearance
- Current price indicator with tag at right edge
- Frame naming: `SYMBOL | INTERVAL | TIMEFRAME | SIZE | [Line]`

### Font Loading
Always load fonts before creating text nodes (code.js:12-13):
```javascript
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
await figma.loadFontAsync({ family: "Reddit Mono", style: "Regular" });
```

## UI Implementation Details

### Chart Preview (ui.html)
- Live preview using HTML5 Canvas (lines 944-1360)
- Renders both candlestick and line charts
- Updates immediately when changing colors, grids, or chart type
- Filters weekends for daily/weekly intervals (lines 919-922, 1550-1584)

### Timeframe-Interval Validation
The UI implements smart interval filtering based on timeframe (ui.html:1371-1466):
- 1D: 5min, 15min, 30min (default: 5min)
- 5D: 15min, 30min, 1h (default: 15min)
- 1M: 1h, 4h, 1d (default: 4h)
- 3M: 4h, 1d (default: 1d)
- 6M+: 4h, 1d, 1w (default: 1d)
- 5Y/All: 1w only

This prevents API errors by only showing validated interval combinations.

### Custom Date Range
Users can enable custom date ranges (ui.html:1746-1781):
- Checkbox to enable custom range mode
- Start/End date pickers
- Disables preset timeframe buttons when active
- Uses ISO date format for API calls

### Chart Type Tabs
Material Symbols icons used for chart type selection (ui.html:277-328):
- Candlestick: `candlestick_chart` icon
- Line: `show_chart` icon
- Active state shown with bottom border

### Instrument Search
- Comprehensive lists for all asset classes (ui.html:541-889)
- Real-time filtering by symbol or name
- Sorted alphabetically within each category

## Important Implementation Notes

### Weekend Filtering
For daily and weekly intervals, the code filters out weekend data in TWO places:
1. UI preview rendering (ui.html:919-922)
2. Data fetching (ui.html:1550-1584)

This prevents empty candlesticks on weekends when markets are closed.

### Color Format Conversion
Always convert hex colors to RGB (0-1 range) for Figma:
```javascript
function hexToRgb(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255
  };
}
```

### Price Formatting
Dynamic decimal places based on price magnitude (code.js:1085-1100):
- >= $1: 2 decimals
- >= $0.01: 3 decimals
- < $0.01: 6 decimals
- Comma separators for thousands

### Network Access
The plugin requires network access to the Cloudflare Worker. The allowed domain is configured in manifest.json:10-12:
```json
"networkAccess": {
  "allowedDomains": [
    "https://capitalcom-charts-proxy.petebaranescu.workers.dev"
  ]
}
```

After updating the manifest, reload the plugin in Figma.

## Common Development Tasks

### Adding New Instruments
Edit the `instruments` object in ui.html (lines 541-889). Each category follows this format:
```javascript
category: [
  { symbol: "EPIC", label: "Display Name (EPIC)" }
].sort((a, b) => a.label.localeCompare(b.label))
```

### Changing Chart Styling
- Grid colors: Search for `#eef2f7` or `#e2e8f0` in code.js and ui.html
- Default bull/bear colors: ui.html:507-512 and code.js:28-29
- Border radius, shadows: code.js:65-74, 507-516

### Modifying Layout Spacing
Update padding constants in both chart generation functions (candlestick and line):
- code.js lines 115-119 (candlestick)
- code.js lines 545-549 (line)
- ui.html lines 1014-1022 (preview candlestick)
- ui.html lines 1215-1219 (preview line)

### Debugging API Issues
1. Check browser console in Figma plugin
2. Enable Wrangler dev mode to see worker logs
3. Verify instrument EPIC is correct for Capital.com
4. Check if interval is supported for the timeframe
5. Review fallback resolution chain in worker logs

## Error Handling

### Worker Error Handling
- Session creation failures logged to console (worker.js:69)
- Automatic resolution fallback on 400/404 errors (worker.js:224-278)
- Epic resolution via market search if symbol not found (worker.js:170-222)
- Summarized error messages to avoid verbose responses (worker.js:105-118)

### Plugin Error Handling
- Try-catch blocks around chart generation (code.js:462-465)
- User notifications via `figma.notify()` (code.js:460, 790)
- Error display in UI preview (ui.html:1505-1507, 1590-1592)

## Plugin Metadata

- Plugin ID: `1558045983397062923`
- API Version: `1.0.0`
- Document Access: `dynamic-page`
- Supported Editor: Figma only
- Worker URL: `https://capitalcom-charts-proxy.petebaranescu.workers.dev`
