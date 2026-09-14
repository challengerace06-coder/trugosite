
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
const memberSearch = document.getElementById('member-search');
const memberSearchResults = document.getElementById('member-search-results');
const contactList = document.getElementById('contact-list');
const chatSearch = document.getElementById('chat-search');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const chatHeader = document.getElementById('chat-header');
const chatStatusBar = document.getElementById('chat-status-bar');
const sendMessageButton = document.getElementById('send-message-button');
const voiceButton = document.getElementById('voice-button');
const imageUpload = document.getElementById('image-upload');

const state = {
    account: null,
    selectedContact: null,
    contacts: [],
    typingTimer: null,
    voiceActive: false
};

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

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[character]));
}

function renderContacts(list) {
    const query = chatSearch.value.trim().toLowerCase();
    const filtered = list.filter((entry) => entry.identifier.toLowerCase().includes(query));

    if (!filtered.length) {
        contactList.innerHTML = '<div class="empty-state">Aucun membre ajouté.</div>';
        return;
    }

    contactList.innerHTML = filtered.map((contact) => `
        <button class="contact-item ${state.selectedContact === contact.identifier ? 'selected' : ''}" type="button" data-contact="${contact.identifier}">
            <div class="contact-avatar">${escapeHtml(contact.identifier.charAt(0).toUpperCase())}</div>
            <div class="contact-meta">
                <strong>${escapeHtml(contact.identifier)}</strong>
                <small>${contact.online ? 'En ligne' : 'Hors ligne'}${contact.typing ? ' · écrit...' : ''}${contact.voice ? ' · vocal...' : ''}</small>
            </div>
        </button>
    `).join('');

    contactList.querySelectorAll('.contact-item').forEach((item) => {
        item.addEventListener('click', () => selectConversation(item.dataset.contact));
    });
}

function renderMembers(results) {
    if (!results.length) {
        memberSearchResults.innerHTML = '<div class="empty-state">Aucun résultat.</div>';
        return;
    }

    memberSearchResults.innerHTML = results.map((user) => `
        <div class="member-row">
            <div>
                <strong>${escapeHtml(user.identifier)}</strong>
                <small>${user.online ? 'En ligne' : 'Hors ligne'}</small>
            </div>
            <button type="button" class="mini-add-button" data-add-member="${user.identifier}">Ajouter</button>
        </div>
    `).join('');

    memberSearchResults.querySelectorAll('[data-add-member]').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                await request('/api/contact/add', { method: 'POST', body: JSON.stringify({ identifier: button.dataset.addMember }) });
                await loadContacts();
                memberSearch.value = '';
                renderMembers([]);
                setActivePanel('chatpro');
                selectConversation(button.dataset.addMember);
            } catch (error) {
                alert(error.message);
            }
        });
    });
}

function renderConversation(messages, peerInfo = null) {
    if (!state.selectedContact) {
        chatMessages.innerHTML = '<div class="empty-state">Choisissez un contact pour ouvrir le chat.</div>';
        chatHeader.innerHTML = '<span>Sélectionnez un contact</span>';
        chatStatusBar.textContent = '';
        return;
    }

    const peer = peerInfo || { identifier: state.selectedContact, online: false, typing: false, voice: false };
    chatHeader.innerHTML = `
        <div class="chat-identity">
            <span class="contact-avatar small">${escapeHtml(peer.identifier.charAt(0).toUpperCase())}</span>
            <div>
                <strong>${escapeHtml(peer.identifier)}</strong>
                <small>${peer.online ? 'connecté' : 'hors ligne'}${peer.typing ? ' • écrit...' : ''}${peer.voice ? ' • vocal en cours' : ''}</small>
            </div>
        </div>
    `;

    const status = peer.typing ? 'Écrit...' : peer.voice ? 'En vocal...' : peer.online ? 'Connecté' : 'Déconnecté';
    chatStatusBar.textContent = status;

    if (!messages.length) {
        chatMessages.innerHTML = '<div class="empty-state">Aucune conversation pour le moment.</div>';
        return;
    }

    chatMessages.innerHTML = messages.map((message) => {
        const isOwn = message.from === state.account.identifier;
        const media = message.type === 'image' && message.image ? `<img src="${message.image}" alt="Image envoyée" class="chat-image" />` : '';
        const text = message.text ? escapeHtml(message.text) : '';
        const label = message.type === 'voice' ? '🎙️ Vocal' : message.type === 'image' ? '📷 Photo' : 'Message';
        return `
            <div class="message-row ${isOwn ? 'own' : 'other'}">
                <div class="message-bubble ${isOwn ? 'own' : 'other'}">
                    <span class="message-tag">${label}</span>
                    ${media || `<div>${text}</div>`}
                </div>
            </div>
        `;
    }).join('');

    chatMessages.scrollTop = chatMessages.scrollHeight;
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
    state.account = account;
    profileName.textContent = account.identifier;
    loginCount.textContent = String(account.loginCount || 0);
    profileDescription.value = account.description || '';
    profileStatus.textContent = '';
    renderDiscord(account);
    applyTheme(account.theme || 'light');
    setActivePanel('profile');
    loadContacts();
}

