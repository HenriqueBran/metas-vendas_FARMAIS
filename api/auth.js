const crypto = require('crypto');

const PREFIX = 'farmais-tiete:metas-vendas:reset-2026-07-07';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 60);
}

function validateUsername(username) {
  return typeof username === 'string' && username.length >= 3 && username.length <= 60;
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex'));
    });
  });
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
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok:false, error:'Método não permitido.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = String(body.action || '');
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');

    if (!validateUsername(username)) {
      return send(res, 400, { ok:false, error:'Usuário inválido. Use pelo menos 3 letras ou números.' });
    }

    if (password.length < 4) {
      return send(res, 400, { ok:false, error:'A senha precisa ter pelo menos 4 caracteres.' });
    }

    const key = `${PREFIX}:users:${username}`;

    if (action === 'register') {
      const exists = await redisCommand(['EXISTS', key]);
      if (Number(exists) === 1) {
        return send(res, 409, { ok:false, error:'Esse usuário já existe.' });
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = await hashPassword(password, salt);
      const user = {
        username,
        salt,
        passwordHash,
        createdAt: new Date().toISOString()
      };

      await redisCommand(['SET', key, JSON.stringify(user)]);
      await redisCommand(['SADD', `${PREFIX}:users`, username]);

      return send(res, 200, { ok:true, user:{username} });
    }

    if (action === 'login') {
      const saved = await redisCommand(['GET', key]);
      if (!saved) {
        return send(res, 401, { ok:false, error:'Usuário ou senha incorretos.' });
      }

      const user = JSON.parse(saved);
      const passwordHash = await hashPassword(password, user.salt);

      if (passwordHash !== user.passwordHash) {
        return send(res, 401, { ok:false, error:'Usuário ou senha incorretos.' });
      }

      return send(res, 200, { ok:true, user:{username} });
    }

    return send(res, 400, { ok:false, error:'Ação inválida.' });
  } catch (error) {
    return send(res, error.statusCode || 500, { ok:false, error:error.message || 'Erro interno.' });
  }
};
