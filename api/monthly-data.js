const PREFIX = 'farmais-tiete:metas-vendas:reset-2026-07-07';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function validateMonth(month) {
  return typeof month === 'string' && /^\d{4}-\d{2}$/.test(month);
}

function isCurrentMonthRequest(month) {
  return month === 'current';
}

function isMonthsRequest(month) {
  return month === 'months';
}

function normalizeUser(user) {
  const value = String(user || 'sem-login').trim().toLowerCase();
  return value.replace(/[^a-z0-9._-]/g, '') || 'sem-login';
}

function readBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function sessionKey(token) {
  return `${PREFIX}:sessions:${token}`;
}

async function getAuthenticatedUser(req) {
  const token = readBearerToken(req);
  if (!token) {
    const error = new Error('Sessão inválida ou expirada. Faça login novamente.');
    error.statusCode = 401;
    throw error;
  }

  const saved = await redisCommand(['GET', sessionKey(token)]);
  if (!saved) {
    const error = new Error('Sessão inválida ou expirada. Faça login novamente.');
    error.statusCode = 401;
    throw error;
  }

  const session = JSON.parse(saved);
  const username = normalizeUser(session.username);
  if (!username || username === 'sem-login') {
    const error = new Error('Sessão inválida ou expirada. Faça login novamente.');
    error.statusCode = 401;
    throw error;
  }

  return username;
}

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    const error = new Error('Upstash não configurado na Vercel. Verifique as variáveis UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN.');
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok || json.error) {
    const error = new Error(json.error || `Erro Upstash ${response.status}`);
    error.statusCode = response.status || 500;
    throw error;
  }

  return json.result;
}

module.exports = async function handler(req, res) {
  try {
    const month = req.query.month;
    const user = await getAuthenticatedUser(req);

    if (isCurrentMonthRequest(month)) {
      const currentMonthKey = `${PREFIX}:users:${user}:currentMonth`;

      if (req.method === 'GET') {
        const currentMonth = await redisCommand(['GET', currentMonthKey]);
        return send(res, 200, { ok: true, user, currentMonth: currentMonth || null });
      }

      if (req.method === 'POST') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const nextMonth = body.month;

        if (!validateMonth(nextMonth)) {
          return send(res, 400, { error: 'Mês inválido. Use o formato YYYY-MM.' });
        }

        await redisCommand(['SET', currentMonthKey, nextMonth]);
        return send(res, 200, { ok: true, user, currentMonth: nextMonth });
      }
    }

    if (isMonthsRequest(month)) {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return send(res, 405, { error: 'Método não permitido.' });
      }

      const months = await redisCommand(['SMEMBERS', `${PREFIX}:users:${user}:months`]);
      return send(res, 200, { ok: true, user, months: Array.isArray(months) ? months.sort() : [] });
    }

    if (!validateMonth(month)) {
      return send(res, 400, { error: 'Mês inválido. Use o formato YYYY-MM.' });
    }

    const key = `${PREFIX}:data:${user}:${month}`;
    const currentMonthKey = `${PREFIX}:users:${user}:currentMonth`;

    if (req.method === 'GET') {
      const result = await redisCommand(['GET', key]);
      return send(res, 200, { ok: true, month, user, data: result ? JSON.parse(result) : null });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const data = body.data;

      if (!data || typeof data !== 'object') {
        return send(res, 400, { error: 'Dados inválidos.' });
      }

      data.settings = data.settings || {};
      data.settings.month = month;
      data.updatedAt = data.updatedAt || new Date().toISOString();

      await redisCommand(['SET', key, JSON.stringify(data)]);
      await redisCommand(['SADD', `${PREFIX}:users:${user}:months`, month]);
      await redisCommand(['SET', currentMonthKey, month]);

      return send(res, 200, { ok: true, month, user });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message || 'Erro interno.' });
  }
};
