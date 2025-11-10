// Capital.com API Proxy for CC Charts Pro Figma Plugin
// Handles session management and proxies requests to Capital.com API

// Environment variables are configured in wrangler.toml and via wrangler secrets
// Non-sensitive: CAPITAL_API_BASE (from wrangler.toml [vars])
// Secrets: CAPITAL_API_KEY, CAPITAL_IDENTIFIER, CAPITAL_PASSWORD (set via wrangler secret put)

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

async function createSession(env) {
  try {
    // Create session with simple password authentication
    const sessionResponse = await fetch(`${env.CAPITAL_API_BASE}/api/v1/session`, {
      method: 'POST',
      headers: {
        'X-CAP-API-KEY': env.CAPITAL_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        identifier: env.CAPITAL_IDENTIFIER,
        password: env.CAPITAL_PASSWORD,
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

async function getValidSession(env) {
  // Check if we have a valid cached session
  if (sessionCache.cst && sessionCache.expiresAt > Date.now()) {
    return sessionCache;
  }

  // Create new session
  return await createSession(env);
}

function buildPricesUrl(env, epic, resolution, from, to) {
  const url = new URL(`${env.CAPITAL_API_BASE}/api/v1/prices/${encodeURIComponent(epic)}`);
  url.searchParams.append('resolution', resolution);

  // Clamp invalid/too-wide ranges for intraday intervals to last 1000 bars
  const barSeconds = getBarSeconds(resolution);
  const isIntraday = barSeconds > 0 && barSeconds < 86400; // under 1 day
  let fromAdj = from;
  let toAdj = to;

  try {
    const now = new Date();
    let toDate = toAdj ? new Date(toAdj) : now;
    if (isNaN(toDate.getTime())) toDate = now;
    if (toDate > now) toDate = now; // avoid future "to"

    if (fromAdj) {
      let fromDate = new Date(fromAdj);
      if (!isNaN(fromDate.getTime())) {
        if (fromDate > toDate) {
          // Swap or back off to max window
          fromDate = new Date(toDate.getTime() - (1000 * barSeconds * 1000));
        }
        if (isIntraday) {
          const maxWindowMs = 1000 * barSeconds * 1000; // 1000 bars
          const spanMs = toDate.getTime() - fromDate.getTime();
          if (spanMs > maxWindowMs) {
            fromDate = new Date(toDate.getTime() - maxWindowMs);
          }
          // Align to bar boundaries to avoid invalid.from/to
          fromDate = alignToBar(fromDate, barSeconds);
          toDate = alignToBar(toDate, barSeconds);
        } else {
          // For DAY/WEEK align to 00:00 UTC to be safe
          if (barSeconds >= 86400) {
            fromDate = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
            toDate = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()));
          }
        }
        // Ensure from < to by at least one bar
        if (fromDate.getTime() >= toDate.getTime()) {
          fromDate = new Date(toDate.getTime() - (barSeconds || 86400) * 1000);
        }
        fromAdj = formatCapitalDate(fromDate);
        toAdj = formatCapitalDate(toDate);
      } else {
        // Invalid from, drop it to let API infer window
        fromAdj = undefined;
      }
    } else if (!fromAdj && isIntraday && toAdj) {
      // If only "to" provided for intraday, set from to last 1000 bars
      const toDateOnly = new Date(toAdj);
      if (!isNaN(toDateOnly.getTime())) {
        let fromDateOnly = new Date(toDateOnly.getTime() - (1000 * barSeconds * 1000));
        // Align both to bar boundaries
        fromDateOnly = alignToBar(fromDateOnly, barSeconds);
        const toAligned = alignToBar(toDateOnly, barSeconds);
        if (fromDateOnly.getTime() >= toAligned.getTime()) {
          fromDateOnly = new Date(toAligned.getTime() - barSeconds * 1000);
        }
        fromAdj = formatCapitalDate(fromDateOnly);
        toAdj = formatCapitalDate(toAligned);
      }
    }
  } catch (e) {
    // Non-fatal: fall back to original values
  }

  if (fromAdj) {
    url.searchParams.append('from', fromAdj);
  }
  if (toAdj) {
    url.searchParams.append('to', toAdj);
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
      'not available for the requested resolution',
      'invalid.daterange',
      'invalid date range',
      'error.invalid.daterange',
      'error.invalid.from',
      'error.invalid.to'
    ];
    return triggerPhrases.some(phrase => lower.includes(phrase));
  }
  return false;
}

function getBarSeconds(resolution) {
  switch (resolution) {
    case 'MINUTE': return 60;
    case 'MINUTE_5': return 5 * 60;
    case 'MINUTE_15': return 15 * 60;
    case 'MINUTE_30': return 30 * 60;
    case 'HOUR': return 60 * 60;
    case 'HOUR_4': return 4 * 60 * 60;
    case 'DAY': return 24 * 60 * 60;
    case 'WEEK': return 7 * 24 * 60 * 60;
    default: return 0;
  }
}

function alignToBar(dateObj, barSeconds) {
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime()) || !barSeconds) return dateObj;
  const ms = barSeconds * 1000;
  const floored = Math.floor(dateObj.getTime() / ms) * ms;
  return new Date(floored);
}

function formatCapitalDate(dateObj) {
  // Capital.com expects 'YYYY-MM-DDTHH:mm:ss' (UTC) without trailing 'Z'
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = dateObj.getUTCFullYear();
  const mm = pad(dateObj.getUTCMonth() + 1);
  const dd = pad(dateObj.getUTCDate());
  const hh = pad(dateObj.getUTCHours());
  const mi = pad(dateObj.getUTCMinutes());
  const ss = pad(dateObj.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

async function executePriceRequest(env, epic, resolution, from, to, session) {
  const url = buildPricesUrl(env, epic, resolution, from, to);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-CAP-API-KEY': env.CAPITAL_API_KEY,
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

async function resolveEpicCandidate(env, searchTerm, session) {
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

      const searchResult = await searchMarkets(env, term, session);
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

async function fetchMarketData(env, epic, resolution, from, to) {
  const session = await getValidSession(env);
  const attemptedResolutions = new Set();
  const attemptedEpics = new Set();

  async function fetchWithFallback(currentEpic, currentResolution) {
    const { response, errorText } = await executePriceRequest(env, currentEpic, currentResolution, from, to, session);

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
      const alternativeEpic = await resolveEpicCandidate(env, currentEpic, session);
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

async function searchMarkets(env, searchTerm, existingSession) {
  const session = existingSession || await getValidSession(env);

  const url = new URL(`${env.CAPITAL_API_BASE}/api/v1/markets`);
  if (searchTerm) {
    url.searchParams.append('searchTerm', searchTerm);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-CAP-API-KEY': env.CAPITAL_API_KEY,
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

        const marketData = await fetchMarketData(env, epic, resolution, from, to);
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
        const markets = await searchMarkets(env, term);

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
