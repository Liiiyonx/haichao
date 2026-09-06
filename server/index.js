import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

await loadLocalEnv(path.join(rootDir, '.env'));

const config = {
  port: Number(process.env.PORT || 4173),
  apiBase: normalizeBaseUrl(
    process.env.HIAGENT_API_BASE || 'http://14.103.118.162:32300/api/proxy/api/v1'
  ),
  appId: process.env.HIAGENT_APP_ID || 'd9m72hpb9rsa732fojg0',
  apiKey: process.env.HIAGENT_API_KEY || '',
  userId: process.env.HIAGENT_USER_ID || 'haichao_web_demo',
  timeoutMs: Number(process.env.HIAGENT_TIMEOUT_MS || 90000),
  pollIntervalMs: Number(process.env.HIAGENT_POLL_INTERVAL_MS || 1600),
  demoMode: process.env.HIAGENT_DEMO_MODE === '1'
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/api/status') {
      return sendJson(response, 200, {
        ok: true,
        app: publicAppInfo(),
        runtime: {
          mode: config.demoMode || !config.apiKey ? 'demo-ready' : 'live-ready',
          apiKeyConfigured: Boolean(config.apiKey),
          apiKeyExposedToBrowser: false
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/haichao') {
      return handleHaichao(request, response);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendJson(response, 405, { ok: false, message: '暂不支持该请求方式' });
    }

    return serveStatic(url.pathname, request, response);
  } catch (error) {
    return sendJson(response, 500, {
      ok: false,
      message: '服务暂时不可用，请稍后重试。',
      detail: safeErrorMessage(error)
    });
  }
});

server.listen(config.port, () => {
  console.log(`海潮 Web Demo 已启动：http://localhost:${config.port}`);
  console.log(`运行模式：${config.demoMode || !config.apiKey ? '演示模式' : 'HiAgent API 实时模式'}`);
});

async function handleHaichao(request, response) {
  const payload = await readJsonBody(request);
  const prompt = normalizePrompt(payload.prompt || payload.user_input || payload.query);
  const scenario = String(payload.scenario || 'custom').slice(0, 40);

  if (!prompt || prompt.length < 4) {
    return sendJson(response, 400, {
      ok: false,
      message: '请先输入一个具体任务，例如“为马尾船政文化生成30秒口播脚本”。'
    });
  }

  if (config.demoMode || !config.apiKey) {
    return sendJson(response, 200, {
      ok: true,
      mode: 'demo',
      app: publicAppInfo(),
      data: createDemoResult(prompt, scenario),
      notice: '当前未配置服务端 API 密钥，页面已启用可录屏的演示模式。密钥只应放在服务端 .env 中，不会暴露给浏览器。'
    });
  }

  try {
    const liveResult = await runHiAgentWorkflow(prompt, scenario);
    return sendJson(response, 200, {
      ok: true,
      mode: 'live',
      app: publicAppInfo(),
      data: liveResult
    });
  } catch (error) {
    return sendJson(response, 200, {
      ok: true,
      mode: 'fallback',
      app: publicAppInfo(),
      data: createDemoResult(prompt, scenario, safeErrorMessage(error)),
      notice: 'HiAgent 实时调用暂未完成，本次自动切换为演示模式；请检查服务端 .env、API 密钥、网络或平台运行状态。'
    });
  }
}

