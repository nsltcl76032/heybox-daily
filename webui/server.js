import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Lazy-load app modules from dist/
async function getModules() {
  const login = await import('../dist/login.js');
  const config = await import('../dist/config.js');
  const client = await import('../dist/client.js');
  const tasks = await import('../dist/tasks.js');
  return { ...login, ...config, ...client, ...tasks };
}

const PORT = parseInt(process.env.PORT || '8620', 10);
const PRIVATE_DIR = path.join(ROOT_DIR, 'private');
const STATE_DIR = path.join(ROOT_DIR, 'state');
const SCHEDULE_FILE = path.join(STATE_DIR, 'schedule.json');
const CRON_LOG_FILE = path.join(STATE_DIR, 'cron.log');

// Ensure state dir exists
if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
if (!fs.existsSync(PRIVATE_DIR)) fs.mkdirSync(PRIVATE_DIR, { recursive: true });

// Schedule configuration state
let schedule = {
  enabled: true,
  time: '09:15',
  cron: '15 9 * * *',
  lastRun: null,
  lastStatus: null,
  lastRunDate: null,
  pushplus: {
    enabled: false,
    token: '',
    topic: ''
  }
};

function loadSchedule() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
      schedule = {
        ...schedule,
        ...data,
        pushplus: {
          ...schedule.pushplus,
          ...(data.pushplus || {})
        }
      };
    }
  } catch (err) {
    console.error('Failed to load schedule.json:', err.message);
  }
}

function saveSchedule() {
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save schedule.json:', err.message);
  }
}

loadSchedule();

// Compute Next Run in Beijing Time
function computeNextRun() {
  if (!schedule.enabled || !schedule.time) return null;
  const [h, m] = schedule.time.split(':').map(Number);
  const now = new Date();
  
  // Format current Beijing time parts
  const beijingFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false
  });
  const parts = Object.fromEntries(beijingFormatter.formatToParts(now).map(p => [p.type, p.value]));
  const currentHour = parseInt(parts.hour, 10);
  const currentMinute = parseInt(parts.minute, 10);

  let runToday = true;
  if (currentHour > h || (currentHour === h && currentMinute >= m)) {
    runToday = false;
  }

  const targetYear = parseInt(parts.year, 10);
  const targetMonth = parseInt(parts.month, 10) - 1;
  const targetDay = parseInt(parts.day, 10) + (runToday ? 0 : 1);

  const d = new Date(Date.UTC(targetYear, targetMonth, targetDay, h - 8, m, 0));
  return d.toISOString();
}

// Memory log buffer for recent events
const recentLogs = [];
function appendLog(line) {
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const entry = `[${ts}] ${line}`;
  console.log(entry);
  recentLogs.push(entry);
  if (recentLogs.length > 250) recentLogs.shift();
  try {
    fs.appendFileSync(CRON_LOG_FILE, entry + '\n', 'utf8');
  } catch {}
}

// PushPlus notification helper
async function sendPushPlus({ token, topic, title, content }) {
  if (!token) throw new Error('PushPlus Token 不能为空');

  const payload = {
    token,
    title: String(title).slice(0, 100),
    content,
    template: 'markdown',
    ...(topic ? { topic } : {})
  };

  const res = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (data.code === 200) {
    return { success: true, message: data.msg || '推送成功', data: data.data };
  } else {
    throw new Error(`PushPlus 接口错误 (${data.code}): ${data.msg || data.data}`);
  }
}

