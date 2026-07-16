import crypto from 'node:crypto';

const PUBLIC_JSON_GETS = new Set([
  '/api/connectors',
  '/api/agents',
  '/api/library',
  '/api/settings',
  '/api/pricing',
  '/api/models',
  '/api/accessories',
  '/api/habitats',
  '/api/proxy-image',
]);

const PUBLIC_POSTS = new Set([
  '/api/generate',
  '/api/canopy-helper/chat',
  '/api/keeper/chat',
  '/api/agents/add-suggestion',
  '/api/telemetry/event',
]);

export function isPublicApiRequest(method, pathname) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (method === 'GET') {
    return PUBLIC_JSON_GETS.has(normalized) || /^\/api\/updates\/[^/]+\/[^/]+$/.test(normalized);
  }
  return method === 'POST' && PUBLIC_POSTS.has(normalized);
}

export function constantTimeSecretEqual(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string' || !expected) return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createAdminAuthMiddleware(getAdminKey) {
  return (req, res, next) => {
    if (!req.path.startsWith('/api/') || isPublicApiRequest(req.method, req.path)) return next();
    const expected = getAdminKey();
    if (!expected) {
      return res.status(503).json({ error: 'Admin API is disabled until ADMIN_API_KEY is configured' });
    }
    const presented = req.get('x-admin-key');
    if (!constantTimeSecretEqual(presented, expected)) {
      return res.status(401).json({ error: 'Unauthorized: Admin access required' });
    }
    return next();
  };
}

export function createRateLimiter({ windowMs, max, keyPrefix = 'route' }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: 'Too many requests' });
    }
    return next();
  };
}

function boundedText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function sanitizeCanopyHelperRequest(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  // Older clients sent a `messages` array. Retain only the newest user text so
  // prior conversation turns never cross the control-plane boundary.
  const legacyLatest = Array.isArray(input.messages)
    ? [...input.messages].reverse().find(message => message?.role === 'user')?.content
    : undefined;
  const latestMessage = typeof input.message === 'string' ? input.message : legacyLatest;
  if (typeof latestMessage !== 'string' || !latestMessage.trim() || latestMessage.length > 4_000) {
    throw new Error('message must be 1-4000 characters');
  }

  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const boundedCount = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(10_000, Math.trunc(number))) : 0;
  };
  const safeContext = {
    runtime_ready: Boolean(context.runtime_ready),
    active_view: boundedText(context.active_view, 32),
    onboarding: {
      in_onboarding: Boolean(context.onboarding?.in_onboarding),
      draft_step: Number.isInteger(context.onboarding?.draft_step)
        ? Math.max(0, Math.min(100, context.onboarding.draft_step))
        : null,
    },
    usage: {
      agent_count: boundedCount(context.usage?.agent_count),
      errored_agents: boundedCount(context.usage?.errored_agents),
    },
    agents: Array.isArray(context.agents) ? context.agents.slice(0, 100).map(agent => ({
      name: boundedText(agent?.name, 200),
      status: boundedText(agent?.status, 32),
      paused: Boolean(agent?.paused),
      isolated: Boolean(agent?.isolated),
      model: boundedText(agent?.model, 120),
      integrations: Array.isArray(agent?.integrations)
        ? agent.integrations.slice(0, 50).map(value => boundedText(value, 64)).filter(Boolean)
        : [],
      slack_paired: Boolean(agent?.slack_paired),
    })) : [],
    provider_health: Array.isArray(context.provider_health)
      ? context.provider_health.slice(0, 10).map(provider => ({
          provider: boundedText(provider?.provider, 32),
          status: boundedText(provider?.status, 32),
          model: boundedText(provider?.model, 120),
        }))
      : [],
  };

  const continuity = input.continuity && typeof input.continuity === 'object' ? input.continuity : {};
  const safeContinuity = {
    topic: ['provider_setup', 'integration_setup', 'diagnostics', 'onboarding'].includes(continuity.topic)
      ? continuity.topic
      : undefined,
    target_agent: boundedText(continuity.target_agent, 200) || undefined,
    provider: ['openai', 'anthropic', 'gemini', 'xai'].includes(continuity.provider)
      ? continuity.provider
      : undefined,
  };

  return { message: latestMessage.trim(), context: safeContext, continuity: safeContinuity };
}

