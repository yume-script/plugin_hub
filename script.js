(function () {
  'use strict';

  const SELF_ID = 'plugin_hub';
  const root = document.querySelector('[data-uf-root]');
  if (!root) return;

  const $ = (role) => root.querySelector(`[data-role="${role}"]`);
  const tabsEl = $('tabs');
  const panesEl = $('panes');
  const statusEl = $('status');
  const settingsBtn = $('open-settings');

  let plugins = [];
  let activeId = null;
  const bundleCache = new Map();

  // 사이드바 "환경설정" → 플러그인 탭 전환 → 이 플러그인 카드 아코디언 펼치기까지
  // 실제 코어 클릭 경로를 그대로 재현한다(엘리먼트가 비동기로 그려지므로 폴링으로 대기).
  function waitFor(check, timeoutMs, intervalMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const el = check();
        if (el) return resolve(el);
        if (Date.now() - start >= timeoutMs) return resolve(null);
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  async function openHubSettings() {
    try {
      const categoryBtn = document.getElementById('category-settings');
      if (categoryBtn) {
        categoryBtn.click();
      } else {
        console.warn('[PluginHub] #category-settings 를 찾지 못함');
      }
    } catch (e) {
      console.error('[PluginHub] category-settings 클릭 실패', e);
    }

    // "settings-tab-plugins"는 초기 페이지 로드 시부터 display:none으로 이미 DOM에
    // 존재하므로 그 존재 여부로는 설정 뷰가 실제로 열렸는지 알 수 없다. 대신 실제
    // 탭 버튼(.settings-tab-btn)과 window.switchSettingsTab 둘 다 준비될 때까지 기다렸다가,
    // 버튼이 있으면 진짜 클릭을 시뮬레이션해 코어의 클릭 핸들러 부수효과(카드 목록 로드 등)까지
    // 그대로 태운다. window.switchSettingsTab은 설정 뷰를 처음 열 때 비로소 바인딩될 수 있어
    // category-settings 클릭 이후에도 즉시 존재를 보장할 수 없으므로 별도로 폴링한다.
    const [tabBtn, switchFn] = await Promise.all([
      waitFor(() => document.querySelector('.settings-tab-btn[data-settings-tab="plugins"]'), 3000, 50),
      waitFor(() => (typeof window.switchSettingsTab === 'function' ? window.switchSettingsTab : null), 3000, 50),
    ]);
    if (tabBtn) {
      console.debug('[PluginHub] 플러그인 설정 탭 버튼 클릭');
      tabBtn.click();
    } else if (switchFn) {
      console.debug('[PluginHub] window.switchSettingsTab("plugins") 직접 호출');
      switchFn('plugins');
    } else {
      console.warn('[PluginHub] 플러그인 설정 탭 버튼/함수 둘 다 못 찾음 (타임아웃)');
    }

    // 플러그인 카드 목록이 비동기로 그려지므로 우리 카드가 나타날 때까지 대기
    const header = await waitFor(
      () => document.querySelector(`[data-role="plugin-card-toggle"][data-plugin-id="${SELF_ID}"]`),
      4000,
      100
    );
    if (!header) {
      console.warn('[PluginHub] plugin_hub 설정 카드를 찾지 못함 (타임아웃)');
      return;
    }
    header.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      const body = document.querySelector(`[data-plugin-body="${SELF_ID}"]`);
      if (body && getComputedStyle(body).display === 'none') {
        header.click();
      }
    } catch (e) {
      console.error('[PluginHub] 카드 펼치기 실패', e);
    }
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      openHubSettings();
    });
  }

  // 다른 카테고리 뷰 플러그인(kh_viewer 등)과 동일한 "보관함 이동" 컴포넌트.
  // kh_viewer는 자기 자신이 adult 전용이라 활성 버튼을 하드코딩했지만, 플러그인 허브는
  // 4개 세션 전부에서 쓰이므로 document.documentElement의 data-library-type으로
  // 실제 현재 세션을 판별해 활성 버튼을 정한다.
  function initLibraryNavigation() {
    const navigation = $('library-navigation');
    if (!navigation) return;
    const current = document.documentElement.getAttribute('data-library-type') || 'general';

    navigation.querySelectorAll('[data-library-destination]').forEach((button) => {
      const type = button.dataset.libraryDestination;
      const isActive = type === current;
      const canAccess = typeof window.canAccessLibraryType !== 'function'
        || window.canAccessLibraryType(type);

      button.hidden = !canAccess;
      button.classList.toggle('is-active', isActive);
      if (isActive) {
        button.setAttribute('aria-current', 'page');
        return;
      }

      button.removeAttribute('aria-current');
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          if (typeof window.switchLibraryType === 'function') {
            await window.switchLibraryType(type);
            return;
          }
          const coreButton = document.getElementById(`btn-lib-${type}`);
          if (coreButton) coreButton.click();
        } finally {
          if (root.isConnected) button.disabled = false;
        }
      });
    });
  }

  initLibraryNavigation();

  // 코어 전역 스캔 스피너(#header-category-scan-spinner)는 페이지에 하나만 존재하는
  // getElementById 대상이라 id를 그대로 복사하면 충돌한다. 대신 우리 스피너를 따로 두고
  // 코어 스피너의 style(표시/숨김) 변화를 MutationObserver로 그대로 따라가게 한다 —
  // 코어가 이미 /api/system/status를 2초 주기로 폴링하고 있으므로 우리가 또 폴링할 필요 없음.
  function initScanSpinnerMirror() {
    const mine = $('scan-spinner');
    if (!mine) return;

    function sync(source) {
      const visible = !!source && getComputedStyle(source).display !== 'none';
      mine.style.display = visible ? 'inline-block' : 'none';
    }

    function attach(source) {
      sync(source);
      const mo = new MutationObserver(() => sync(source));
      mo.observe(source, { attributes: true, attributeFilter: ['style'] });
    }

    const existing = document.getElementById('header-category-scan-spinner');
    if (existing) {
      attach(existing);
      return;
    }
    // 코어 헤더가 아직 안 그려졌을 수 있으니 잠깐 폴링해서 찾은 뒤 옵저버 연결
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const found = document.getElementById('header-category-scan-spinner');
      if (found) {
        clearInterval(timer);
        attach(found);
      } else if (tries > 20) {
        clearInterval(timer);
      }
    }, 250);
  }

  initScanSpinnerMirror();

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function currentType() {
    return document.documentElement.getAttribute('data-library-type') || 'general';
  }

  function showStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('is-error', !!isError);
    statusEl.classList.remove('uf-hidden');
  }

  function hideStatus() {
    if (statusEl) statusEl.classList.add('uf-hidden');
  }

  async function fetchViewers() {
    const res = await fetch(
      `/api/media/dashboard/widgets/${SELF_ID}/data?type=${encodeURIComponent(currentType())}`,
      { credentials: 'same-origin' }
    );
    if (!res.ok) throw new Error(`통합 뷰어 목록 조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '통합 뷰어 목록 조회 실패');
    return Array.isArray(data.viewers) ? data.viewers : [];
  }

  async function getBundle(pluginId) {
    if (bundleCache.has(pluginId)) return bundleCache.get(pluginId);
    const res = await fetch(`/api/media/plugins/${encodeURIComponent(pluginId)}/ui`, {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`UI 번들 조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    if (!data.success || !data.bundle) throw new Error(data.error || 'UI 번들이 없습니다.');
    bundleCache.set(pluginId, data.bundle);
    return data.bundle;
  }

  // 코어 mountCategoryPluginUI 와 동일한 직접 마운트 방식.
  // 개별 뷰어 스크립트는 window.__bookOasisViewerCleanups 레지스트리로
  // 실행 시 이전 뷰어를 스스로 정리하므로 탭 전환 시 innerHTML 교체가 안전함.
  async function mountViewer(plugin) {
    showStatus((plugin.title || plugin.id) + ' 뷰어를 불러오는 중...');
    const bundle = await getBundle(plugin.id);

    // 이전 뷰어 정리 (뷰어 자체 레지스트리 선(先)정리)
    try {
      const reg = window.__bookOasisViewerCleanups;
      if (reg && typeof reg.forEach === 'function') {
        [...reg.values()].forEach((cleanup) => {
          try { cleanup(); } catch (e) { /* noop */ }
        });
        reg.clear();
      }
    } catch (e) { /* noop */ }

    let html = '';
    if (bundle.css) {
      html += `<style data-uf-style="${escapeHtml(plugin.id)}">${bundle.css}</style>`;
    }
    html += bundle.html || '';
    panesEl.innerHTML = html;

    if (bundle.js) {
      try {
        const scriptFn = new Function('pluginId', 'container', bundle.js);
        scriptFn(plugin.id, panesEl);
      } catch (err) {
        console.error(`[PluginHub] ${plugin.id} 스크립트 실행 오류:`, err);
        showStatus((plugin.title || plugin.id) + ' 스크립트 오류: ' + (err.message || '오류'), true);
        return;
      }
    }
    hideStatus();
  }

  async function activate(pluginId) {
    if (activeId === pluginId) return;
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) return;
    activeId = pluginId;
    root.querySelectorAll('.uf-tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.pluginId === pluginId);
    });
    try {
      await mountViewer(plugin);
    } catch (err) {
      console.error('[PluginHub] mount error:', err);
      showStatus((plugin.title || pluginId) + ' 뷰어를 불러오지 못했습니다: ' + (err.message || '오류'), true);
    }
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    plugins.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'uf-tab' + (p.id === activeId ? ' is-active' : '');
      btn.dataset.pluginId = p.id;
      const icon = p.icon || 'fa-solid fa-puzzle-piece';
      btn.innerHTML = `<i class="uf-tab-icon ${escapeHtml(icon)}"></i><span>${escapeHtml(p.title || p.id)}</span>`;
      btn.addEventListener('click', () => activate(p.id));
      frag.appendChild(btn);
    });
    tabsEl.appendChild(frag);

    if (plugins.length === 0) {
      showStatus('이 보관함의 플러그인 허브에 표시할 플러그인이 없습니다. 설정 > 플러그인 > 플러그인 허브에서 선택하세요.', true);
      panesEl.innerHTML = '';
      activeId = null;
    } else {
      const stillActive = plugins.some((p) => p.id === activeId);
      if (!stillActive) {
        activeId = null;
        activate(plugins[0].id);
      }
    }
  }

  function cleanUpSidebarTabs(viewerList) {
    if (!Array.isArray(viewerList)) return;
    const hiddenIds = new Set(viewerList.map((p) => p && p.id).filter(Boolean));
    hiddenIds.delete(SELF_ID);

    try {
      // 1. 허브에 포함된 플러그인의 개별 사이드바 탭 숨김
      viewerList.forEach((p) => {
        if (!p || !p.id || p.id === SELF_ID) return;
        const selectors = [
          `[data-plugin-id="${CSS.escape(p.id)}"]`,
          `[data-tab-id="${CSS.escape(p.id)}"]`,
          `a[href*="/plugins/${CSS.escape(p.id)}"]`,
          `a[href*="/category/${CSS.escape(p.id)}"]`,
        ];
        selectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            if (!el.closest('[data-uf-root]')) {
              el.style.display = 'none';
            }
          });
        });
      });

      // 2. 허브에서 체크 해제된 플러그인의 사이드바 탭 복원
      document.querySelectorAll('[data-role="sidebar-category-dynamic"], [data-plugin-id], [data-tab-id]').forEach((el) => {
        if (el.closest('[data-uf-root]')) return;
        const pid = el.dataset.pluginId || el.dataset.tabId || (el.dataset.id && el.dataset.id.startsWith('plugin_') ? el.dataset.id.replace('plugin_', '') : null);
        if (pid && !hiddenIds.has(pid) && el.style.display === 'none') {
          el.style.display = '';
        }
      });
    } catch (_) {}
  }

  async function reloadViewerTabs() {
    try {
      plugins = await fetchViewers();
      renderTabs();
      cleanUpSidebarTabs(plugins);
    } catch (err) {
      console.error('[PluginHub] reload error:', err);
    }
  }

  window.reloadPluginHubTabs = reloadViewerTabs;
  window.addEventListener('plugin_hub:config_updated', reloadViewerTabs);

  async function init() {
    try {
      plugins = await fetchViewers();
      renderTabs();
      cleanUpSidebarTabs(plugins);
    } catch (err) {
      console.error('[PluginHub] init error:', err);
      showStatus('뷰어 목록을 불러오지 못했습니다: ' + (err.message || '오류'), true);
    }
  }

  init();
})();