async function runHiAgentWorkflow(prompt, scenario) {
  const startedAt = Date.now();
  const userId = `${config.userId}_${crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 8)}`;
  const runPayload = {
    InputData: JSON.stringify({
      user_input: prompt,
      prompt,
      query: prompt,
      scenario
    }),
    UserID: userId,
    NoDebug: true
  };

  const runData = await hiagentPost('run_app_workflow', runPayload);
  const runId = pickFirst(runData, ['runId', 'RunID', 'RunId', 'Result.runId', 'Result.RunID']);

  if (!runId) {
    throw new Error('平台未返回 runId，无法继续查询执行结果。');
  }

  let latest = null;
  while (Date.now() - startedAt < config.timeoutMs) {
    await wait(config.pollIntervalMs);
    latest = await hiagentPost('query_run_app_process', { RunID: runId, UserID: userId });
    const status = String(pickFirst(latest, ['status', 'Status', 'Result.status', 'Result.Status']) || '').toLowerCase();

    if (['success', 'succeeded', 'finish', 'finished', 'completed', 'done'].includes(status)) {
      return normalizeLiveResult(latest, runId, startedAt);
    }

    if (['failed', 'fail', 'error', 'stopped', 'terminated'].includes(status)) {
      const message = pickFirst(latest, ['message', 'msg', 'Result.message', 'Result.msg']) || '工作流执行失败';
      throw new Error(String(message));
    }
  }

  throw new Error('工作流执行超时，请稍后重试或延长 HIAGENT_TIMEOUT_MS。');
}

