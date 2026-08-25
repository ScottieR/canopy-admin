import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constantTimeSecretEqual,
  isAllowedMeshyAssetUrl,
  isPublicApiRequest,
  sanitizeCanopyBootstrapRequest,
  sanitizeCanopyHelperRequest,
  sanitizeCanopyVoicePreviewRequest,
  sanitizePublicSettings,
  sanitizeTelemetryProperties,
  sanitizeTelemetryMetrics,
  validateConnector,
  validatePollinationsImageUrl,
  validateReleasePayload,
} from './server-security.js';

test('admin auth has a narrow public surface', () => {
  assert.equal(isPublicApiRequest('GET', '/api/models'), true);
  assert.equal(isPublicApiRequest('GET', '/api/updates/darwin-aarch64/0.1.0'), true);
  assert.equal(isPublicApiRequest('POST', '/api/canopy-helper/bootstrap'), true);
  assert.equal(isPublicApiRequest('POST', '/api/canopy-helper/voice-preview'), true);
  assert.equal(isPublicApiRequest('POST', '/api/generate'), false);
  assert.equal(isPublicApiRequest('POST', '/api/keeper/chat'), false);
  assert.equal(isPublicApiRequest('POST', '/api/canopy-helper/chat'), false);
  assert.equal(isPublicApiRequest('POST', '/api/agents/add-suggestion'), false);
  assert.equal(isPublicApiRequest('POST', '/api/usage'), false);
  assert.equal(isPublicApiRequest('GET', '/api/stats'), false);
  assert.equal(isPublicApiRequest('GET', '/api/meshy-check/task'), false);
  assert.equal(isPublicApiRequest('POST', '/api/connectors'), false);

  // Web-hosted connection token capture — no admin key exists for the desktop
  // app or an anonymous /connect/:token visitor to present.
  assert.equal(isPublicApiRequest('GET', '/api/connections/pending'), true);
  assert.equal(isPublicApiRequest('POST', '/api/connections/pending'), true);
  assert.equal(
    isPublicApiRequest('POST', '/api/connections/complete/5a1e1e0a-0000-4000-8000-000000000000'),
    true,
  );
  assert.equal(isPublicApiRequest('DELETE', '/api/connections/pending'), false);
  assert.equal(isPublicApiRequest('GET', '/api/connections/complete/anything'), false);
  assert.equal(isPublicApiRequest('POST', '/api/connections/complete/'), false);
});

test('public Eddy bootstrap accepts onboarding state only and drops every extra field', () => {
  const sanitized = sanitizeCanopyBootstrapRequest({
    message: 'Help me design a research agent',
    messages: [{ role: 'user', content: 'private prior turn' }],
    context: {
      runtime_ready: true,
      active_view: 'architect',
      onboarding: { in_onboarding: true, draft_step: 2, private_draft: 'secret personality' },
      agents: [{ name: 'Patch', instructions: 'private SOUL.md' }],
      conversation_history: ['private history'],
      credentials: 'secret key',
      raw_logs: 'private logs',
    },
    continuity: { topic: 'diagnostics', target_agent: 'Patch' },
  });

  assert.deepEqual(sanitized, {
    message: 'Help me design a research agent',
    context: {
      runtime_ready: true,
      active_view: 'onboarding',
      onboarding: { in_onboarding: true, draft_step: 2 },
    },
    continuity: { topic: 'onboarding' },
  });
  const encoded = JSON.stringify(sanitized);
  for (const privateValue of [
    'private prior turn', 'secret personality', 'Patch', 'private SOUL.md',
    'private history', 'secret key', 'private logs', 'diagnostics',
  ]) assert.equal(encoded.includes(privateValue), false);
  assert.throws(() => sanitizeCanopyBootstrapRequest({
    message: 'hello',
    context: { onboarding: { in_onboarding: false } },
  }));
});

test('public onboarding voice preview accepts one short sample and strips extra fields', () => {
  const sanitized = sanitizeCanopyVoicePreviewRequest({
    text: 'I can keep your mornings clear and your inbox lighter.',
    voice: 'alloy',
    context: {
      active_view: 'architect',
      onboarding: { in_onboarding: true, draft_step: 2, privateDraft: 'secret' },
      agents: [{ name: 'Patch', instructions: 'private SOUL.md' }],
    },
    credentials: 'secret key',
  });

  assert.deepEqual(sanitized, {
    text: 'I can keep your mornings clear and your inbox lighter.',
    voice: 'alloy',
    context: {
      active_view: 'onboarding',
      onboarding: { in_onboarding: true, draft_step: 2 },
    },
  });
  const encoded = JSON.stringify(sanitized);
  for (const privateValue of ['Patch', 'private SOUL.md', 'secret', 'architect']) {
    assert.equal(encoded.includes(privateValue), false);
  }
  assert.throws(() => sanitizeCanopyVoicePreviewRequest({
    text: 'hello',
    voice: 'alloy',
    context: { onboarding: { in_onboarding: false } },
  }));
});

