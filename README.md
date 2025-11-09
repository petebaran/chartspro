# CC Charts Pro - Capital.com Integration

A Figma plugin for generating professional financial charts using Capital.com API data.

## Features

- **Chart Types**: Candlestick and Line charts
- **Markets**: Stocks, Crypto, Forex, Indices, Commodities, ETFs
- **Intervals**: From 1-minute to weekly data
- **Customization**: Colors, grid, volume, transparency, stroke weight
- **Time Ranges**: Preset ranges (1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, All) and custom date ranges

## Migration from Yahoo Finance to Capital.com

This plugin has been migrated from Yahoo Finance API to Capital.com's official API for better reliability and data quality.

### Key Changes

1. **API Integration**: Now uses Capital.com REST API via a Cloudflare Worker proxy
2. **Intervals**: Updated to Capital.com's resolution format (MINUTE, MINUTE_5, MINUTE_15, MINUTE_30, HOUR, HOUR_4, DAY, WEEK)
3. **Instruments**: Updated symbols to Capital.com EPICs (e.g., `AAPL.US` for Apple stock, `EURUSD` for EUR/USD forex)
4. **Chart Types**: Added line chart support alongside candlestick charts

## Deployment

### 1. Configure Environment Variables

The worker requires Capital.com API credentials to be configured as Cloudflare Worker secrets.

**Important:** Never commit credentials to the repository. All sensitive data is managed through Wrangler secrets.

```bash
# Set required secrets (you'll be prompted to enter the values)
wrangler secret put CAPITAL_API_KEY
wrangler secret put CAPITAL_IDENTIFIER
wrangler secret put CAPITAL_PASSWORD
```

The `CAPITAL_API_BASE` URL is configured in `wrangler.toml` and can be changed between demo and live API:
- Demo: `https://demo-api-capital.backend-capital.com`
- Live: `https://api-capital.backend-capital.com`

### 2. Deploy the Cloudflare Worker Proxy

The proxy handles authentication and CORS for the Capital.com API.

```bash
# Install Wrangler CLI if you haven't already
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy the worker (after setting secrets)
wrangler deploy
```

The worker will be deployed to: `https://capitalcom-charts-proxy.petebaran.workers.dev`

### 3. Update Plugin in Figma

1. Open Figma Desktop App
2. Go to **Plugins** > **Development** > **Import plugin from manifest...**
3. Select the `manifest.json` file from this directory
4. The plugin is now ready to use!

## Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌──────────────┐
│   Figma     │─────▶│  Cloudflare      │─────▶│ Capital.com  │
│   Plugin    │      │  Worker Proxy    │      │     API      │
│  (ui.html)  │◀─────│  (worker.js)     │◀─────│              │
└─────────────┘      └──────────────────┘      └──────────────┘
       │
       │ Generate Vector Chart
       ▼
┌─────────────┐
│   Figma     │
│   Canvas    │
│  (code.js)  │
└─────────────┘
```

### Components

1. **ui.html**: Plugin UI with chart preview, instrument selection, and customization options
2. **code.js**: Figma plugin backend that generates vector charts from data
3. **worker.js**: Cloudflare Worker that proxies requests to Capital.com API
4. **manifest.json**: Figma plugin configuration

## Capital.com API Integration

### Session Management

The worker automatically:
- Creates and manages Capital.com API sessions
- Caches sessions for 9 minutes (sessions are valid for 10 minutes)
- Refreshes sessions automatically when needed

### Data Format Conversion

The worker converts Capital.com's data format to match the previous Yahoo Finance format, ensuring compatibility with existing chart rendering code.

### Supported Markets

- **Stocks**: US equities (e.g., AAPL.US, MSFT.US)
- **Crypto**: Major cryptocurrencies (e.g., BITCOIN, ETHEREUM)
- **Forex**: Major currency pairs (e.g., EURUSD, GBPUSD)
- **Indices**: Global indices (e.g., US500, UK100, GERMANY40)
- **Commodities**: Precious metals, energy, agriculture (e.g., GOLD, OIL_CRUDE, WHEAT)
- **ETFs**: Popular ETFs (e.g., SPY.US, QQQ.US)

## Usage

1. **Select Market**: Choose category (Stocks, Crypto, Forex, etc.)
2. **Search Instrument**: Type to search for specific instruments
3. **Choose Chart Type**: Select Candlestick or Line chart
4. **Select Interval**: Choose data resolution (1min to 1week)
5. **Select Timeframe**: Pick preset range or use custom dates
6. **Customize**: Adjust colors, grid, size, etc.
7. **Generate**: Click "Generate Vector Chart" to create in Figma

## Development

### Project Structure

```
chartspro/
├── code.js              # Figma plugin backend
├── ui.html              # Plugin UI and preview
├── worker.js            # Cloudflare Worker proxy
├── wrangler.toml        # Worker configuration
├── manifest.json        # Figma plugin manifest
└── README.md           # This file
```

### Local Development

To test the worker locally:

1. **Set up local environment** (optional for local dev):
   ```bash
   # Create a .env file from the example
   cp .env.example .env
   # Edit .env and add your Capital.com credentials
   ```

2. **Start local development server**:
   ```bash
   wrangler dev
   ```

   This will start a local server at `http://localhost:8787`

   **Note:** For local development, you'll still need to have the secrets set via `wrangler secret put` or use the `.dev.vars` file (see [Cloudflare documentation](https://developers.cloudflare.com/workers/configuration/secrets/#secrets-in-development))

3. **Update the API URL in `ui.html` for testing**:
   ```javascript
   const url = 'http://localhost:8787/chart?epic=' + symbol + '&resolution=' + interval + ...
   ```

## Troubleshooting

### Common Issues

1. **"Error loading chart data"**
   - Check that the Cloudflare Worker is deployed and accessible
   - Verify the instrument EPIC is correct for Capital.com
   - Check browser console for detailed error messages

2. **Empty chart**
   - Some instruments may not have data for all time ranges
   - Try a different timeframe or interval
   - Check that the interval is appropriate for the timeframe (e.g., 1-minute data for 1-day range)

3. **Network Access Error in Figma**
   - Ensure `manifest.json` has the correct worker URL in `networkAccess.allowedDomains`
   - Reload the plugin after updating the manifest

### API Rate Limits

Capital.com API has a rate limit of 10 requests/second. The plugin is designed for typical usage patterns but avoid rapid-fire requests.

## Future Enhancements

- [ ] Add more technical indicators (MA, EMA, Bollinger Bands)
- [ ] Support for multiple timeframes in one chart
- [ ] Export charts as PNG/SVG
- [ ] Save favorite instruments
- [ ] Real-time data updates via WebSocket

## License

Internal use only within the organization.