// Push report after task run
async function notifyTaskResult(summary, config, client, source, error = null) {
  const token = schedule.pushplus?.token || process.env.PUSHPLUS_TOKEN;
  if (!schedule.pushplus?.enabled || !token) return;

  const beijingTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const nickname = config?.profile?.nickname || '小黑盒用户';
  const heyboxId = config?.session?.heybox_id || '未知';

  if (error) {
    const title = `⚠️ 小黑盒每日任务执行失败 [${nickname}]`;
    const content = [
      `### ⚠️ 小黑盒每日任务异常报告`,
      `- **账号**：${nickname} (ID: \`${heyboxId}\`)`,
      `- **触发来源**：${source}`,
      `- **发生时间**：${beijingTime}`,
      `- **错误信息**：\`${error.message || error}\``,
      `\n> 请前往 Web 管理控制台查看详细执行日志。`
    ].join('\n\n');

    try {
      await sendPushPlus({ token, topic: schedule.pushplus?.topic, title, content });
      appendLog(`[PushPlus] 任务失败异常告警已推送`);
    } catch (pushErr) {
      appendLog(`[PushPlus] 告警推送失败: ${pushErr.message}`);
    }
    return;
  }

  let statusSection = '';
  try {
    const { inspect } = await getModules();
    const state = await inspect(client, heyboxId);
    statusSection = [
      `#### 📋 今日任务完成情况`,
      `- **每日签到**：${state.signed ? '✅ 已完成' : '❌ 未完成'}`,
      ...(state.tasks || [])
        .filter(t => ['1', '19', '31'].includes(String(t.id)))
        .map(t => {
          const nameMap = { '1': '分享帖子', '19': '分享游戏', '31': '分享游戏评价' };
          const fin = t.state === 'finish' || t.state === '1';
          return `- **${nameMap[t.id] || t.title}**：${fin ? '✅ 已完成' : '❌ 未完成'}`;
        }),
      `\n#### 💰 当前资产总计`,
      `- **经验值 (Exp)**：${state.exp}`,
      `- **小黑盒 H币**：${state.coin}`
    ].join('\n');
  } catch (inspectErr) {
    statusSection = `\n- 状态获取提示: ${inspectErr.message}`;
  }

  const expDeltaStr = summary?.expDelta !== undefined ? `${summary.expDelta >= 0 ? '+' : ''}${summary.expDelta}` : '0';
  const coinDeltaStr = summary?.coinDelta !== undefined ? `${summary.coinDelta >= 0 ? '+' : ''}${summary.coinDelta}` : '0';

  const title = `📦 小黑盒每日任务完成 [${nickname}]`;
  const content = [
    `### 📦 小黑盒每日任务报告`,
    `- **账号昵称**：${nickname}`,
    `- **盒友 ID**：\`${heyboxId}\``,
    `- **触发来源**：${source}`,
    `- **执行时间**：${beijingTime}`,
    `- **本次收益**：经验 **${expDeltaStr}**，H币 **${coinDeltaStr}**`,
    statusSection,
    `\n> 提示：可在 Web 控制台调整定时任务或查阅完整控制台日志。`
  ].join('\n\n');

  try {
    await sendPushPlus({ token, topic: schedule.pushplus?.topic, title, content });
    appendLog(`[PushPlus] 每日任务执行结果推送成功`);
  } catch (pushErr) {
    appendLog(`[PushPlus] 结果推送失败: ${pushErr.message}`);
  }
}

// In-memory pending login sessions
const pendingSessions = new Map();

// Execution lock
let isRunning = false;

async function executeDailyTasks(source = 'manual') {
  if (isRunning) throw new Error('任务正在执行中，请勿重复发起');
  isRunning = true;
  appendLog(`>>> 开始执行每日任务 [触发来源: ${source}]`);

  let loadedConfig = null;
  let client = null;

  try {
    const { loadConfig, HeyboxClient, runDaily } = await getModules();
    loadedConfig = loadConfig();
    client = new HeyboxClient(loadedConfig);

    const logs = [];
    const logCollector = (msg) => {
      logs.push(msg);
      appendLog(msg);
    };

    const summary = await runDaily(client, loadedConfig.session.heybox_id, {
      log: logCollector,
      onTask: (id, action) => {
        const nameMap = { '1': '分享帖子', '19': '分享游戏', '31': '分享游戏评价', sign: '每日签到' };
        appendLog(`任务 [${nameMap[id] || id}]: ${action === 'executed' ? '完成' : '跳过/已完成'}`);
      }
    });

    const resultMsg = `今日任务完成！经验: ${(summary.expDelta ?? 0) >= 0 ? '+' : ''}${summary.expDelta ?? 0}，H币: ${(summary.coinDelta ?? 0) >= 0 ? '+' : ''}${summary.coinDelta ?? 0}`;
    appendLog(`<<< ${resultMsg}`);
    
    schedule.lastRun = new Date().toISOString();
    schedule.lastStatus = resultMsg;
    saveSchedule();

    // Trigger PushPlus notification on success
    await notifyTaskResult(summary, loadedConfig, client, source, null);

    return { success: true, summary, logs, resultMsg };
  } catch (err) {
    const errorMsg = `任务执行失败: ${err.message}`;
    appendLog(`<<< ${errorMsg}`);
    schedule.lastRun = new Date().toISOString();
    schedule.lastStatus = errorMsg;
    saveSchedule();

    // Trigger PushPlus alert on failure
    await notifyTaskResult(null, loadedConfig, client, source, err);

    throw err;
  } finally {
    isRunning = false;
  }
}