async function hiagentPost(endpoint, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 120000));

  try {
    const response = await fetch(`${config.apiBase}${endpoint}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Apikey: config.apiKey
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    const data = tryJson(text) ?? { raw: text };

    if (!response.ok) {
      throw new Error(`HiAgent HTTP ${response.status}: ${text.slice(0, 240)}`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLiveResult(queryData, runId, startedAt) {
  const container = queryData?.Result || queryData;
  const rawOutput = pickFirst(container, ['output', 'Output', 'result', 'Result']) || '';
  const parsedOutput = typeof rawOutput === 'string' ? tryJson(rawOutput) : rawOutput;
  const outputText = stringifyOutput(parsedOutput || rawOutput);

  return {
    runId,
    status: pickFirst(container, ['status', 'Status']) || 'success',
    title: '海潮生成结果',
    subtitle: '由 HiAgent 实时工作流返回',
    domain: inferDomain(outputText),
    confidence: '实时',
    outputText,
    sections: splitOutputSections(outputText),
    evidence: extractEvidence(outputText),
    checklist: extractChecklist(outputText),
    metrics: {
      agents: '3',
      nodes: '24',
      layers: '11',
      costMs: pickFirst(container, ['costMs', 'CostMs']) || Date.now() - startedAt,
      costToken: pickFirst(container, ['costToken', 'CostToken']) || null
    },
    raw: queryData
  };
}

function createDemoResult(prompt, scenario, fallbackReason = '') {
  const domain = inferDomain(`${prompt} ${scenario}`);
  const currentTime = new Date().toLocaleString('zh-CN', { hour12: false });
  const resultMap = {
    culture: createCultureDemo,
    ecommerce: createEcommerceDemo,
    trade: createTradeDemo,
    hybrid: createHybridDemo,
    custom: createHybridDemo
  };
  const creator = resultMap[domain] || createHybridDemo;
  const content = creator(prompt);

  return {
    runId: `demo_${crypto.randomBytes(4).toString('hex')}`,
    status: fallbackReason ? 'fallback_demo' : 'demo_success',
    title: content.title,
    subtitle: '演示模式：完整模拟海潮的证据感知交付结构',
    domain: content.domain,
    confidence: content.confidence,
    outputText: content.outputText,
    sections: content.sections,
    evidence: content.evidence,
    checklist: content.checklist,
    metrics: {
      agents: '3',
      nodes: '24',
      layers: '11',
      costMs: 1280,
      costToken: 'demo'
    },
    createdAt: currentTime,
    fallbackReason
  };
}

function createCultureDemo(prompt) {
  const outputText = `【30秒口播脚本】\n开场3秒：把镜头推向马尾船政旧址，旁白说：“一座船厂，曾把近代中国推向海洋。”\n中段18秒：用三组画面串联船政学堂、造船实践与海防人才培养，强调这里不仅是历史景点，也是福州理解海洋文明的入口。\n结尾9秒：落到当下，“今天再看船政，不只是怀旧，而是在回答福州如何继续向海而兴。”\n\n【6镜头分镜】\n1. 水面晨光与船政建筑外景，建立海洋语境。\n2. 牌匾、展陈、老照片快速切换，提示历史证据。\n3. 手指滑过地图，连接马尾、闽江口与海防线。\n4. 年轻观众参观展馆，转入当代表达。\n5. 字幕强调“向海、求新、可考”。\n6. 以闽江入海口远景收束，呼吁到现场继续了解。\n\n【证据/边界说明】\n- 可使用“马尾船政”“船政学堂”“近代海防”等公开可核验表述。\n- 具体年份、人物职务、展馆藏品名称需以官方展陈或文旅部门资料复核。\n- 不渲染未经确认的“第一”“唯一”“最大”等绝对化表述。\n\n【发布前补充】\n- 补充官方来源链接或展陈拍摄授权。\n- 确认拍摄地点开放时间与可拍摄区域。\n- 若用于商业推广，补充主办方、景区或品牌授权口径。`;

  return withSections({
    title: '马尾船政文化短视频脚本',
    domain: 'culture',
    confidence: '86',
    outputText,
    evidence: ['文化事实进入证据矩阵', '绝对化表达自动降级', '发布前补充项集中呈现'],
    checklist: ['官方来源链接', '展陈拍摄授权', '开放时间与拍摄区域']
  });
}

function createEcommerceDemo(prompt) {
  const outputText = `【30秒直播话术】\n主播开场：家人们看这款冷冻鲍鱼肉，规格是500g一袋，今天售价99元。它适合做蒜蓉、捞饭、佛跳墙配料，也适合家庭宴客提前备菜。\n体验描述：重点看肉质完整度和烹饪便利性，冷冻保存，回家按包装说明解冻处理。\n成交引导：需要的朋友直接拍已上架链接；本场不额外设计优惠，不虚构库存，不承诺未提供的发货时效。\n收束：如果你要做年节海鲜菜，可以先收藏这款，后续按页面展示信息下单。\n\n【证据/边界说明】\n- 已保留用户明确字段：冷冻鲍鱼肉、500g/袋、99元、已上架、购买入口可用。\n- 未扩写“野生、特级、包邮、限量、功效”等未给定信息。\n- 食品口径避免医疗功效和夸大承诺。\n\n【发布前补充】\n- 产地、生产日期、保质期、储存条件。\n- 食品生产许可、检测或溯源码信息。\n- 库存、发货时效、售后规则和页面主图一致性。`;

  return withSections({
    title: '连江鲍鱼直播话术',
    domain: 'ecommerce',
    confidence: '88',
    outputText,
    evidence: ['保留商品显式字段', '未虚构优惠库存', '食品合规边界前置'],
    checklist: ['产地与保质期', '许可/检测/溯源码', '库存与售后规则']
  });
}

function createTradeDemo(prompt) {
  const outputText = `【形式发票草案关键字段】\nProduct: Frozen abalone meat\nDestination: Japan\nQuantity: 1,000 KG\nUnit Price: USD 45 / KG\nAmount: USD 45,000\n\n【英文询盘回复草案】\nDear Customer,\nThank you for your inquiry about frozen abalone meat for the Japanese market. Based on the provided quantity of 1,000 KG and unit price of USD 45/KG, the provisional product amount is USD 45,000.\nBefore issuing the final proforma invoice, please provide buyer/seller details, Incoterms, port of loading/discharge, shipment schedule, packaging requirements and any certification requirements for Japan. We will not assume HS code, logistics route or compliance documents without confirmation.\nBest regards,\n\n【证据/边界说明】\n- 金额计算：1,000 × 45 = USD 45,000。\n- 未虚构买卖方、贸易术语、港口、HS编码、准入证明和运输条件。\n- 日本市场的食品准入、检验检疫和标签要求需按当期官方规则复核。\n\n【发布前补充】\n- Buyer / Seller legal name, address and contact.\n- Incoterms, currency clause, payment terms and validity date.\n- HS code, certificate, origin, cold-chain logistics and destination compliance review. `;

  return withSections({
    title: '水产品外贸询盘与形式发票草案',
    domain: 'trade',
    confidence: '84',
    outputText,
    evidence: ['金额计算可复核', '贸易字段不擅自补全', '目的国规则要求人工复核'],
    checklist: ['买卖方信息', '贸易术语与付款条件', 'HS编码与冷链单证']
  });
}

function createHybridDemo(prompt) {
  const outputText = `【直播开场】\n今天用一个福州海洋文化故事打开这款鱼丸礼盒：从闽江入海到船政记忆，福州一直和海相连。已上架的鱼丸礼盒适合家庭聚餐和节日送礼，但规格、价格、购买入口和配送规则请以页面信息为准。\n\n【英文询盘回复】\nDear Customer,\nThank you for your interest in the Fuzhou fish ball gift box. The product is currently listed, but specifications, price, purchase link, certification and shipping terms have not been provided in this request. Please share the missing details so we can prepare a compliant quotation or proforma invoice for the Japanese market.\n\n【证据/边界说明】\n- 文化线只采用“福州向海、闽江入海、船政记忆”等中性表达。\n- 电商线仅确认“已上架”，不擅自补价格、库存、优惠和入口。\n- 外贸线不虚构认证、运输条件、HS编码和目的国准入结论。\n\n【发布前补充】\n- 鱼丸礼盒规格、净含量、价格、库存、购买入口。\n- 生产许可、检测报告、冷链运输、保质期。\n- 目标买方、贸易术语、认证要求、目的港与付款条件。`;

  return withSections({
    title: '文化×电商×外贸三域协同内容',
    domain: 'hybrid',
    confidence: '82',
    outputText,
    evidence: ['三域动态路由', '证据边界分域表达', '缺失字段显式列出'],
    checklist: ['商品规格与价格', '认证与冷链信息', '买方与贸易条件']
  });
}

function withSections(result) {
  return {
    ...result,
    sections: splitOutputSections(result.outputText)
  };
}

function splitOutputSections(text) {
  const matches = [...String(text || '').matchAll(/【([^】]+)】\s*([\s\S]*?)(?=\n【[^】]+】|$)/g)];
  if (!matches.length) {
    return [{ title: '生成结果', body: String(text || '').trim() }];
  }
  return matches.map((match) => ({ title: match[1].trim(), body: match[2].trim() }));
}

function extractEvidence(text) {
  const section = splitOutputSections(text).find((item) => /证据|边界/.test(item.title));
  return section ? toList(section.body).slice(0, 6) : ['输出需结合业务资料复核', '缺失字段不由模型擅自补全'];
}

function extractChecklist(text) {
  const section = splitOutputSections(text).find((item) => /补充|检查/.test(item.title));
  return section ? toList(section.body).slice(0, 6) : ['补充业务资料', '复核事实来源', '确认发布授权'];
}

function toList(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.replace(/^[-•\d.、\s]+/, '').trim())
    .filter(Boolean);
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

function publicAppInfo() {
  return {
    name: '海潮-海洋内容全链路Agent',
    displayName: '海潮｜福州海洋产业可信内容智能体',
    appId: config.appId,
    version: 'v5.2.0',
    endpoint: config.apiBase.replace(/\/$/, ''),
    apiKeyExposedToBrowser: false
  };
}

async function serveStatic(pathname, request, response) {
  const cleanPath = decodeURIComponent(pathname.split('?')[0]);
  const relativePath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relativePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    return serveStatic('/index.html', request, response);
  }

  const content = await readFile(filePath);
  response.writeHead(200, {
    'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=3600'
  });
  if (request.method === 'HEAD') return response.end();
  return response.end(content);
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 120000) throw new Error('请求内容过长');
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function normalizePrompt(value) {
  return String(value || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
}

function normalizeBaseUrl(value) {
  const clean = String(value || '').trim();
  return clean.endsWith('/') ? clean : `${clean}/`;
}

async function loadLocalEnv(filePath) {
  if (!existsSync(filePath)) return;
  const content = await readFile(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
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
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeErrorMessage(error) {
  return String(error?.message || error || '未知错误')
    .replace(config.apiKey, '[API_KEY]')
    .slice(0, 600);
}
