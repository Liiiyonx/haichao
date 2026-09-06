const DEFAULTS = {
  apiBase: 'http://14.103.118.162:32300/api/proxy/api/v1',
  appId: 'd9m72hpb9rsa732fojg0',
  userId: 'haichao_pages_demo',
  timeoutMs: 52000,
  pollIntervalMs: 1600
};

export async function onRequestPost(context) {
  const env = context.env || {};
  const config = getConfig(env);
  let payload = {};
  try {
    payload = await context.request.json();
  } catch {
    return json({ ok: false, message: '请求格式不正确。' }, 400);
  }

  const prompt = normalizePrompt(payload.prompt || payload.user_input || payload.query);
  const scenario = String(payload.scenario || 'custom').slice(0, 40);
  if (!prompt || prompt.length < 4) {
    return json({ ok: false, message: '请先输入一个具体任务，例如“为马尾船政文化生成60秒口播脚本”。' }, 400);
  }

  if (config.demoMode || !config.apiKey) {
    return json({ ok: true, mode: 'demo', app: publicAppInfo(config), data: createDemoResult(prompt, scenario) });
  }

  try {
    const data = await runHiAgentWorkflow(config, prompt, scenario);
    return json({ ok: true, mode: 'live', app: publicAppInfo(config), data });
  } catch (error) {
    return json({
      ok: true,
      mode: 'fallback',
      app: publicAppInfo(config),
      data: createDemoResult(prompt, scenario, safeErrorMessage(config, error)),
      notice: 'HiAgent 实时调用暂未完成，本次自动切换为可信兜底结果。'
    });
  }
}

export async function onRequestGet() {
  return json({ ok: false, message: '请在页面中输入任务后生成。' }, 405);
}

function getConfig(env) {
  return {
    apiBase: normalizeBaseUrl(env.HIAGENT_API_BASE || DEFAULTS.apiBase),
    appId: env.HIAGENT_APP_ID || DEFAULTS.appId,
    apiKey: env.HIAGENT_API_KEY || '',
    userId: env.HIAGENT_USER_ID || DEFAULTS.userId,
    timeoutMs: Number(env.HIAGENT_TIMEOUT_MS || DEFAULTS.timeoutMs),
    pollIntervalMs: Number(env.HIAGENT_POLL_INTERVAL_MS || DEFAULTS.pollIntervalMs),
    demoMode: env.HIAGENT_DEMO_MODE === '1'
  };
}

