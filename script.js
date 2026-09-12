
const authView = document.getElementById('auth-view');
const welcomeView = document.getElementById('welcome-view');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const formMessage = document.getElementById('form-message');
const welcomeUser = document.getElementById('welcome-user');
const tabs = document.querySelectorAll('.tab');

const accountDetails = document.getElementById('account-details');

function showMessage(message, type = '') {
    formMessage.textContent = message;
    formMessage.className = `form-message ${type}`;
}

function showWelcome(account) {
    authView.classList.add('is-hidden');
    welcomeView.classList.remove('is-hidden');
    welcomeUser.textContent = `Ravi de vous revoir, ${account.identifier}.`;
    accountDetails.innerHTML = `
        <p class="details-label">Votre compte</p>
        <p><strong>${escapeHtml(account.identifier)}</strong></p>
        ${account.discord ? `<p class="discord-account">${account.discord.avatar ? `<img class="discord-avatar" src="https://cdn.discordapp.com/avatars/${encodeURIComponent(account.discord.id)}/${encodeURIComponent(account.discord.avatar)}.png?size=64" alt="">` : '<span class="discord-status"></span>'}${escapeHtml(account.discord.username)}${account.discord.discriminator && account.discord.discriminator !== '0' ? `#${escapeHtml(account.discord.discriminator)}` : ''}</p><p class="details-muted">Compte Discord associé</p>` : '<p class="details-muted">Aucun compte Discord associé.</p>'}`;
    document.getElementById('discord-link').classList.toggle('is-hidden', Boolean(account.discord));
}

function showAuth() {
    welcomeView.classList.add('is-hidden');
    authView.classList.remove('is-hidden');
    accountDetails.innerHTML = '';
    document.getElementById('discord-link').classList.remove('is-hidden');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
}

async function request(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Une erreur est survenue.');
    return body;
}

tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
        const isLogin = tab.dataset.mode === 'login';
        tabs.forEach((item) => {
            const active = item === tab;
            item.classList.toggle('is-active', active);
            item.setAttribute('aria-selected', active);
        });
        loginForm.classList.toggle('is-hidden', !isLogin);
        registerForm.classList.toggle('is-hidden', isLogin);
        showMessage('');
    });
});

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(loginForm);
    try {
        const account = await request('/api/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(data)) });
        loginForm.reset();
        showWelcome(account);
    } catch (error) {
        showMessage(error.message, 'error');
    }
});

registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(registerForm);
    try {
        const account = await request('/api/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(data)) });
        registerForm.reset();
        showWelcome(account);
    } catch (error) {
        showMessage(error.message, 'error');
    }
});

document.getElementById('logout-button').addEventListener('click', async () => {
    await request('/api/logout', { method: 'POST' });
    showAuth();
});

const query = new URLSearchParams(window.location.search);
if (query.get('discord') === 'linked') showMessage('Compte Discord lié avec succès.', 'success');
if (query.get('discord') === 'error') showMessage('La liaison Discord a échoué. Réessayez.', 'error');
request('/api/account').then(showWelcome).catch(() => showAuth());