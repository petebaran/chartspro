// Capital.com API Proxy for CC Charts Pro Figma Plugin
// Handles session management and proxies requests to Capital.com API

// Using DEMO API - switch to live API when ready
const CAPITAL_API_BASE = 'https://demo-api-capital.backend-capital.com';
const API_KEY = 'sP6oTAnyrvt6lHjl';
const IDENTIFIER = 'petebaran@proton.me'; // Your Capital.com login email - UPDATE THIS!
const PASSWORD = 'wtp7fhz2epd@RWY.qzm';

// Session cache with timestamp
let sessionCache = {
  token: null,
  cst: null,
  securityToken: null,
  expiresAt: 0
};

const RESOLUTION_FALLBACKS = {
  'MINUTE': ['MINUTE_5', 'MINUTE_15', 'MINUTE_30', 'HOUR', 'HOUR_4', 'DAY', 'WEEK'],
  'MINUTE_5': ['MINUTE_15', 'MINUTE_30', 'HOUR', 'HOUR_4', 'DAY', 'WEEK'],
  'MINUTE_15': ['MINUTE_30', 'HOUR', 'HOUR_4', 'DAY', 'WEEK'],
  'MINUTE_30': ['HOUR', 'HOUR_4', 'DAY', 'WEEK'],
  'HOUR': ['HOUR_4', 'DAY', 'WEEK'],
  'HOUR_4': ['DAY', 'WEEK'],
  'DAY': ['WEEK'],
  'WEEK': []
};

const DEFAULT_FALLBACK_CHAIN = ['DAY', 'WEEK'];

async function createSession() {
  try {
    // Create session with simple password authentication
    const sessionResponse = await fetch(`${CAPITAL_API_BASE}/api/v1/session`, {
      method: 'POST',
      headers: {
        'X-CAP-API-KEY': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        identifier: IDENTIFIER,
        password: PASSWORD,
        encryptedPassword: false
      })
    });

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      throw new Error(`Session creation failed: ${sessionResponse.status} - ${errorText}`);
    }

    // Extract security headers
    const cst = sessionResponse.headers.get('CST');
    const securityToken = sessionResponse.headers.get('X-SECURITY-TOKEN');

    if (!cst || !securityToken) {
      throw new Error('Missing security tokens in session response');
    }

    // Cache session (valid for 10 minutes, we'll refresh after 9)
    sessionCache = {
      cst,
      securityToken,
      expiresAt: Date.now() + (9 * 60 * 1000) // 9 minutes
    };

    return sessionCache;
  } catch (error) {
    console.error('Session creation error:', error);
    throw error;
  }
}

async function getValidSession() {
  // Check if we have a valid cached session
  if (sessionCache.cst && sessionCache.expiresAt > Date.now()) {
    return sessionCache;
  }

  // Create new session
  return await createSession();
}

function buildPricesUrl(epic, resolution, from, to) {
  const url = new URL(`${CAPITAL_API_BASE}/api/v1/prices/${encodeURIComponent(epic)}`);
  url.searchParams.append('resolution', resolution);

  if (from) {
    const cleanFrom = from.replace(/\.\d{3}Z$/, '');
    url.searchParams.append('from', cleanFrom);
  }
  if (to) {
    const cleanTo = to.replace(/\.\d{3}Z$/, '');
    url.searchParams.append('to', cleanTo);
  }

  url.searchParams.append('max', '1000');
  return url;
}

function normalizeString(value) {
  return value ? value.replace(/[^a-z0-9]/gi, '').toLowerCase() : '';
}

function summarizeErrorText(text) {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      if (parsed.errorCode) return String(parsed.errorCode);
      if (parsed.message) return String(parsed.message);
      return JSON.stringify(parsed).slice(0, 180);
    }
  } catch (err) {
    // Ignore JSON parse errors and fall back to the raw text
  }
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function getFallbackResolutions(resolution) {
  if (RESOLUTION_FALLBACKS[resolution]) {
    return RESOLUTION_FALLBACKS[resolution];
  }
  return DEFAULT_FALLBACK_CHAIN;
}

