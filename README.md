# 海潮 Web Demo

> 🌊 **在线体验**：<https://haichao-web-demo.pages.dev/>

这是为「闽都×火山杯 Agent 创新大赛」准备的独立 Web 体验页，定位为：高审美、可录屏、可部署、可安全接入 HiAgent API。

## 已内置的信息

- 作品名称：海潮｜福州海洋产业可信内容智能体
- 智能体名称：海潮-海洋内容全链路Agent
- HiAgent APPID：`d9m72hpb9rsa732fojg0`
- API 地址：`http://14.103.118.162:32300/api/proxy/api/v1`
- 版本：`v5.2.0`
- 能力表达：3 个专业 Agent、24 个工作流节点、11 层可信链路

## 本地运行

1. 进入目录：`C:\Users\Liii\Desktop\闽都×火山杯Agent创新大赛\web-demo-haichao`
2. 复制配置：把 `.env.example` 复制为 `.env`
3. 如果暂时不接真实 API，可以不填 `HIAGENT_API_KEY`，页面会自动进入演示模式
4. 如需接真实 API，把 HiAgent 发布页的 API 密钥填入 `.env` 的 `HIAGENT_API_KEY`
5. 启动：`npm start`
6. 打开：`http://localhost:4173`

## 安全原则

- 不要把 API 密钥写进 `public/index.html`、`public/app.js` 或任何前端文件。
- API 密钥只放在服务端 `.env`，前端只请求本站的 `/api/haichao`。
- 录屏时可以展示 API 地址、APPID、版本和运行状态，不展示 API 密钥。

## 部署建议

- 如果赛事平台只要求「体验链接 / Demo」，建议把这个项目部署到一台 Node 服务器，并配置 `.env`。
- 若只部署静态页面，页面仍能展示，但只能作为演示模式，不能实时调用 HiAgent。
- 提交时可填写：Web Demo 链接 + HiAgent API 地址 + APPID；密钥不提交给公开表单。

## 设计参考方向

- 参考 Awwwards 常见优秀作品的沉浸式首屏、强字体层级、暗色高对比、玻璃拟态、细粒度动效和滚动叙事。
- 没有复制任何具体站点版式或素材，视觉语言围绕「福州向海、证据可信、产业落地」原创设计。