async function runHiAgentWorkflow(config, prompt, scenario) {
  const startedAt = Date.now();
  const userId = `${config.userId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const runData = await hiagentPost(config, 'run_app_workflow', {
    AppID: config.appId,
    InputData: JSON.stringify({ user_input: prompt }),
    UserID: userId,
    NoDebug: false
  });
  const runId = pickFirst(runData, ['runId', 'RunID', 'RunId', 'Result.runId', 'Result.RunID']);
  if (!runId) throw new Error('平台未返回 runId，无法继续查询执行结果。');

  let latest = null;
  while (Date.now() - startedAt < config.timeoutMs) {
    await wait(config.pollIntervalMs);
    latest = await hiagentPost(config, 'query_run_app_process', { RunID: runId, UserID: userId });
    const status = String(pickFirst(latest, ['status', 'Status', 'Result.status', 'Result.Status']) || '').toLowerCase();
    if (['success', 'succeeded', 'finish', 'finished', 'completed', 'done'].includes(status)) {
      return normalizeLiveResult(latest, runId, startedAt, scenario, prompt);
    }
    if (['failed', 'fail', 'error', 'stopped', 'terminated'].includes(status)) {
      throw new Error(String(pickFirst(latest, ['message', 'msg', 'Result.message', 'Result.msg']) || '工作流执行失败'));
    }
  }
  throw new Error('工作流执行超时，请稍后再试。');
}

async function hiagentPost(config, endpoint, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 60000));
  try {
    const response = await fetch(`${config.apiBase}${endpoint}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Apikey: config.apiKey },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    const data = tryJson(text) ?? { raw: text };
    if (!response.ok) throw new Error(`HiAgent HTTP ${response.status}: ${text.slice(0, 220)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLiveResult(queryData, runId, startedAt, scenario, prompt) {
  const container = queryData?.Result || queryData;
  const rawOutput = pickFirst(container, ['output', 'Output', 'result', 'Result']) || '';
  const parsedOutput = typeof rawOutput === 'string' ? tryJson(rawOutput) : rawOutput;
  let outputText = stringifyOutput(parsedOutput || rawOutput);
  if (!outputText.trim()) outputText = findMeaningfulText(container);
  if (!outputText.trim()) throw new Error('HiAgent API 返回成功，但未包含最终文本输出。');
  return {
    runId,
    status: pickFirst(container, ['status', 'Status']) || 'success',
    title: '海潮生成结果',
    domain: normalizeScenario(scenario) || inferDomain(`${prompt} ${outputText}`),
    confidence: '实时',
    outputText,
    sections: splitOutputSections(outputText),
    evidence: extractEvidence(outputText),
    checklist: extractChecklist(outputText),
    metrics: { agents: '3', nodes: '24', layers: '11', costMs: pickFirst(container, ['costMs', 'CostMs']) || Date.now() - startedAt },
    source: 'hiagent-api'
  };
}

function createDemoResult(prompt, scenario, fallbackReason = '') {
  const domain = normalizeScenario(scenario) || inferDomain(prompt);
  const creators = { culture: createCultureDemo, ecommerce: createEcommerceDemo, trade: createTradeDemo, hybrid: createHybridDemo, custom: createHybridDemo };
  const result = (creators[domain] || createHybridDemo)(prompt);
  return {
    ...result,
    fallbackReason,
    metrics: { agents: '3', nodes: '24', layers: '11' },
    source: fallbackReason ? 'safe-fallback' : 'demo-template'
  };
}

function createCultureDemo() {
  return withSections({
    title: '海洋文化传播脚本',
    domain: 'culture',
    confidence: '可信边界清晰',
    outputText: `【60秒口播】
福州的城市气质，一直与海相连。镜头从闽江入海口推向马尾船政文化街区：这里适合讲述近代海防、造船教育与城市向海发展的关系。口播建议采用“城市从江河走向海洋”的叙事，不擅自补充未经核验的年份、人物关系或机构结论。

【分镜建议】
1. 开场：海面、港口、闽江入海的环境镜头。
2. 中段：船政文化相关建筑与展陈细节。
3. 收束：连接当代福州海洋经济与青年传播表达。

【证据/边界说明】
- 涉及具体年份、人物、机构时，需要以官方展陈、地方志或权威资料为准。
- 未提供来源的历史判断不写成确定结论。

【发布前补充】
- 具体拍摄地点授权。
- 可引用的官方资料链接或展陈文字。
- 是否需要加入活动名称、主办单位与发布时间。`
  });
}

function createEcommerceDemo() {
  return withSections({
    title: '海产品直播话术与发布清单',
    domain: 'ecommerce',
    confidence: '发布前需补字段',
    outputText: `【直播开场】
大家好，今天带来的是福州海洋风味相关产品。它适合作为家庭餐桌、节日礼盒或地方特色伴手礼的内容方向。由于当前任务没有提供价格、规格、库存、优惠和购买入口，本话术只表达产品场景与卖点方向，不做确定性交易承诺。

【卖点卡】
- 地域表达：突出福州海洋风味和地方特色。
- 场景表达：家庭聚餐、送礼、年节备货。
- 信任表达：把规格、产地、检测、冷链、售后写清楚后再发布。

【证据/边界说明】
- 不虚构价格、库存、优惠券、限时活动。
- 不擅自承诺功效、销量、排名或平台政策。

【发布前补充】
- 商品全称、规格、净含量、保质期。
- 售价、库存、优惠、购买链接。
- 生产许可、检测报告、冷链配送和售后规则。`
  });
}

function createTradeDemo() {
  return withSections({
    title: '水产品外贸询盘回复',
    domain: 'trade',
    confidence: '专业字段待复核',
    outputText: `【English Reply】
Dear Customer,
Thank you for your inquiry about frozen abalone products from Fuzhou. We can prepare a quotation and proforma invoice after confirming product specification, quantity, Incoterms, destination port, payment terms, certification requirements and cold-chain delivery conditions.

【Proforma Invoice Fields】
- Seller / buyer information.
- Product name, specification, quantity and unit price.
- Currency, Incoterms, loading port and destination port.
- Packaging, shelf life, cold-chain requirements and certification documents.

【证据/边界说明】
- HS code, customs requirements and destination-market access rules must be checked by a qualified trade or customs professional.
- No certification, price or delivery promise should be generated without source documents.

【发布前补充】
- 买卖方信息、目的港、数量、规格、报价币种。
- 贸易术语、付款条件、认证文件、冷链要求。
- HS 编码、检验检疫与目的国准入复核。`
  });
}

function createHybridDemo() {
  return withSections({
    title: '三域协同内容包',
    domain: 'hybrid',
    confidence: '三域边界已拆分',
    outputText: `【传播文案】
从闽江入海到海洋餐桌，福州的海味不仅是地方风物，也是一条连接文化传播、消费体验与产业出海的线索。

【直播话术框架】
开场先讲地域记忆，再讲食用场景，最后引导用户查看商品规格、价格、库存、冷链和售后信息。缺失字段不直接承诺。

【外贸跟进邮件】
Dear Customer, thank you for your interest. We will prepare a compliant quotation after confirming specification, quantity, Incoterms, destination port, certification and cold-chain requirements.

【证据/边界说明】
- 文化线使用中性城市表达，不编造历史细节。
- 电商线不虚构价格、库存、优惠和购买入口。
- 外贸线不替代报关、认证和目的国准入判断。

【发布前补充】
- 商品规格、价格、库存、链接和授权素材。
- 认证、检测、冷链和售后资料。
- 买方信息、贸易术语、目的港与付款条件。`
  });
}

function withSections(result) {
  return { ...result, sections: splitOutputSections(result.outputText) };
}

function splitOutputSections(text) {
  const matches = [...String(text || '').matchAll(/【([^】]+)】\s*([\s\S]*?)(?=\n【[^】]+】|$)/g)];
  return matches.length ? matches.map((match) => ({ title: match[1].trim(), body: match[2].trim() })) : [{ title: '生成结果', body: String(text || '').trim() }];
}

function extractEvidence(text) {
  const section = splitOutputSections(text).find((item) => /证据|边界/.test(item.title));
  return section ? toList(section.body).slice(0, 6) : ['输出需结合业务资料复核', '缺失字段不由模型擅自补全'];
}

function extractChecklist(text) {
  const section = splitOutputSections(text).find((item) => /补充|清单|检查/.test(item.title));
  return section ? toList(section.body).slice(0, 6) : ['补充业务资料', '复核事实来源', '确认发布授权'];
}

function toList(text) {
  return String(text || '').split(/\n+/).map((line) => line.replace(/^[-•\d.、\s]+/, '').trim()).filter(Boolean);
}

function normalizeScenario(value) {
  const scenario = String(value || '').toLowerCase();
  return ['culture', 'ecommerce', 'trade', 'hybrid'].includes(scenario) ? scenario : '';
}

function inferDomain(text) {
  const value = String(text || '').toLowerCase();
  const hasCulture = /船政|文化|文旅|历史|非遗|口播|分镜|闽都/.test(value);
  const hasEcommerce = /直播|电商|上架|售价|库存|优惠|购买|商品|鲍鱼|鱼丸/.test(value);
  const hasTrade = /外贸|invoice|proforma|询盘|出口|日本|hs|usd|kg|贸易|incoterms|买方|卖方/.test(value);
  const count = [hasCulture, hasEcommerce, hasTrade].filter(Boolean).length;
  if (count >= 2) return 'hybrid';
  if (hasTrade) return 'trade';
  if (hasEcommerce) return 'ecommerce';
  if (hasCulture) return 'culture';
  return 'custom';
}

function publicAppInfo(config) {
  return { name: '海潮-海洋内容全链路Agent', displayName: '海潮｜福州海洋产业可信内容智能体', appId: config.appId, version: 'v5.2.0', endpoint: config.apiBase.replace(/\/$/, ''), apiKeyExposedToBrowser: false };
}

function findMeaningfulText(value) {
  const seen = new Set();
  const texts = [];
  const ignoredKeys = new Set(['runId', 'status', 'steps', 'costMs', 'costToken', 'code', 'message', 'msg']);
  const visit = (item, key = '') => {
    if (item === null || item === undefined) return;
    if (typeof item === 'object') {
      if (seen.has(item)) return;
      seen.add(item);
      for (const [childKey, childValue] of Object.entries(item)) if (!ignoredKeys.has(childKey)) visit(childValue, childKey);
      return;
    }
    if (typeof item !== 'string') return;
    const text = item.trim();
    if (text.length < 20) return;
    const parsed = /^\{.*\}$/.test(text) ? tryJson(text) : null;
    if (parsed) return visit(parsed, key);
    if (/^[A-Z0-9_\-]{10,}$/.test(text)) return;
    texts.push(text);
  };
  visit(value);
  return texts.sort((a, b) => b.length - a.length)[0] || '';
}

function pickFirst(source, paths) {
  for (const itemPath of paths) {
    const value = itemPath.split('.').reduce((current, key) => current?.[key], source);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function tryJson(value) {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function stringifyOutput(value) {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    if (typeof value.output === 'string') return value.output;
    if (typeof value.result === 'string') return value.result;
    if (typeof value.text === 'string') return value.text;
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function normalizePrompt(value) {
  return String(value || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
}

function normalizeBaseUrl(value) {
  const clean = String(value || '').trim();
  return clean.endsWith('/') ? clean : `${clean}/`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeErrorMessage(config, error) {
  return String(error?.message || error || '未知错误').replace(config.apiKey, '[API_KEY]').slice(0, 600);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
