const prompts = {
  culture: '请为“马尾船政文化与福州向海精神”生成一条60秒短视频口播脚本，要求表达年轻化，但涉及年份、人物、机构时必须标注证据边界。',
  ecommerce: '请为“连江鲍鱼礼盒”生成直播间开场话术和卖点卡，不要虚构价格、库存、优惠、购买链接，把缺失字段列为发布前补充。',
  trade: '请为一封“冻鲍鱼出口询盘回复”生成英文邮件和形式发票字段清单，目的国为新加坡，贸易术语和认证信息不完整时请提示补充。',
  hybrid: '请围绕“连江鲍鱼出海传播”同时生成一段种草文案、直播话术框架和外贸跟进邮件，并明确文化、电商、外贸三类边界。'
};

const state = { scenario: 'culture', lastOutput: '' };
const elements = {
  promptInput: document.querySelector('#promptInput'),
  generateBtn: document.querySelector('#generateBtn'),
  clearBtn: document.querySelector('#clearBtn'),
  copyBtn: document.querySelector('#copyBtn'),
  resultBody: document.querySelector('#resultBody'),
  resultMode: document.querySelector('#resultMode'),
  resultTitle: document.querySelector('#resultTitle'),
  statusText: document.querySelector('#statusText')
};

init();

function init() {
  elements.promptInput.value = prompts.culture;
  bindEvents();
  checkStatus();
  initReveal();
  initCanvas();
}

function bindEvents() {
  document.querySelectorAll('.scenario-card').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.scenario-card').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.scenario = button.dataset.scenario;
      elements.promptInput.value = prompts[state.scenario];
      elements.promptInput.focus();
    });
  });
  elements.clearBtn.addEventListener('click', () => {
    elements.promptInput.value = '';
    elements.promptInput.focus();
  });
  elements.generateBtn.addEventListener('click', generate);
  elements.copyBtn.addEventListener('click', copyResult);
}

async function checkStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    elements.statusText.textContent = data.runtime?.mode === 'live-ready' ? 'HiAgent 实时连接' : '安全体验模式';
  } catch {
    elements.statusText.textContent = '服务连接中';
  }
}

async function generate() {
  const prompt = elements.promptInput.value.trim();
  if (!prompt) {
    showMessage('请先输入一个具体任务。');
    return;
  }
  setLoading(true);
  try {
    const response = await fetch('/api/haichao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, scenario: state.scenario })
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.message || '生成失败');
    renderResult(payload);
  } catch (error) {
    showMessage(error.message || '服务暂时不可用，请稍后再试。');
  } finally {
    setLoading(false);
  }
}

function renderResult(payload) {
  const modeText = { demo: '安全体验', live: 'HiAgent 实时', fallback: '可信兜底' }[payload.mode] || '生成结果';
  const data = payload.data || {};
  const sections = Array.isArray(data.sections) && data.sections.length ? data.sections : [{ title: '生成结果', body: data.outputText || '本次未返回文本内容。' }];
  state.lastOutput = sections.map((section) => `【${section.title}】\n${section.body}`).join('\n\n');
  elements.resultMode.textContent = modeText;
  elements.resultTitle.textContent = data.title || '可信内容结果';
  const meta = [domainName(data.domain), data.confidence || '可信边界已检查', data.source === 'hiagent-api' ? 'API 实时返回' : '本地兜底生成'].filter(Boolean);
  elements.resultBody.classList.remove('empty');
  elements.resultBody.innerHTML = `
    <div class="result-meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>
    ${sections.map((section) => `
      <section class="result-section">
        <h4>${escapeHtml(section.title)}</h4>
        ${renderSectionBody(section.body)}
      </section>`).join('')}
  `;
}

function renderSectionBody(body) {
  const text = String(body || '').trim();
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    return `<ul>${lines.map((line) => `<li>${escapeHtml(line.replace(/^[-•]\s*/, ''))}</li>`).join('')}</ul>`;
  }
  return `<p>${escapeHtml(text)}</p>`;
}

function setLoading(isLoading) {
  elements.generateBtn.disabled = isLoading;
  elements.generateBtn.textContent = isLoading ? '生成中…' : '生成可信内容';
  if (isLoading) {
    elements.resultMode.textContent = '正在处理';
    elements.resultTitle.textContent = '海潮正在核验边界';
    elements.resultBody.classList.add('empty');
    elements.resultBody.innerHTML = '<p>正在调用智能体链路，请稍候。</p>';
  }
}

function showMessage(message) {
  elements.resultMode.textContent = '提示';
  elements.resultTitle.textContent = '需要补充信息';
  elements.resultBody.classList.add('empty');
  elements.resultBody.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

async function copyResult() {
  if (!state.lastOutput) return;
  await navigator.clipboard.writeText(state.lastOutput);
  elements.copyBtn.textContent = '已复制';
  setTimeout(() => { elements.copyBtn.textContent = '复制结果'; }, 1400);
}

function domainName(domain) {
  return { culture: '海洋文化', ecommerce: '直播电商', trade: '水产外贸', hybrid: '三域协同', custom: '自定义任务' }[domain] || '自定义任务';
}

function escapeHtml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function initReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add('is-visible');
    });
  }, { threshold: 0.13 });
  document.querySelectorAll('[data-reveal]').forEach((element) => {
    element.classList.add('is-visible');
    observer.observe(element);
  });
}

function initCanvas() {
  const canvas = document.querySelector('#tideCanvas');
  const context = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let ratio = 1;

  function resize() {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(time) {
    context.clearRect(0, 0, width, height);
    for (let band = 0; band < 7; band += 1) {
      const baseY = height * (0.18 + band * 0.115);
      const gradient = context.createLinearGradient(0, baseY - 40, width, baseY + 40);
      gradient.addColorStop(0, 'rgba(10,112,191,0.05)');
      gradient.addColorStop(0.55, 'rgba(98,220,233,0.12)');
      gradient.addColorStop(1, 'rgba(10,112,191,0.04)');
      context.beginPath();
      for (let x = -80; x <= width + 80; x += 16) {
        const y = baseY + Math.sin(x * 0.006 + time * 0.00045 + band * 0.7) * (18 + band * 2);
        if (x === -80) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = gradient;
      context.lineWidth = 1.2;
      context.stroke();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
}
