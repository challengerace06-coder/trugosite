
const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const formMessage = document.getElementById('form-message');
const tabs = document.querySelectorAll('.tab');
const navButtons = document.querySelectorAll('.nav-item');
const panels = document.querySelectorAll('.dashboard-panel');
const profileName = document.getElementById('profile-name');
const loginCount = document.getElementById('login-count');
const profileDescription = document.getElementById('profile-description');
const profileStatus = document.getElementById('profile-status');
const discordState = document.getElementById('discord-state');
const discordUserCard = document.getElementById('discord-user-card');
const discordLink = document.getElementById('discord-link');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const saveProfileButton = document.getElementById('save-profile-button');

function showMessage(message, type = '') {
    formMessage.textContent = message;
    formMessage.className = `form-message ${type}`;
}

function setActivePanel(panelName) {
    panels.forEach((panel) => {
        const active = panel.dataset.panel === panelName;
        panel.classList.toggle('is-active', active);
    });

    navButtons.forEach((button) => {
        const active = button.dataset.panel === panelName;
        button.classList.toggle('is-active', active);
    });
}

function applyTheme(theme) {
    const finalTheme = theme === 'dark' ? 'dark' : 'light';
    document.body.dataset.theme = finalTheme;
    darkModeToggle.checked = finalTheme === 'dark';
}

function renderDiscord(account) {
    if (!account.discord) {
        discordState.textContent = 'Aucun compte Discord associé.';
        discordUserCard.innerHTML = '';
        discordLink.textContent = 'Connecter mon compte Trugosia à Discord';
        discordLink.classList.remove('is-hidden');
        return;
    }

    const avatar = account.discord.avatar
        ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(account.discord.id)}/${encodeURIComponent(account.discord.avatar)}.png?size=96`
        : 'https://cdn.discordapp.com/embed/avatars/0.png';

    discordState.textContent = 'Compte Discord bien associé.';
    discordUserCard.innerHTML = `
        <div class="discord-row">
            <img class="discord-avatar" src="${avatar}" alt="Avatar Discord" />
            <div>
                <strong>${escapeHtml(account.discord.username)}</strong>
                <small>${account.discord.discriminator && account.discord.discriminator !== '0' ? `#${escapeHtml(account.discord.discriminator)}` : '@discord'}</small>
            </div>
        </div>
    `;
    discordLink.textContent = 'Reconnecter mon compte Discord';
    discordLink.classList.remove('is-hidden');
}

function showDashboard(account) {
    authView.classList.add('is-hidden');
    dashboardView.classList.remove('is-hidden');
    profileName.textContent = account.identifier;
    loginCount.textContent = String(account.loginCount || 0);
    profileDescription.value = account.description || '';
    profileStatus.textContent = '';
    renderDiscord(account);
    applyTheme(account.theme || 'light');
    setActivePanel('profile');
}

function showAuth() {
    dashboardView.classList.add('is-hidden');
    authView.classList.remove('is-hidden');
    profileStatus.textContent = '';
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
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
        showDashboard(account);
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
        showDashboard(account);
    } catch (error) {
        showMessage(error.message, 'error');
    }
});

async function logout() {
    try {
        await request('/api/logout', { method: 'POST' });
    } catch (error) {
        console.warn(error);
    } finally {
        showAuth();
    }
}

navButtons.forEach((button) => {
    button.addEventListener('click', () => setActivePanel(button.dataset.panel));
});

saveProfileButton.addEventListener('click', async () => {
    const description = profileDescription.value.trim();
    try {
        const account = await request('/api/account/update', {
            method: 'POST',
            body: JSON.stringify({ description, theme: document.body.dataset.theme === 'dark' ? 'dark' : 'light' })
        });
        profileStatus.textContent = 'Description enregistrée.';
        profileStatus.className = 'status-text success';
        profileName.textContent = account.identifier;
        profileDescription.value = account.description || '';
        applyTheme(account.theme || 'light');
    } catch (error) {
        profileStatus.textContent = error.message;
        profileStatus.className = 'status-text error';
    }
});

document.getElementById('logout-button').addEventListener('click', logout);
document.getElementById('header-logout-button').addEventListener('click', logout);

darkModeToggle.addEventListener('change', async () => {
    const theme = darkModeToggle.checked ? 'dark' : 'light';
    applyTheme(theme);
    try {
        await request('/api/account/update', {
            method: 'POST',
            body: JSON.stringify({ description: profileDescription.value.trim(), theme })
        });
    } catch (error) {
        console.warn(error);
    }
});

document.getElementById('delete-account-button').addEventListener('click', async () => {
    const confirmDelete = window.confirm('Voulez-vous vraiment supprimer votre compte Trugosia ?');
    if (!confirmDelete) return;

    try {
        await request('/api/account/delete', { method: 'POST' });
        showAuth();
        showMessage('Votre compte a bien été supprimé.', 'success');
    } catch (error) {
        profileStatus.textContent = error.message;
        profileStatus.className = 'status-text error';
    }
});

const query = new URLSearchParams(window.location.search);
if (query.get('discord') === 'linked') {
    showMessage('Compte Discord lié avec succès.', 'success');
    window.history.replaceState({}, document.title, window.location.pathname);
}

if (query.get('discord') === 'error') {
    const reason = {
        oauth_non_configure: 'La liaison Discord n’est pas encore configurée sur le serveur.',
        session_expiree: 'Votre session a expiré. Reconnectez-vous avant de lier Discord.',
        echange_discord_refuse: 'Discord a refusé la liaison. Vérifiez la Redirect URI et les identifiants OAuth2.',
        discord_deja_lie: 'Ce compte Discord est déjà lié à un autre compte Trugosia.'
    }[query.get('reason')] || 'La liaison Discord a échoué. Vérifiez la configuration OAuth2.';
    showMessage(reason, 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
}

request('/api/account').then(showDashboard).catch(() => showAuth());