import { api } from '../api.js';
import { t, getLocale } from '../i18n.js';

export async function render(container) {
  container.innerHTML = `<div class="page-header"><h1>${t('download')}</h1></div><p class="empty-state">${t('loading')}...</p>`;

  const { ok, data } = await api.get('/extension/version');
  if (!ok) {
    container.innerHTML = `<div class="page-header"><h1>${t('download')}</h1></div><p class="empty-state">${t('failedToLoadVersion')}</p>`;
    return;
  }

  const locale = getLocale();
  const changelog = data.changelog || [];

  container.innerHTML = `
    <div class="page-header">
      <h1>${t('download')}</h1>
    </div>

    <section class="settings-section">
      <h2>${t('extensionDownload')}</h2>
      <div class="download-card">
        <div class="download-info">
          <div class="download-title">${escapeHtml(data.name)}</div>
          <div class="download-version">v${escapeHtml(data.version)}</div>
        </div>
        <a href="/api/extension/download" class="btn btn-primary" id="download-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${t('downloadZip')}
        </a>
      </div>
    </section>

    <section class="settings-section">
      <h2>${t('installGuide')}</h2>
      <div class="install-steps">
        <div class="install-step">
          <span class="step-number">1</span>
          <div class="step-content">
            <strong>${t('installStep1Title')}</strong>
            <p>${t('installStep1Desc')}</p>
          </div>
        </div>
        <div class="install-step">
          <span class="step-number">2</span>
          <div class="step-content">
            <strong>${t('installStep2Title')}</strong>
            <p>${t('installStep2Desc')}</p>
          </div>
        </div>
        <div class="install-step">
          <span class="step-number">3</span>
          <div class="step-content">
            <strong>${t('installStep3Title')}</strong>
            <p>${t('installStep3Desc')}</p>
          </div>
        </div>
        <div class="install-step">
          <span class="step-number">4</span>
          <div class="step-content">
            <strong>${t('installStep4Title')}</strong>
            <p>${t('installStep4Desc')}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2>${t('versionHistory')}</h2>
      <div class="changelog">
        ${changelog.map(entry => `
          <div class="changelog-entry">
            <div class="changelog-header">
              <span class="changelog-version">v${escapeHtml(entry.version)}</span>
              <span class="changelog-date">${escapeHtml(entry.date)}</span>
            </div>
            <ul class="changelog-list">
              ${(entry.changes[locale] || entry.changes.en || []).map(c => `<li>${escapeHtml(c)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