function shouldAttemptFallback(status, errorText) {
  if (status === 401 || status === 403) return false;
  if (status >= 500) return false;
  if (status === 404 || status === 422) return true;
  if (status === 400) {
    if (!errorText) return true;
    const lower = errorText.toLowerCase();
    const triggerPhrases = [
      'no price data',
      'no data available',
      'validation.max',
      'validation.min',
      'not available for the requested resolution'
    ];
    return triggerPhrases.some(phrase => lower.includes(phrase));
  }
  return false;
}

async function executePriceRequest(epic, resolution, from, to, session) {
  const url = buildPricesUrl(epic, resolution, from, to);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-CAP-API-KEY': API_KEY,
      'CST': session.cst,
      'X-SECURITY-TOKEN': session.securityToken,
      'Content-Type': 'application/json'
    }
  });

  let errorText = '';
  if (!response.ok) {
    try {
      errorText = await response.text();
    } catch (err) {
      errorText = '';
    }
  }

  return { response, errorText };
}

async function resolveEpicCandidate(searchTerm, session) {
  try {
    // Try multiple search terms for better matching
    const searchTerms = [
      searchTerm,
      searchTerm.replace(/[^a-zA-Z0-9]/g, ''), // Remove special characters
      searchTerm.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(), // Lowercase version
    ];

    // Add common variations for VIX
    if (searchTerm.toUpperCase().includes('VIX') || searchTerm.toUpperCase().includes('VOLATILITY')) {
      searchTerms.push('VIX', 'VIX.XO', 'VOLATILITY', 'CBOE VIX');
    }

    for (const term of searchTerms) {
      if (!term) continue;
      
      const searchResult = await searchMarkets(term, session);
      if (!searchResult) continue;

      const markets = Array.isArray(searchResult.markets) ? searchResult.markets : [];
      if (!markets.length) continue;

      const lowerSearch = term.toLowerCase();
      const normalizedSearch = normalizeString(term);

      const byEpic = markets.find(market => market.epic && market.epic.toLowerCase() === lowerSearch);
      if (byEpic) return byEpic.epic;

      const byNormalizedEpic = markets.find(market => normalizeString(market.epic) === normalizedSearch);
      if (byNormalizedEpic) return byNormalizedEpic.epic;

      const byMarketId = markets.find(market => normalizeString(market.marketId) === normalizedSearch);
      if (byMarketId) return byMarketId.epic;

      const byInstrumentName = markets.find(market => normalizeString(market.instrumentName) === normalizedSearch);
      if (byInstrumentName) return byInstrumentName.epic;

      const partialNameMatch = markets.find(market =>
        market.instrumentName && market.instrumentName.toLowerCase().includes(lowerSearch)
      );
      if (partialNameMatch) return partialNameMatch.epic;

      // If we found markets but no exact match, return the first one
      if (markets.length > 0) return markets[0].epic;
    }

    return null;
  } catch (error) {
    console.warn('Failed to resolve epic via searchMarkets:', error);
    return null;
  }
}