function showAuth() {
    state.account = null;
    state.selectedContact = null;
    state.contacts = [];
    chatMessages.innerHTML = '';
    dashboardView.classList.add('is-hidden');
    authView.classList.remove('is-hidden');
    profileStatus.textContent = '';
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

async function loadContacts() {
    if (!state.account) return;
    try {
        const contacts = await request('/api/contacts');
        state.contacts = contacts;
        renderContacts(contacts);
        if (state.selectedContact) {
            const selected = contacts.find((contact) => contact.identifier === state.selectedContact);
            if (selected) {
                loadConversation(selected.identifier);
            }
        }
    } catch (error) {
        console.warn(error);
    }
}

async function loadConversation(identifier) {
    if (!identifier) return;
    state.selectedContact = identifier;
    try {
        const data = await request(`/api/chat/${encodeURIComponent(identifier)}`);
        renderConversation(data.messages || [], data.peer || { identifier, online: false, typing: false, voice: false });
        renderContacts(state.contacts);
    } catch (error) {
        console.warn(error);
    }
}

function selectConversation(identifier) {
    state.selectedContact = identifier;
    loadConversation(identifier);
}

async function searchMembers() {
    const query = memberSearch.value.trim();
    if (!query) {
        renderMembers([]);
        return;
    }
    try {
        const data = await request(`/api/users/search?q=${encodeURIComponent(query)}`);
        renderMembers(data.users || []);
    } catch (error) {
        renderMembers([]);
    }
}

async function sendMessage() {
    if (!state.selectedContact) return;
    const text = chatInput.value.trim();
    if (!text) return;
    try {
        await request('/api/chat/send', { method: 'POST', body: JSON.stringify({ to: state.selectedContact, text, type: 'text' }) });
        chatInput.value = '';
        updateTypingStatus(false);
        await loadConversation(state.selectedContact);
        await loadContacts();
    } catch (error) {
        alert(error.message);
    }
}

async function updateTypingStatus(isTyping) {
    if (!state.selectedContact) return;
    try {
        await request('/api/chat/status', { method: 'POST', body: JSON.stringify({ to: state.selectedContact, typing: isTyping }) });
    } catch (error) {
        console.warn(error);
    }
}

async function toggleVoice() {
    if (!state.selectedContact) return;
    state.voiceActive = !state.voiceActive;
    voiceButton.classList.toggle('active', state.voiceActive);
    try {
        await request('/api/chat/status', { method: 'POST', body: JSON.stringify({ to: state.selectedContact, voice: state.voiceActive }) });
        await loadConversation(state.selectedContact);
        await loadContacts();
    } catch (error) {
        console.warn(error);
    }
}

async function handleImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !state.selectedContact) return;
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            await request('/api/chat/send', { method: 'POST', body: JSON.stringify({ to: state.selectedContact, type: 'image', image: String(reader.result) }) });
            await loadConversation(state.selectedContact);
            await loadContacts();
        } catch (error) {
            alert(error.message);
        }
        event.target.value = '';
    };
    reader.readAsDataURL(file);
}

function bindTypingEvents() {
    chatInput.addEventListener('input', () => {
        if (!state.selectedContact) return;
        if (state.typingTimer) clearTimeout(state.typingTimer);
        updateTypingStatus(true);
        state.typingTimer = setTimeout(() => updateTypingStatus(false), 1500);
    });
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

memberSearch.addEventListener('input', searchMembers);
chatSearch.addEventListener('input', () => loadContacts());
sendMessageButton.addEventListener('click', sendMessage);
voiceButton.addEventListener('click', toggleVoice);
imageUpload.addEventListener('change', handleImageUpload);
bindTypingEvents();

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