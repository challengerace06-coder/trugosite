const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/api/discord/callback`;
const DATA_FILE = path.join(__dirname, 'data', 'users.json');
const sessions = new Map();
const oauthStates = new Map();

if (!BOT_TOKEN) {
    console.error('DISCORD_BOT_TOKEN est manquant. Copiez .env.example vers .env et ajoutez un nouveau token.');
}

function loadEnvFile() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
}

function readUsers() {
    if (!fs.existsSync(DATA_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (error) {
        console.warn('Le fichier users.json est invalide. Reset en cours.');
        return {};
    }
}

function writeUsers(users) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(`${salt}:${derivedKey.toString('hex')}`);
    }));
}

async function passwordMatches(password, storedHash) {
    const [salt, key] = storedHash.split(':');
    const derived = await hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(derived.split(':')[1], 'hex'), Buffer.from(key, 'hex'));
}

function parseCookies(request) {
    return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }));
}

function sendJson(response, status, data, headers = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    response.end(JSON.stringify(data));
}

function publicAccount(user, discord = null) {
    return {
        identifier: user.identifier,
        createdAt: user.createdAt,
        loginCount: Number(user.loginCount || 0),
        description: typeof user.description === 'string' ? user.description : '',
        theme: user.theme === 'dark' ? 'dark' : 'light',
        discord
    };
}

function publicSiteUrl() {
    return process.env.PUBLIC_SITE_URL || `http://localhost:${PORT}`;
}

function authError(response, reason) {
    console.error(`Discord OAuth error: ${reason}`);
    return redirect(response, `${publicSiteUrl()}/?discord=error&reason=${encodeURIComponent(reason)}`);
}

async function exchangeDiscordCode(code) {
    const body = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI
    });
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!tokenResponse.ok) throw new Error('Discord OAuth token exchange failed.');
    const tokens = await tokenResponse.json();
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    if (!userResponse.ok) throw new Error('Discord user lookup failed.');
    return userResponse.json();
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.on('data', (chunk) => { body += chunk; if (body.length > 10000) request.destroy(); });
        request.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch {
                reject(new Error('JSON invalide.'));
            }
        });
        request.on('error', reject);
    });
}

