(function (global) {
  'use strict';

  const BracketApp = (global.BracketApp = global.BracketApp || {});

  const CACHE_MAX = 150;
  const JIKAN_TIMEOUT_MS = 3500;
  const JIKAN_COOLDOWN_MS = 60000;
  const ANILIST_TIMEOUT_MS = 5000;
  const LOCAL_TIMEOUT_MS = 4500;

  const cache = new Map();
  let hasLocalProxy = null; // null = unknown, true/false after probe
  let localProbePromise = null;
  let jikanCooldownUntil = 0;
  let lastActiveProvider = 'mal';
  let statusListeners = [];

  function notifyStatus(provider) {
    lastActiveProvider = provider;
    statusListeners.forEach((fn) => {
      try {
        fn(provider);
      } catch (_) {}
    });
  }

  function onProviderChange(fn) {
    statusListeners.push(fn);
  }

  function formatMalName(rawName) {
    if (!rawName || typeof rawName !== 'string') return '';
    const trimmed = rawName.trim();
    const parts = trimmed.split(', ');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return `${parts[1].trim()} ${parts[0].trim()}`;
    }
    return trimmed;
  }

  function cleanImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (url.includes('questionmark_23') || url.includes('apple-touch-icon')) {
      return '';
    }
    return url;
  }

  function cacheSet(key, value) {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, value);
  }

  function fetchWithTimeout(url, options, timeoutMs, externalSignal) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timer);
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .catch((err) => {
        if (timedOut && !(externalSignal && externalSignal.aborted)) {
          const timeoutErr = new Error('Request timed out');
          timeoutErr.name = 'TimeoutError';
          throw timeoutErr;
        }
        throw err;
      })
      .finally(() => {
        clearTimeout(timer);
        if (externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort);
        }
      });
  }

  async function probeLocalProxy() {
    if (hasLocalProxy !== null) return hasLocalProxy;
    if (localProbePromise) return localProbePromise;

    if (
      typeof location === 'undefined' ||
      (location.protocol !== 'http:' && location.protocol !== 'https:')
    ) {
      hasLocalProxy = false;
      return false;
    }

    localProbePromise = fetchWithTimeout('/api/health', { method: 'GET' }, 1200)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        hasLocalProxy = Boolean(data && data.malProxy);
        if (hasLocalProxy) notifyStatus('mal');
        return hasLocalProxy;
      })
      .catch(() => {
        hasLocalProxy = false;
        return false;
      });

    return localProbePromise;
  }

  async function searchLocalMalProxy(query, signal) {
    const url = `/api/mal/characters?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, { method: 'GET' }, LOCAL_TIMEOUT_MS, signal);
    if (!res.ok) {
      throw new Error(`Local MAL proxy HTTP ${res.status}`);
    }
    const data = await res.json();
    const categories = Array.isArray(data.categories) ? data.categories : [];
    const charCat = categories.find((c) => c.type === 'character') || categories[0];
    const items = charCat && Array.isArray(charCat.items) ? charCat.items : [];

    const normalized = items.map((item) => {
      const payload = item.payload || {};
      const works = Array.isArray(payload.related_works) ? payload.related_works : [];
      return {
        id: `mal:${item.id}`,
        malId: item.id || null,
        name: formatMalName(item.name),
        image: cleanImageUrl(item.image_url),
        sourceTitle: works[0] || '',
        favorites: Number(payload.favorites) || 0,
        provider: 'mal',
      };
    });

    // Sort by MAL favorites descending so iconic characters appear first
    normalized.sort((a, b) => b.favorites - a.favorites);
    notifyStatus('mal');
    return { items: normalized.slice(0, 8), provider: 'mal' };
  }

  async function searchJikan(query, signal) {
    const params = new URLSearchParams({
      q: query,
      limit: '10',
      order_by: 'favorites',
      sort: 'desc',
    });
    const url = `https://api.jikan.moe/v4/characters?${params.toString()}`;
    const res = await fetchWithTimeout(url, { method: 'GET' }, JIKAN_TIMEOUT_MS, signal);

    if (res.status === 429) {
      throw new Error('Jikan rate limited (429)');
    }
    if (!res.ok) {
      throw new Error(`Jikan HTTP ${res.status}`);
    }

    const json = await res.json();
    const list = Array.isArray(json.data) ? json.data : [];

    const normalized = list.map((item) => {
      const jpg = item.images && item.images.jpg ? item.images.jpg.image_url : '';
      const webp = item.images && item.images.webp ? item.images.webp.image_url : '';
      const nicknames = Array.isArray(item.nicknames) ? item.nicknames : [];
      return {
        id: `mal:${item.mal_id}`,
        malId: item.mal_id || null,
        name: (item.name || '').trim(),
        image: cleanImageUrl(jpg || webp),
        sourceTitle: nicknames[0] || '',
        favorites: Number(item.favorites) || 0,
        provider: 'jikan',
      };
    });

    notifyStatus('jikan');
    return { items: normalized.slice(0, 8), provider: 'jikan' };
  }

  async function searchAniList(query, signal) {
    const gql = `
      query ($search: String) {
        Page(page: 1, perPage: 10) {
          characters(search: $search, sort: [FAVOURITES_DESC, SEARCH_MATCH]) {
            id
            name { full }
            image { large }
            favourites
            media(page: 1, perPage: 1, sort: [POPULARITY_DESC]) {
              nodes {
                idMal
                title { english romaji }
              }
            }
          }
        }
      }
    `;

    const res = await fetchWithTimeout(
      'https://graphql.anilist.co',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query: gql, variables: { search: query } }),
      },
      ANILIST_TIMEOUT_MS,
      signal
    );

    if (!res.ok) {
      throw new Error(`AniList HTTP ${res.status}`);
    }

    const json = await res.json();
    const list =
      json && json.data && json.data.Page && Array.isArray(json.data.Page.characters)
        ? json.data.Page.characters
        : [];

    const normalized = list.map((item) => {
      const node =
        item.media && Array.isArray(item.media.nodes) && item.media.nodes[0]
          ? item.media.nodes[0]
          : null;
      const title = node && node.title ? node.title.english || node.title.romaji || '' : '';
      return {
        id: `al:${item.id}`,
        malId: null,
        name: item.name && item.name.full ? item.name.full.trim() : '',
        image: cleanImageUrl(item.image && item.image.large ? item.image.large : ''),
        sourceTitle: title,
        favorites: Number(item.favourites) || 0,
        provider: 'anilist',
      };
    });

    normalized.sort((a, b) => b.favorites - a.favorites);
    notifyStatus('anilist');
    return { items: normalized.slice(0, 8), provider: 'anilist' };
  }

  async function searchCharacters(rawQuery, signal) {
    const query = (rawQuery || '').trim();
    if (!query) return { items: [], provider: lastActiveProvider };

    const cacheKey = query.toLowerCase();
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const localAvailable = await probeLocalProxy();

    // 1. Direct MAL via zero-dependency local proxy (when launched via launch.bat / server.py / server.mjs)
    if (localAvailable) {
      try {
        const result = await searchLocalMalProxy(query, signal);
        if (result.items.length > 0) {
          cacheSet(cacheKey, result);
          return result;
        }
      } catch (err) {
        if (signal && signal.aborted) throw err;
        // Fall through to browser-side providers
      }
    }

    // 2. Direct browser Jikan v4 (MyAnimeList) when not in cooldown
    if (Date.now() >= jikanCooldownUntil) {
      try {
        const result = await searchJikan(query, signal);
        cacheSet(cacheKey, result);
        return result;
      } catch (err) {
        if (signal && signal.aborted) throw err;
        // Enter brief cooldown so subsequent keystrokes stay snappy
        jikanCooldownUntil = Date.now() + JIKAN_COOLDOWN_MS;
      }
    }

    // 3. Automatic CORS-enabled fallback (AniList GraphQL)
    try {
      const result = await searchAniList(query, signal);
      cacheSet(cacheKey, result);
      return result;
    } catch (err) {
      if (signal && signal.aborted) throw err;
      return { items: [], provider: 'offline', error: 'Unable to reach character directory' };
    }
  }

  BracketApp.api = {
    searchCharacters,
    probeLocalProxy,
    onProviderChange,
    getActiveProvider: () => lastActiveProvider,
  };
})(window);
