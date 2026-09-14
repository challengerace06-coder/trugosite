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
const onlineUsers = new Set();
const presenceState = new Map();

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
    const ratings = user.picnote && Array.isArray(user.picnote.ratings) ? user.picnote.ratings : [];
    return {
        identifier: user.identifier,
        createdAt: user.createdAt,
        loginCount: Number(user.loginCount || 0),
        description: typeof user.description === 'string' ? user.description : '',
        theme: user.theme === 'dark' ? 'dark' : 'light',
        avatar: typeof user.avatar === 'string' ? user.avatar : '',
        backgroundColor: typeof user.backgroundColor === 'string' ? user.backgroundColor : '#f6f8f5',
        picnoteRatings: ratings,
        discord
    };
}

function ensurePicnote(user) {
    user.picnote = user.picnote || {};
    user.picnote.photos = Array.isArray(user.picnote.photos) ? user.picnote.photos : [];
    user.picnote.seen = Array.isArray(user.picnote.seen) ? user.picnote.seen : [];
    user.picnote.ratings = Array.isArray(user.picnote.ratings) ? user.picnote.ratings : [];
    return user.picnote;
}

function normalizeIdentifier(value) {
    return String(value || '').trim().toLowerCase();
}

function userPresence(identifier) {
    const state = presenceState.get(identifier) || {};
    return {
        identifier,
        online: onlineUsers.has(identifier),
        typing: Boolean(state.typing),
        voice: Boolean(state.voice),
        inChat: Boolean(state.inChat)
    };
}

