
const DEFAULTS = {
  apiBase: 'http://14.103.118.162:32300/api/proxy/api/v1',
  appId: 'd9m72hpb9rsa732fojg0',
  version: 'v5.2.0'
};

export async function onRequestGet(context) {
  const env = context.env || {};
  return json({
    ok: true,
    app: {
      name: '海潮-海洋内容全链路Agent',
      displayName: '海潮｜福州海洋产业可信内容智能体',
      appId: env.HIAGENT_APP_ID || DEFAULTS.appId,
      version: DEFAULTS.version,
      endpoint: (env.HIAGENT_API_BASE || DEFAULTS.apiBase).replace(/\/$/, ''),
      apiKeyExposedToBrowser: false
    },
    runtime: {
      mode: env.HIAGENT_API_KEY && env.HIAGENT_DEMO_MODE !== '1' ? 'live-ready' : 'demo-ready',
      apiKeyConfigured: Boolean(env.HIAGENT_API_KEY),
      apiKeyExposedToBrowser: false,
      platform: 'cloudflare-pages'
    }
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