// Scheduled timer checking Beijing time every 30 seconds
setInterval(() => {
  if (!schedule.enabled || !schedule.time) return;
  const now = new Date();
  const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit', minute: '2-digit',
    hour12: false
  });
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });

  const currentTime = timeFormatter.format(now);
  const currentDate = dateFormatter.format(now);

  if (currentTime === schedule.time && schedule.lastRunDate !== currentDate) {
    schedule.lastRunDate = currentDate;
    saveSchedule();
    executeDailyTasks('定时调度').catch(err => {
      console.error('Scheduled run failed:', err.message);
    });
  }
}, 30000);

// Helper for JSON request bodies
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, type = 'text/plain') {
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Cache-Control': 'no-cache'
  });
  res.end(text);
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    // 1. API: Get Status & Tasks
    if (method === 'GET' && pathname === '/api/status') {
      const configFilePath = path.join(PRIVATE_DIR, 'config.json');
      if (!fs.existsSync(configFilePath)) {
        return sendJson(res, 200, {
          configured: false,
          message: '未找到账号配置，请先登录'
        });
      }

      try {
        const { loadConfig, HeyboxClient, inspect } = await getModules();
        const config = loadConfig(configFilePath);
        const client = new HeyboxClient(config);
        const state = await inspect(client, config.session.heybox_id);

        const tasksInfo = [
          {
            id: 'sign',
            title: '每日签到',
            finished: Boolean(state.signed)
          },
          ...(state.tasks || [])
            .filter(t => ['1', '19', '31'].includes(String(t.id)))
            .map(t => ({
              id: String(t.id),
              title: t.title || (t.id === '1' ? '分享帖子' : t.id === '19' ? '分享游戏' : '分享游戏评价'),
              finished: t.state === 'finish' || t.state === '1'
            }))
        ];

        return sendJson(res, 200, {
          configured: true,
          profile: {
            heybox_id: config.session.heybox_id,
            nickname: state.profile?.nickname || config.profile?.nickname || '小黑盒用户',
            avatar: state.profile?.avatar || config.profile?.avatar || ''
          },
          status: {
            signed: state.signed,
            exp: state.exp,
            coin: state.coin,
            tasks: tasksInfo
          },
          isRunning,
          lastChecked: new Date().toISOString()
        });
      } catch (err) {
        return sendJson(res, 200, {
          configured: true,
          error: err.message,
          isRunning
        });
      }
    }

    // 2. API: Send Login Code
    if (method === 'POST' && pathname === '/api/login/send-code') {
      const body = await parseBody(req);
      const rawPhone = body.phone;
      if (!rawPhone) return sendJson(res, 400, { error: '请输入手机号' });

      const { normalizePhone, prepareLogin, sendLoginCode } = await getModules();
      let phone;
      try {
        phone = normalizePhone(rawPhone);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      try {
        appendLog(`准备向手机号 ${phone.slice(0, 3)}****${phone.slice(-4)} 发送验证码…`);
        const config = await prepareLogin();
        pendingSessions.set(phone, { config, createdAt: Date.now() });

        const captcha = body.ticket && body.randstr ? { ticket: body.ticket, randstr: body.randstr } : undefined;
        await sendLoginCode(config, phone, { captcha });

        return sendJson(res, 200, {
          success: true,
          message: `验证码已发送至尾号 ${phone.slice(-4)}`
        });
      } catch (err) {
        appendLog(`发送验证码异常: ${err.message}`);
        if (err.captchaRequired) {
          return sendJson(res, 200, {
            success: false,
            captchaRequired: true,
            appId: err.captchaAppId || '',
            message: err.message
          });
        }
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 3. API: Verify Login Code
    if (method === 'POST' && pathname === '/api/login/verify-code') {
      const body = await parseBody(req);
      const rawPhone = body.phone;
      const code = String(body.code || '').trim();

      if (!rawPhone || !code) {
        return sendJson(res, 400, { error: '请提供手机号和验证码' });
      }

      const { normalizePhone, verifyLoginCode, saveConfig } = await getModules();
      let phone;
      try {
        phone = normalizePhone(rawPhone);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const session = pendingSessions.get(phone);
      if (!session) {
        return sendJson(res, 400, { error: '会话已过期，请重新获取验证码' });
      }

      try {
        const captcha = body.ticket && body.randstr ? { ticket: body.ticket, randstr: body.randstr } : undefined;
        const authenticated = await verifyLoginCode(session.config, phone, code, { captcha });

        saveConfig(authenticated);
        pendingSessions.delete(phone);
        appendLog(`用户 [${authenticated.session.heybox_id}] 登录成功并已更新凭证`);

        return sendJson(res, 200, {
          success: true,
          message: '登录成功',
          profile: authenticated.profile
        });
      } catch (err) {
        appendLog(`验证码校验失败: ${err.message}`);
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 4. API: Run Tasks Manually
    if (method === 'POST' && pathname === '/api/run') {
      try {
        const result = await executeDailyTasks('手动执行');
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // 5. API: Get Schedule & Push Config
    if (method === 'GET' && pathname === '/api/schedule') {
      return sendJson(res, 200, {
        ...schedule,
        nextRun: computeNextRun()
      });
    }

    // 6. API: Update Schedule & Push Config
    if (method === 'POST' && pathname === '/api/schedule') {
      const body = await parseBody(req);
      if (typeof body.enabled === 'boolean') schedule.enabled = body.enabled;
      if (body.time && /^\d{2}:\d{2}$/.test(body.time)) {
        schedule.time = body.time;
        const [h, m] = body.time.split(':');
        schedule.cron = `${parseInt(m, 10)} ${parseInt(h, 10)} * * *`;
      }
      if (body.cron) schedule.cron = body.cron;

      if (body.pushplus && typeof body.pushplus === 'object') {
        schedule.pushplus = {
          enabled: Boolean(body.pushplus.enabled),
          token: String(body.pushplus.token || '').trim(),
          topic: String(body.pushplus.topic || '').trim()
        };
      }

      saveSchedule();
      appendLog(`设置已更新: 定时=${schedule.enabled} (${schedule.time}), PushPlus=${schedule.pushplus?.enabled ? '已开启' : '已关闭'}`);

      return sendJson(res, 200, {
        success: true,
        schedule: {
          ...schedule,
          nextRun: computeNextRun()
        }
      });
    }

    // 7. API: Test PushPlus Notification
    if (method === 'POST' && pathname === '/api/notify/test') {
      const body = await parseBody(req);
      const token = body.token || schedule.pushplus?.token || process.env.PUSHPLUS_TOKEN;
      const topic = body.topic ?? schedule.pushplus?.topic ?? '';

      if (!token) {
        return sendJson(res, 400, { error: '请先填写 PushPlus Token' });
      }

      try {
        const beijingTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const title = '🔔 小黑盒每日任务 - PushPlus 测试通知';
        const content = [
          '### 🔔 PushPlus 推送配置测试成功！',
          '- **通知模块**：Heybox Daily Web 控制台',
          '- **测试时间**：' + beijingTime,
          '- **状态**：微信消息通道连通正常。后续每日任务完成或出现异常时，均会自动向您推送执行结果与收益明细。'
        ].join('\n\n');

        const result = await sendPushPlus({ token, topic, title, content });
        appendLog(`[PushPlus] 测试推送发送成功`);
        return sendJson(res, 200, { success: true, message: '测试消息发送成功，请前往微信查收！', data: result });
      } catch (err) {
        appendLog(`[PushPlus] 测试推送失败: ${err.message}`);
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 8. API: Get Logs
    if (method === 'GET' && pathname === '/api/logs') {
      let fileLogs = [];
      try {
        if (fs.existsSync(CRON_LOG_FILE)) {
          const content = fs.readFileSync(CRON_LOG_FILE, 'utf8');
          fileLogs = content.split('\n').filter(Boolean).slice(-150);
        }
      } catch {}
      return sendJson(res, 200, {
        logs: fileLogs.length > 0 ? fileLogs : recentLogs
      });
    }

    // 9. Serve Frontend (index.html)
    if ((method === 'GET' || method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
      const htmlPath = path.join(__dirname, 'index.html');
      if (fs.existsSync(htmlPath)) {
        if (method === 'HEAD') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end();
        }
        const html = fs.readFileSync(htmlPath, 'utf8');
        return sendText(res, 200, html, 'text/html');
      }
      return sendText(res, 404, 'Not Found');
    }

    sendJson(res, 404, { error: 'Not Found' });
  } catch (err) {
    console.error('Unhandled request error:', err);
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  appendLog(`Heybox Daily Web 服务已启动: http://0.0.0.0:${PORT}`);
});