function publicContact(users, identifier) {
    const contact = users[identifier] || {};
    return {
        identifier,
        online: onlineUsers.has(identifier),
        typing: Boolean((presenceState.get(identifier) || {}).typing),
        voice: Boolean((presenceState.get(identifier) || {}).voice),
        inChat: Boolean((presenceState.get(identifier) || {}).inChat),
        avatar: typeof contact.avatar === 'string' ? contact.avatar : '',
        description: typeof contact.description === 'string' ? contact.description : ''
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
        request.on('data', (chunk) => { body += chunk; if (body.length > 2000000) request.destroy(); });
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
        const normalized = normalizeIdentifier(identifier);
        if (!/^[a-z0-9_.-]{3,32}$/.test(normalized) || String(password || '').length < 6) return sendJson(response, 400, { error: 'Identifiant ou mot de passe invalide.' });
        if (users[normalized]) return sendJson(response, 409, { error: 'Cet identifiant est déjà utilisé.' });

        const user = {
            identifier: normalized,
            passwordHash: await hashPassword(password),
            createdAt: new Date().toISOString(),
            loginCount: 0,
            description: '',
            theme: 'light',
            avatar: '',
            backgroundColor: '#f6f8f5',
            picnote: { photos: [], seen: [], ratings: [] },
            contacts: [],
            chats: {}
        };

        users[normalized] = user;
        writeUsers(users);
        onlineUsers.add(user.identifier);
        presenceState.set(user.identifier, { typing: false, voice: false, inChat: false });
        return createSession(response, user);
    }

    if (pathname === '/api/login' && request.method === 'POST') {
        const { identifier, password } = await readBody(request);
        const user = users[normalizeIdentifier(identifier)];
        if (!user || !(await passwordMatches(String(password || ''), user.passwordHash))) return sendJson(response, 401, { error: 'Identifiant ou mot de passe incorrect.' });

        user.loginCount = Number(user.loginCount || 0) + 1;
        user.lastLoginAt = new Date().toISOString();
        user.contacts = Array.isArray(user.contacts) ? user.contacts : [];
        user.chats = user.chats || {};
        user.avatar = typeof user.avatar === 'string' ? user.avatar : '';
        user.backgroundColor = typeof user.backgroundColor === 'string' ? user.backgroundColor : '#f6f8f5';
        ensurePicnote(user);
        writeUsers(users);
        onlineUsers.add(user.identifier);
        presenceState.set(user.identifier, { typing: false, voice: false, inChat: false });
        return createSession(response, user);
    }

    if (pathname === '/api/account' && request.method === 'GET') {
        const user = users[sessions.get(parseCookies(request).trugosia_session)];
        if (!user) return sendJson(response, 401, { error: 'Non connecté.' });
        return sendJson(response, 200, publicAccount(user, user.discord || null));
    }

    if (pathname === '/api/picnote/feed' && request.method === 'GET') {
        const token = parseCookies(request).trugosia_session;
        const currentUser = users[sessions.get(token)];
        if (!currentUser) return sendJson(response, 401, { error: 'Non connecté.' });

        const currentPicnote = ensurePicnote(currentUser);
        const seen = new Set(currentPicnote.seen);
        const photos = Object.values(users)
            .filter((user) => user.identifier !== currentUser.identifier)
            .flatMap((user) => ensurePicnote(user).photos.map((photo) => ({
                ...photo,
                owner: user.identifier,
                ownerAvatar: typeof user.avatar === 'string' ? user.avatar : ''
            })))
            .filter((photo) => !seen.has(photo.id));

        return sendJson(response, 200, { photos });
    }

    if (pathname === '/api/picnote/photo' && request.method === 'POST') {
        const token = parseCookies(request).trugosia_session;
        const currentUser = users[sessions.get(token)];
        if (!currentUser) return sendJson(response, 401, { error: 'Non connecté.' });

        const { image } = await readBody(request);
        if (typeof image !== 'string' || !/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(image) || image.length > 1500000) {
            return sendJson(response, 400, { error: 'Photo invalide ou trop volumineuse.' });
        }

        const picnote = ensurePicnote(currentUser);
        picnote.photos.unshift({ id: crypto.randomUUID(), image, createdAt: new Date().toISOString() });
        writeUsers(users);
        return sendJson(response, 201, { ok: true });
    }

    if (pathname === '/api/picnote/rate' && request.method === 'POST') {
        const token = parseCookies(request).trugosia_session;
        const currentUser = users[sessions.get(token)];
        if (!currentUser) return sendJson(response, 401, { error: 'Non connecté.' });

        const { photoId, action, score } = await readBody(request);
        const photoOwner = Object.values(users).find((user) => ensurePicnote(user).photos.some((photo) => photo.id === photoId));
        if (!photoOwner || photoOwner.identifier === currentUser.identifier) return sendJson(response, 404, { error: 'Photo introuvable.' });

        const currentPicnote = ensurePicnote(currentUser);
        if (!currentPicnote.seen.includes(photoId)) currentPicnote.seen.push(photoId);
        const normalizedScore = Number.isFinite(Number(score)) ? Math.max(0, Math.min(20, Math.round(Number(score)))) : null;
        if (normalizedScore !== null) {
            ensurePicnote(photoOwner).ratings.push({ id: crypto.randomUUID(), photoId, from: currentUser.identifier, score: normalizedScore, createdAt: new Date().toISOString() });
        }
        writeUsers(users);
        return sendJson(response, 200, { ok: true, action: action === 'like' ? 'like' : 'dislike', score: normalizedScore });
    }

    if (pathname === '/api/account/update' && request.method === 'POST') {
        const token = parseCookies(request).trugosia_session;
        const user = users[sessions.get(token)];
        if (!user) return sendJson(response, 401, { error: 'Non connecté.' });

        const { description, theme, avatar, backgroundColor } = await readBody(request);
        const cleanDescription = String(description || '').trim().slice(0, 240);
        const cleanTheme = theme === 'dark' ? 'dark' : 'light';
        const cleanAvatar = typeof avatar === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(avatar) && avatar.length <= 1500000 ? avatar : '';
        const cleanBackground = typeof backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor : '#f6f8f5';

        user.description = cleanDescription;
        user.theme = cleanTheme;
        user.avatar = cleanAvatar;
        user.backgroundColor = cleanBackground;
        writeUsers(users);

        return sendJson(response, 200, publicAccount(user, user.discord || null));
    }

    if (pathname === '/api/account/delete' && request.method === 'POST') {
        const token = parseCookies(request).trugosia_session;
        const identifier = sessions.get(token);
        if (!identifier) return sendJson(response, 401, { error: 'Non connecté.' });

        delete users[identifier];
        sessions.delete(token);
        onlineUsers.delete(identifier);
        presenceState.delete(identifier);
        writeUsers(users);

        return sendJson(response, 200, { ok: true }, { 'Set-Cookie': 'trugosia_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' });
    }

    if (pathname === '/api/logout' && request.method === 'POST') {
        const token = parseCookies(request).trugosia_session;
        const identifier = sessions.get(token);
        if (identifier) {
            onlineUsers.delete(identifier);
            presenceState.delete(identifier);
        }
        sessions.delete(token);
        return sendJson(response, 200, { ok: true }, { 'Set-Cookie': 'trugosia_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' });
    }

    if (pathname === '/api/users/search' && request.method === 'GET') {
        const token = parseCookies(request).trugosia_session;
        const currentUser = users[sessions.get(token)];
        if (!currentUser) return sendJson(response, 401, { error: 'Non connecté.' });

        const query = normalizeIdentifier(new URL(request.url, `http://${request.headers.host}`).searchParams.get('q') || '');
        const matches = Object.keys(users)
            .filter((identifier) => identifier !== currentUser.identifier)
            .filter((identifier) => !query || identifier.includes(query))
            .map((identifier) => {
                const user = users[identifier];
                return {
                    identifier,
                    online: onlineUsers.has(identifier),
                    description: typeof user.description === 'string' ? user.description : '',
                    avatar: typeof user.avatar === 'string' ? user.avatar : '',
                    inContacts: Array.isArray(currentUser.contacts) && currentUser.contacts.includes(identifier)
                };
            });

        return sendJson(response, 200, { users: matches });
    }

    if (pathname === '/api/contact/add' && request.method === 'POST') {
        const token = parseCookies(request).trugosia_session;
        const currentUser = users[sessions.get(token)];
        if (!currentUser) return sendJson(response, 401, { error: 'Non connecté.' });

        const { identifier } = await readBody(request);
        const target = normalizeIdentifier(identifier);
        if (!target || target === currentUser.identifier) return sendJson(response, 400, { error: 'Identifiant invalide.' });
        if (!users[target]) return sendJson(response, 404, { error: 'Membre introuvable.' });

        currentUser.contacts = Array.isArray(currentUser.contacts) ? currentUser.contacts : [];
        currentUser.chats = currentUser.chats || {};
        currentUser.chats[target] = currentUser.chats[target] || [];

        if (!currentUser.contacts.includes(target)) currentUser.contacts.push(target);
        const peer = users[target];
        peer.contacts = Array.isArray(peer.contacts) ? peer.contacts : [];
        peer.chats = peer.chats || {};
        peer.chats[currentUser.identifier] = peer.chats[currentUser.identifier] || [];
        if (!peer.contacts.includes(currentUser.identifier)) peer.contacts.push(currentUser.identifier);

        writeUsers(users);
        return sendJson(response, 200, { ok: true, contacts: currentUser.contacts.map((member) => publicContact(users, member)) });
    }

    if (pathname === '/api/contacts' && request.method === 'GET') {
        const token = parseCookies(request).trugosia_session;
        const currentUser = users[sessions.get(token)];
        if (!currentUser) return sendJson(response, 401, { error: 'Non connecté.' });

        const contacts = (Array.isArray(currentUser.contacts) ? currentUser.contacts : [])
            .map((identifier) => publicContact(users, identifier))
            .filter((entry) => entry.identifier && entry.identifier !== currentUser.identifier);

        return sendJson(response, 200, contacts);
    }

    if (pathname === '/api/chat/send' && request.method === 'POST') {
        const token = parseCookies(request).trugosia_session;
        const currentUser = users[sessions.get(token)];
        if (!currentUser) return sendJson(response, 401, { error: 'Non connecté.' });

        const { to, text, type, image } = await readBody(request);
        const target = normalizeIdentifier(to);
        if (!target || !users[target]) return sendJson(response, 404, { error: 'Destinataire introuvable.' });

        const message = {
            id: crypto.randomUUID(),
            from: currentUser.identifier,
            to: target,
            text: typeof text === 'string' ? text.trim().slice(0, 2000) : '',
            image: typeof image === 'string' ? image : '',
            type: type === 'image' ? 'image' : type === 'voice' ? 'voice' : 'text',
            createdAt: new Date().toISOString()
        };

        currentUser.chats = currentUser.chats || {};
        users[target].chats = users[target].chats || {};
        currentUser.chats[target] = currentUser.chats[target] || [];
        users[target].chats[currentUser.identifier] = users[target].chats[currentUser.identifier] || [];

        currentUser.chats[target].push(message);
        users[target].chats[currentUser.identifier].push({ ...message, to: currentUser.identifier, from: currentUser.identifier });

        presenceState.set(currentUser.identifier, { ...(presenceState.get(currentUser.identifier) || {}), inChat: true, typing: false });
        presenceState.set(target, { ...(presenceState.get(target) || {}), inChat: true, typing: false });
        writeUsers(users);

        return sendJson(response, 200, { ok: true, message });
    }

    if (pathname === '/api/chat/status' && request.method === 'POST') {
        const token = parseCookies(request).trugosia_session;
        const currentUser = users[sessions.get(token)];
        if (!currentUser) return sendJson(response, 401, { error: 'Non connecté.' });

        const { to, typing, voice } = await readBody(request);
        const target = normalizeIdentifier(to);
        if (target && users[target]) {
            const currentPresence = presenceState.get(currentUser.identifier) || {};
            presenceState.set(currentUser.identifier, {
                ...currentPresence,
                typing: Boolean(typing),
                voice: Boolean(voice),
                inChat: true
            });
        }

        return sendJson(response, 200, { ok: true });
    }

    if (pathname.startsWith('/api/chat/') && request.method === 'GET') {
        const token = parseCookies(request).trugosia_session;
        const currentUser = users[sessions.get(token)];
        if (!currentUser) return sendJson(response, 401, { error: 'Non connecté.' });

        const peerIdentifier = decodeURIComponent(pathname.slice('/api/chat/'.length));
        const target = normalizeIdentifier(peerIdentifier);
        if (!target || !users[target]) return sendJson(response, 404, { error: 'Conversation introuvable.' });

        const messages = (currentUser.chats && currentUser.chats[target] ? currentUser.chats[target] : []).map((message) => ({
            ...message,
            from: message.from || currentUser.identifier,
            to: message.to || target
        }));

        return sendJson(response, 200, {
            peer: publicContact(users, target),
            messages
        });
    }

    sendJson(response, 404, { error: 'Route introuvable.' });
}

async function createSession(response, user) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, user.identifier);
    onlineUsers.add(user.identifier);
    presenceState.set(user.identifier, { typing: false, voice: false, inChat: false });
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