test('Canopy helper sends one user message and an allowlisted diagnostic snapshot only', () => {
  const sanitized = sanitizeCanopyHelperRequest({
    message: 'Why is Patch offline?',
    messages: [
      { role: 'user', content: 'old private turn' },
      { role: 'assistant', content: 'old assistant turn' },
    ],
    context: {
      runtime_ready: true,
      active_view: 'architect',
      raw_logs: 'secret log contents',
      conversation_history: [{ content: 'private history' }],
      agents: [{
        name: 'Patch', status: 'error', model: 'anthropic/claude', integrations: ['github'],
        permissions: ['host_control'], instructions: 'private SOUL.md',
      }],
      provider_health: [{ provider: 'anthropic', status: 'healthy', model: 'claude', detail: 'raw provider response' }],
    },
    continuity: { topic: 'diagnostics', target_agent: 'Patch', secret: 'not allowed' },
  });

  assert.equal(sanitized.message, 'Why is Patch offline?');
  assert.deepEqual(Object.keys(sanitized.context.agents[0]).sort(), [
    'integrations', 'isolated', 'model', 'name', 'paused', 'slack_paired', 'status',
  ]);
  const encoded = JSON.stringify(sanitized);
  for (const privateValue of [
    'old private turn', 'old assistant turn', 'secret log contents', 'private history',
    'host_control', 'private SOUL.md', 'raw provider response', 'not allowed',
  ]) assert.equal(encoded.includes(privateValue), false);
});

test('admin keys require an exact non-empty match', () => {
  assert.equal(constantTimeSecretEqual('correct', 'correct'), true);
  assert.equal(constantTimeSecretEqual('wrong', 'correct'), false);
  assert.equal(constantTimeSecretEqual('', ''), false);
  assert.equal(constantTimeSecretEqual(undefined, 'correct'), false);
});

test('LLM connector output cannot select paths or source-code identifiers', () => {
  assert.throws(() => validateConnector({ id: '../../owned', name: 'x', subtitle: 'x', icon: 'link', type: 'oauth' }));
  const connector = validateConnector({
    id: 'google-drive', name: 'Google Drive', subtitle: 'Read selected files', icon: 'hard-drive',
    type: 'oauth', needsCompanion: true, isGlobal: false, isVisible: true,
  });
  assert.equal(connector.id, 'google-drive');
  assert.equal(Object.hasOwn(connector, 'source'), false);
});

test('image proxy only accepts the intended HTTPS origin', () => {
  assert.match(validatePollinationsImageUrl('https://image.pollinations.ai/prompt/reef?width=20'), /^https:/);
  for (const value of [
    'http://image.pollinations.ai/prompt/x',
    'https://image.pollinations.ai.evil.test/x',
    'http://127.0.0.1:3001/admin',
    'file:///etc/passwd',
  ]) assert.throws(() => validatePollinationsImageUrl(value));
});

test('Meshy downloads cannot point at local or unrelated hosts', () => {
  assert.equal(isAllowedMeshyAssetUrl('https://assets.meshy.ai/models/a.glb'), true);
  assert.equal(isAllowedMeshyAssetUrl('http://assets.meshy.ai/models/a.glb'), false);
  assert.equal(isAllowedMeshyAssetUrl('https://meshy.ai.evil.test/a.glb'), false);
  assert.equal(isAllowedMeshyAssetUrl('http://127.0.0.1/a.glb'), false);
});

test('public settings and telemetry strip secret or unbounded fields', () => {
  assert.deepEqual(
    sanitizePublicSettings({
      apiKeys: { openai: 'secret' }, globalModel: 'safe', readwiseEnabled: true,
      systemPrefix: 'prefix', agentTemplates: [{ filename: '../../owned', content: 'bad' }],
    }),
    { globalModel: 'safe', readwiseEnabled: true, systemPrefix: 'prefix', agentTemplates: [] },
  );
  assert.deepEqual(
    sanitizeTelemetryProperties({ step: 3, message: 'private', deviceName: 'Scottie iPad' }),
    { step: 3 },
  );
  assert.deepEqual(sanitizeTelemetryMetrics(-5, '999999999999', Infinity), {
    tokensIn: 0,
    tokensOut: 1_000_000_000,
    costUsd: 0,
  });
});

test('release manifests cannot point signed updates at arbitrary URLs', () => {
  const release = validateReleasePayload({
    version: '1.2.3',
    platforms: { 'darwin-aarch64': { signature: 'x'.repeat(64), url: '/releases/Canopy_1.2.3.tar.gz' } },
  });
  assert.equal(release.version, '1.2.3');
  assert.throws(() => validateReleasePayload({
    version: '1.2.3',
    platforms: { 'darwin-aarch64': { signature: 'x'.repeat(64), url: 'https://evil.test/update.tar.gz' } },
  }));
});
