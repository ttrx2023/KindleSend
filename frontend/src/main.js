import './style.css';
import './app.css';

import logo from './assets/images/logo-universal.png';
import {
  GetSettings,
  ListBooks,
  SaveSettings,
  SearchBook,
  SendSelectedBooks,
  TestConnection,
} from '../wailsjs/go/main/App';

const state = {
  books: [],
};

document.querySelector('#app').innerHTML = `
  <div class="container">
    <header class="app-header">
      <img id="logo" class="logo" alt="KindlePro logo" />
      <div class="app-title">
        <h1>KindlePro</h1>
        <p class="subtitle">Send local books to Kindle via email.</p>
      </div>
    </header>

    <section class="card">
      <div class="card-header">
        <h2>Settings</h2>
        <div class="card-actions">
          <button id="saveSettings" class="btn primary">Save Settings</button>
          <button id="testConnection" class="btn secondary">Test Connection</button>
        </div>
      </div>

      <div class="grid">
        <div class="field">
          <label for="senderEmail">Sender Email</label>
          <input id="senderEmail" type="email" placeholder="example@qq.com" autocomplete="off" />
        </div>
        <div class="field">
          <label for="senderPass">Sender Password / App Code</label>
          <input id="senderPass" type="password" placeholder="App password" autocomplete="off" />
        </div>
        <div class="field">
          <label for="targetKindle">Target Kindle Email</label>
          <input id="targetKindle" type="email" placeholder="name@kindle.com" autocomplete="off" />
        </div>
        <div class="field">
          <label for="downloadPath">Download Path</label>
          <input id="downloadPath" type="text" placeholder="D:\\Downloads" autocomplete="off" />
        </div>
        <div class="field field-wide">
          <label for="searchUrl">Search URL Template</label>
          <input id="searchUrl" type="text" placeholder="https://example.com/search?q=%s" autocomplete="off" />
        </div>
      </div>
      <div id="settingsStatus" class="status"></div>
    </section>

    <section class="card">
      <div class="card-header">
        <h2>Search</h2>
        <div class="card-actions">
          <button id="openSearch" class="btn secondary">Open Search</button>
        </div>
      </div>
      <div class="field">
        <label for="searchQuery">Search Keyword</label>
        <input id="searchQuery" type="text" placeholder="Enter book title or author" autocomplete="off" />
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <h2>Local Library</h2>
        <div class="card-actions">
          <button id="refreshBooks" class="btn secondary">Refresh List</button>
          <button id="sendSelected" class="btn primary">Send Selected</button>
        </div>
      </div>
      <div id="bookList" class="book-list"></div>
      <div id="sendLog" class="log"></div>
    </section>
  </div>
`;

document.getElementById('logo').src = logo;

const elements = {
  senderEmail: document.getElementById('senderEmail'),
  senderPass: document.getElementById('senderPass'),
  targetKindle: document.getElementById('targetKindle'),
  downloadPath: document.getElementById('downloadPath'),
  searchUrl: document.getElementById('searchUrl'),
  settingsStatus: document.getElementById('settingsStatus'),
  searchQuery: document.getElementById('searchQuery'),
  bookList: document.getElementById('bookList'),
  sendLog: document.getElementById('sendLog'),
  saveSettings: document.getElementById('saveSettings'),
  testConnection: document.getElementById('testConnection'),
  openSearch: document.getElementById('openSearch'),
  refreshBooks: document.getElementById('refreshBooks'),
  sendSelected: document.getElementById('sendSelected'),
};

const setStatus = (message, { isError = false } = {}) => {
  elements.settingsStatus.textContent = message || '';
  elements.settingsStatus.classList.toggle('status-error', isError);
};

const setSendLog = (message, { isHtml = false } = {}) => {
  if (isHtml) {
    elements.sendLog.innerHTML = message || '';
  } else {
    elements.sendLog.textContent = message || '';
  }
};

