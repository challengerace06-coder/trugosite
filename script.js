const loadingView = document.getElementById('loading-view');
const authView = document.getElementById('auth-view');
const lobbyView = document.getElementById('lobby-view');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const formMessage = document.getElementById('form-message');
const welcomeUser = document.getElementById('welcome-user');
const tabs = document.querySelectorAll('.tab');
const character = document.getElementById('character');
const panel = document.getElementById('lobby-panel');
const panelBackdrop = document.getElementById('panel-backdrop');
const panelContent = document.getElementById('panel-content');
let characterRotation = 0;
let currentAccount = null;

function showMessage(message, type = '') {
    formMessage.textContent = message;
    formMessage.className = `form-message ${type}`;
}

function showLobby(account) {
    currentAccount = account;
    loadingView.classList.add('is-hidden');
    authView.classList.add('is-hidden');
    lobbyView.classList.remove('is-hidden');
    welcomeUser.textContent = `Connecté en tant que ${account.identifier}`;
    document.querySelector('.avatar-player').textContent = account.identifier.charAt(0).toUpperCase();
}

function showAuth(message = '', type = '') {
    loadingView.classList.add('is-hidden');
    lobbyView.classList.add('is-hidden');
    authView.classList.remove('is-hidden');
    closePanel();
    showMessage(message, type);
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

function openPanel(title, subtitle, content, actionLabel = '') {
    panelContent.innerHTML = `<p class="eyebrow">TRUGOSIA // MENU</p><h2 class="panel-content-title">${title}</h2><p class="panel-content-subtitle">${subtitle}</p>${content}${actionLabel ? `<button class="panel-action" type="button">${actionLabel}</button>` : ''}`;
    panel.classList.remove('is-hidden');
    panelBackdrop.classList.remove('is-hidden');
}

function closePanel() {
    panel.classList.add('is-hidden');
    panelBackdrop.classList.add('is-hidden');
}

function accountPanel() {
    const discord = currentAccount?.discord;
    const discordLabel = discord ? `Discord lié : ${escapeHtml(discord.username)}` : 'Aucun compte Discord lié';
    openPanel('Profil', 'Votre identité dans la zone.', `<div class="panel-stat"><span>Joueur</span><strong>${escapeHtml(currentAccount?.identifier || '')}</strong></div><div class="panel-stat"><span>Rang</span><strong>Explorateur</strong></div><div class="panel-stat"><span>Connexion</span><strong>${discordLabel}</strong></div>`, discord ? '' : 'LIER MON COMPTE DISCORD');
}

function friendsPanel() {
    openPanel('Ajouter', 'Trouvez vos amis et consultez leur profil.', '<div class="panel-stat"><span>Amis en ligne</span><strong>0 / 12</strong></div><div class="panel-stat"><span>Invitations</span><strong>aucune</strong></div><button class="panel-action" type="button">AJOUTER UN AMI</button>');
}

function teamsPanel() {
    openPanel('Équipe', 'Formez une escouade avant de lancer la partie.', '<div class="panel-stat"><span>Votre escouade</span><strong>Solo</strong></div><div class="panel-stat"><span>Places disponibles</span><strong>3</strong></div><button class="panel-action" type="button">CRÉER UNE ÉQUIPE</button>');
}

function storePanel() {
    openPanel('Magasin', 'Équipez votre personnage pour la prochaine mission.', '<div class="panel-stat"><span>Skin recommandé</span><strong>Neon scout</strong></div><div class="panel-stat"><span>Prix</span><strong>850 crédits</strong></div><button class="panel-action" type="button">VOIR LES OBJETS</button>');
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
        showLobby(account);
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
        showLobby(account);
    } catch (error) {
        showMessage(error.message, 'error');
    }
});

document.getElementById('logout-button').addEventListener('click', async () => {
    await request('/api/logout', { method: 'POST' });
    currentAccount = null;
    showAuth();
});

document.getElementById('profile-button').addEventListener('click', accountPanel);
document.getElementById('friends-button').addEventListener('click', friendsPanel);
document.getElementById('teams-button').addEventListener('click', teamsPanel);
document.getElementById('store-button').addEventListener('click', storePanel);
document.getElementById('wallet-button').addEventListener('click', () => openPanel('Crédits', 'Votre réserve pour les prochains équipements.', '<div class="panel-stat"><span>Solde disponible</span><strong>1 250 crédits</strong></div><div class="panel-stat"><span>Bonus quotidien</span><strong>+ 100 crédits</strong></div>', 'RÉCUPÉRER LE BONUS'));
document.getElementById('play-button').addEventListener('click', (event) => {
    const button = event.currentTarget;
    button.querySelector('strong').textContent = 'EN FILE';
    button.querySelector('small').textContent = 'RECHERCHE D\'UNE PARTIE';
    button.querySelector('.play-arrow').textContent = '...';
});
document.getElementById('panel-close').addEventListener('click', closePanel);
panelBackdrop.addEventListener('click', closePanel);

character.addEventListener('click', () => {
    characterRotation += 45;
    character.style.transform = `rotateY(${characterRotation}deg)`;
});
character.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    characterRotation += event.key === 'ArrowRight' ? 45 : -45;
    character.style.transform = `rotateY(${characterRotation}deg)`;
});

const query = new URLSearchParams(window.location.search);
const authMessage = query.get('discord') === 'linked' ? 'Compte Discord lié avec succès.' : query.get('discord') === 'error' ? 'La liaison Discord a échoué. Réessayez.' : '';

setTimeout(() => {
    request('/api/account').then(showLobby).catch(() => showAuth(authMessage, authMessage ? 'success' : ''));
}, 1550);