async function handleApi(request, response, pathname) {
    const users = readUsers();

    if (pathname === '/api/discord/start' && request.method === 'GET') {
        const cookie = parseCookies(request);
        const sessionUser = users[sessions.get(cookie.trugosia_session)];
        if (!sessionUser) return authError(response, 'session_expiree');
        if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) return authError(response, 'oauth_non_configure');
        const state = crypto.randomBytes(24).toString('hex');
        oauthStates.set(state, { identifier: sessionUser.identifier, expiresAt: Date.now() + 300000 });
        const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: DISCORD_REDIRECT_URI, scope: 'identify', state });
        console.log(`Discord OAuth started for ${sessionUser.identifier} with redirect ${DISCORD_REDIRECT_URI}`);
        return redirect(response, `https://discord.com/oauth2/authorize?${params}`);
    }

    if (pathname === '/api/discord/callback' && request.method === 'GET') {
        const query = new URL(request.url, `http://${request.headers.host}`).searchParams;
        const stateData = oauthStates.get(query.get('state'));
        oauthStates.delete(query.get('state'));
        if (!stateData || stateData.expiresAt < Date.now()) return authError(response, 'etat_oauth_expire');
        if (query.get('error')) return authError(response, `discord_${query.get('error')}`);
        if (!query.get('code')) return authError(response, 'code_discord_manquant');

        let discord;
        try {
            discord = await exchangeDiscordCode(query.get('code'));
        } catch (error) {
            console.error(error);
            return authError(response, 'echange_discord_refuse');
        }

        const linkedUser = users[stateData.identifier];
        if (!linkedUser) return authError(response, 'compte_trugosia_introuvable');

        const alreadyLinked = Object.values(users).some((user) => user.identifier !== linkedUser.identifier && user.discord && user.discord.id === discord.id);
        if (alreadyLinked) return authError(response, 'discord_deja_lie');

        linkedUser.discord = { id: discord.id, username: discord.username, discriminator: discord.discriminator, avatar: discord.avatar };
        writeUsers(users);
        return redirect(response, `${publicSiteUrl()}/?discord=linked`);
    }

    if (pathname === '/api/register' && request.method === 'POST') {
        const { identifier, password } = await readBody(request);
        const normalized = String(identifier || '').trim().toLowerCase();
        if (!/^[a-z0-9_.-]{3,32}$/.test(normalized) || String(password || '').length < 6) return sendJson(response, 400, { error: 'Identifiant ou mot de passe invalide.' });
        if (users[normalized]) return sendJson(response, 409, { error: 'Cet identifiant est déjà utilisé.' });

        const user = {
            identifier: normalized,
            passwordHash: await hashPassword(password),
            createdAt: new Date().toISOString(),
            loginCount: 0,
            description: '',
            theme: 'light'
        };

        users[normalized] = user;
        writeUsers(users);
        return createSession(response, user);
    }

    if (pathname === '/api/login' && request.method === 'POST') {
        const { identifier, password } = await readBody(request);
        const user = users[String(identifier || '').trim().toLowerCase()];
        if (!user || !(await passwordMatches(String(password || ''), user.passwordHash))) return sendJson(response, 401, { error: 'Identifiant ou mot de passe incorrect.' });

        user.loginCount = Number(user.loginCount || 0) + 1;
        user.lastLoginAt = new Date().toISOString();
        writeUsers(users);
        return createSession(response, user);
    }

    if (pathname === '/api/account' && request.method === 'GET') {
        const user = users[sessions.get(parseCookies(request).trugosia_session)];
        if (!user) return sendJson(response, 401, { error: 'Non connecté.' });
        return sendJson(response, 200, publicAccount(user, user.discord || null));
    }

    if (pathname === '/api/account/update' && request.method === 'POST') {
        const token = parseCookies(request).trugosia_session;
        const user = users[sessions.get(token)];
        if (!user) return sendJson(response, 401, { error: 'Non connecté.' });

        const { description, theme } = await readBody(request);
        const cleanDescription = String(description || '').trim().slice(0, 240);
        const cleanTheme = theme === 'dark' ? 'dark' : 'light';

        user.description = cleanDescription;
        user.theme = cleanTheme;
        writeUsers(users);

        return sendJson(response, 200, publicAccount(user, user.discord || null));
    }

    if (pathname === '/api/account/delete' && request.method === 'POST') {
        const token = parseCookies(request).trugosia_session;
        const identifier = sessions.get(token);
        if (!identifier) return sendJson(response, 401, { error: 'Non connecté.' });

        delete users[identifier];
        sessions.delete(token);
        writeUsers(users);

        return sendJson(response, 200, { ok: true }, { 'Set-Cookie': 'trugosia_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' });
    }

    if (pathname === '/api/logout' && request.method === 'POST') {
        sessions.delete(parseCookies(request).trugosia_session);
        return sendJson(response, 200, { ok: true }, { 'Set-Cookie': 'trugosia_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' });
    }

    sendJson(response, 404, { error: 'Route introuvable.' });
}

async function createSession(response, user) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, user.identifier);
    return sendJson(response, 200, publicAccount(user, user.discord || null), { 'Set-Cookie': `trugosia_session=${token}; HttpOnly; Path=/; SameSite=Lax` });
}

function redirect(response, location) {
    response.writeHead(302, { Location: location });
    response.end();
}

function serveStatic(response, pathname) {
    const requested = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(__dirname, requested);
    if (!filePath.startsWith(__dirname) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return sendJson(response, 404, { error: 'Page introuvable.' });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    try {
        if (pathname.startsWith('/api/')) await handleApi(request, response, pathname);
        else serveStatic(response, pathname);
    } catch (error) {
        console.error(error);
        sendJson(response, 500, { error: 'Erreur interne du serveur.' });
    }
});

server.listen(PORT, () => console.log(`Trugosia est disponible sur http://localhost:${PORT}`));