export function validateConnector(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('Connector must be an object');
  }
  const id = boundedText(candidate.id, 40).toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) throw new Error('Invalid connector id');
  const name = boundedText(candidate.name, 80);
  const subtitle = boundedText(candidate.subtitle, 240);
  const icon = boundedText(candidate.icon, 40).toLowerCase();
  if (!name || !subtitle || !/^[a-z0-9-]+$/.test(icon)) throw new Error('Invalid connector metadata');
  if (!['api_token', 'oauth', 'web_credential'].includes(candidate.type)) {
    throw new Error('Invalid connector type');
  }
  return {
    id,
    name,
    subtitle,
    icon,
    isGlobal: Boolean(candidate.isGlobal),
    isVisible: candidate.isVisible !== false,
    needsCompanion: Boolean(candidate.needsCompanion),
    type: candidate.type,
  };
}

export function validatePollinationsImageUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid image URL');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'image.pollinations.ai' ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new Error('Image host is not allowed');
  }
  return parsed.toString();
}

export function isAllowedMeshyAssetUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && (parsed.hostname === 'meshy.ai' || parsed.hostname.endsWith('.meshy.ai'));
  } catch {
    return false;
  }
}

export function sanitizePublicSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const settings = {
    readwiseEnabled: Boolean(value.readwiseEnabled),
    globalModel: boundedText(value.globalModel, 160),
    systemPrefix: typeof value.systemPrefix === 'string' ? value.systemPrefix.slice(0, 20_000) : '',
  };
  if (typeof value.userTemplate === 'string') settings.userTemplate = value.userTemplate.slice(0, 100_000);
  if (Array.isArray(value.agentTemplates)) {
    settings.agentTemplates = value.agentTemplates.slice(0, 50).flatMap(template => {
      if (!template || typeof template !== 'object') return [];
      const filename = boundedText(template.filename, 80);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(filename) || filename.includes('..')) return [];
      return [{ filename, content: typeof template.content === 'string' ? template.content.slice(0, 100_000) : '' }];
    });
  }
  return settings;
}

export function sanitizeTelemetryProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowedKeys = new Set([
    'step', 'step_name', 'profile_type', 'profileType', 'experience', 'result',
  ]);
  const clean = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowedKeys.has(key)) continue;
    if (typeof raw === 'boolean') clean[key] = raw;
    else if (typeof raw === 'number' && Number.isFinite(raw)) clean[key] = Math.max(-1_000_000, Math.min(1_000_000, raw));
    else if (typeof raw === 'string') clean[key] = raw.slice(0, 120);
  }
  return Object.keys(clean).length ? clean : null;
}

export function sanitizeTelemetryMetrics(tokensIn, tokensOut, costUsd) {
  const boundedInteger = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1_000_000_000, Math.trunc(number))) : 0;
  };
  const cost = Number(costUsd);
  return {
    tokensIn: boundedInteger(tokensIn),
    tokensOut: boundedInteger(tokensOut),
    costUsd: Number.isFinite(cost) ? Math.max(0, Math.min(1_000_000, cost)) : 0,
  };
}

export function validateReleasePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid release');
  const version = boundedText(payload.version, 64);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid release version');
  if (!payload.platforms || typeof payload.platforms !== 'object' || Array.isArray(payload.platforms)) {
    throw new Error('Invalid release platforms');
  }
  const platforms = {};
  for (const [target, artifact] of Object.entries(payload.platforms)) {
    if (!/^[a-z0-9_-]{3,64}$/.test(target) || !artifact || typeof artifact !== 'object') {
      throw new Error('Invalid release target');
    }
    if (
      typeof artifact.signature !== 'string' || artifact.signature.length < 32 || artifact.signature.length > 4096 ||
      typeof artifact.url !== 'string' || !/^\/releases\/[A-Za-z0-9._-]+$/.test(artifact.url)
    ) throw new Error('Invalid release artifact');
    platforms[target] = { signature: artifact.signature, url: artifact.url };
  }
  if (!Object.keys(platforms).length) throw new Error('At least one release platform is required');
  const pubDate = payload.pub_date ? new Date(payload.pub_date) : new Date();
  if (Number.isNaN(pubDate.getTime())) throw new Error('Invalid release date');
  return {
    version,
    notes: boundedText(payload.notes, 20_000),
    pub_date: pubDate.toISOString(),
    platforms,
  };
}