async function fetchMarketData(epic, resolution, from, to) {
  const session = await getValidSession();
  const attemptedResolutions = new Set();
  const attemptedEpics = new Set();

  async function fetchWithFallback(currentEpic, currentResolution) {
    const { response, errorText } = await executePriceRequest(currentEpic, currentResolution, from, to, session);

    if (response.ok) {
      const json = await response.json();
      return {
        data: json,
        usedResolution: currentResolution,
        usedEpic: currentEpic,
        requestedEpic: epic
      };
    }

    const status = response.status;
    const canFallback = shouldAttemptFallback(status, errorText);

    if (canFallback) {
      attemptedResolutions.add(currentResolution);
      const fallbacks = getFallbackResolutions(currentResolution);
      for (const fallback of fallbacks) {
        if (attemptedResolutions.has(fallback)) {
          continue;
        }
        try {
          return await fetchWithFallback(currentEpic, fallback);
        } catch (fallbackError) {
          console.warn(`Fallback resolution ${fallback} failed for ${currentEpic}:`, fallbackError);
        }
      }
    }

    if ((status === 400 || status === 404) && !attemptedEpics.has(currentEpic)) {
      attemptedEpics.add(currentEpic);
      console.log(`Attempting to resolve epic for: ${currentEpic}`);
      const alternativeEpic = await resolveEpicCandidate(currentEpic, session);
      if (alternativeEpic && !attemptedEpics.has(alternativeEpic)) {
        console.log(`Found alternative epic: ${alternativeEpic} for ${currentEpic}`);
        attemptedResolutions.clear();
        return await fetchWithFallback(alternativeEpic, resolution);
      } else {
        console.log(`No alternative epic found for: ${currentEpic}`);
      }
    }

    const summary = summarizeErrorText(errorText);
    throw new Error(`Market data request failed (${status}) for ${currentEpic} @ ${currentResolution}${summary ? ` - ${summary}` : ''}`);
  }

  return await fetchWithFallback(epic, resolution);
}

async function searchMarkets(searchTerm, existingSession) {
  const session = existingSession || await getValidSession();

  const url = new URL(`${CAPITAL_API_BASE}/api/v1/markets`);
  if (searchTerm) {
    url.searchParams.append('searchTerm', searchTerm);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-CAP-API-KEY': API_KEY,
      'CST': session.cst,
      'X-SECURITY-TOKEN': session.securityToken,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Markets search failed: ${response.status}${errorText ? ` - ${errorText}` : ''}`);
  }

  return await response.json();
}

// Convert Capital.com data format to Yahoo Finance-compatible format
function convertToYahooFormat(capitalData, epic, resolution, requestedEpic) {
  const timestamps = [];
  const opens = [];
  const highs = [];
  const lows = [];
  const closes = [];
  const volumes = [];

  if (capitalData.prices) {
    capitalData.prices.forEach(price => {
      // Capital.com timestamp format: "2024-10-14T10:00:00"
      const timestamp = Math.floor(new Date(price.snapshotTime || price.snapshotTimeUTC).getTime() / 1000);
      timestamps.push(timestamp);
      opens.push(price.openPrice?.bid || price.openPrice?.ask || 0);
      highs.push(price.highPrice?.bid || price.highPrice?.ask || 0);
      lows.push(price.lowPrice?.bid || price.lowPrice?.ask || 0);
      closes.push(price.closePrice?.bid || price.closePrice?.ask || 0);
      volumes.push(price.lastTradedVolume || 0);
    });
  }

  return {
    chart: {
      result: [{
        meta: {
          symbol: epic,
          requestedSymbol: requestedEpic || epic,
          resolution: resolution || null,
          currency: 'USD',
          exchangeName: 'Capital.com'
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            open: opens,
            high: highs,
            low: lows,
            close: closes,
            volume: volumes
          }]
        }
      }]
    }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Main endpoint: /chart?epic=SYMBOL&resolution=DAY&from=timestamp&to=timestamp
      if (url.pathname === '/' || url.pathname === '/chart') {
        const epic = url.searchParams.get('epic') || url.searchParams.get('symbol');
        const resolution = url.searchParams.get('resolution') || 'DAY';
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');

        if (!epic) {
          return new Response(JSON.stringify({ error: 'Missing epic/symbol parameter' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const marketData = await fetchMarketData(epic, resolution, from, to);
        const yahooFormat = convertToYahooFormat(
          marketData.data,
          marketData.usedEpic,
          marketData.usedResolution,
          marketData.requestedEpic
        );

        return new Response(JSON.stringify(yahooFormat), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Search endpoint: /search?term=AAPL
      if (url.pathname === '/search') {
        const term = url.searchParams.get('term');
        const markets = await searchMarkets(term);

        return new Response(JSON.stringify(markets), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: error.message,
        details: error.stack
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