const getConfigFromForm = () => ({
  senderEmail: elements.senderEmail.value.trim(),
  senderPass: elements.senderPass.value,
  targetKindle: elements.targetKindle.value.trim(),
  downloadPath: elements.downloadPath.value.trim(),
  searchUrl: elements.searchUrl.value.trim(),
});

const applyConfigToForm = (config = {}) => {
  elements.senderEmail.value = config.senderEmail || '';
  elements.senderPass.value = config.senderPass || '';
  elements.targetKindle.value = config.targetKindle || '';
  elements.downloadPath.value = config.downloadPath || '';
  elements.searchUrl.value = config.searchUrl || '';
};

const loadSettings = async () => {
  try {
    const result = await GetSettings();
    let config = result;
    let isFirstRun = false;

    if (Array.isArray(result)) {
      [config, isFirstRun] = result;
    }

    if (config && typeof config === 'object') {
      applyConfigToForm(config);
      if (isFirstRun) {
        setStatus('No saved settings found. Please save your configuration.');
      } else {
        setStatus('Settings loaded.');
      }
    }
  } catch (error) {
    console.error(error);
    setStatus('Failed to load settings.', { isError: true });
  }
};

const refreshBooks = async () => {
  try {
    const books = await ListBooks();
    state.books = Array.isArray(books) ? books : [];
    renderBooks();
  } catch (error) {
    console.error(error);
    setSendLog('Failed to load book list.');
  }
};

const renderBooks = () => {
  elements.bookList.innerHTML = '';
  if (!state.books.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No supported files found in the download path.';
    elements.bookList.appendChild(empty);
    return;
  }

  state.books.forEach((book, index) => {
    const row = document.createElement('label');
    row.className = 'book-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.index = String(index);

    const info = document.createElement('div');
    info.className = 'book-info';

    const title = document.createElement('div');
    title.className = 'book-title';
    title.textContent = book.name || 'Untitled';

    const meta = document.createElement('div');
    meta.className = 'book-meta';
    const metaParts = [book.type, book.size, book.modTime].filter(Boolean);
    meta.textContent = metaParts.join(' - ');

    info.appendChild(title);
    info.appendChild(meta);
    row.appendChild(checkbox);
    row.appendChild(info);
    elements.bookList.appendChild(row);
  });
};

elements.saveSettings.addEventListener('click', async () => {
  setStatus('Saving settings...');
  try {
    const message = await SaveSettings(getConfigFromForm());
    setStatus(message);
    await refreshBooks();
  } catch (error) {
    console.error(error);
    setStatus('Failed to save settings.', { isError: true });
  }
});

elements.testConnection.addEventListener('click', async () => {
  setStatus('Testing connection...');
  try {
    const message = await TestConnection();
    setStatus(message);
  } catch (error) {
    console.error(error);
    setStatus('Connection test failed.', { isError: true });
  }
});

elements.openSearch.addEventListener('click', async () => {
  const query = elements.searchQuery.value.trim();
  if (!query) {
    setStatus('Enter a search keyword first.', { isError: true });
    return;
  }
  try {
    await SearchBook(query);
    setStatus('Search opened in browser.');
  } catch (error) {
    console.error(error);
    setStatus('Failed to open search.', { isError: true });
  }
});

elements.refreshBooks.addEventListener('click', async () => {
  setSendLog('Refreshing list...');
  await refreshBooks();
  setSendLog('');
});

elements.sendSelected.addEventListener('click', async () => {
  const selected = Array.from(
    elements.bookList.querySelectorAll('input[type="checkbox"]:checked')
  )
    .map((checkbox) => state.books[Number(checkbox.dataset.index)]?.path)
    .filter(Boolean);

  if (!selected.length) {
    setSendLog('Select at least one file to send.');
    return;
  }

  setSendLog('Sending selected files...');
  try {
    const result = await SendSelectedBooks(selected);
    setSendLog(result, { isHtml: true });
  } catch (error) {
    console.error(error);
    setSendLog('Failed to send selected files.');
  }
});

loadSettings();
refreshBooks();
