const PREFIX = process.env.APP_STORAGE_PREFIX || 'farmais-tiete:metas-vendas';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function validateMonth(month) {
  return typeof month === 'string' && /^\d{4}-\d{2}$/.test(month);
}

function normalizeUser(user) {
  const value = String(user || 'sem-login').trim().toLowerCase();
  return value.replace(/[^a-z0-9._-]/g, '') || 'sem-login';
}

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    const error = new Error('Variáveis UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN não configuradas.');
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
    const user = normalizeUser(req.query.user || (req.body && req.body.user));

    if (!validateMonth(month)) {
      return send(res, 400, { error: 'Mês inválido. Use o formato YYYY-MM.' });
    }

    const key = `${PREFIX}:data:${user}:${month}`;

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

      return send(res, 200, { ok: true, month, user });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message || 'Erro interno.' });
  }
};
