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
  const versionEl = $('header-version');

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
    return {
      viewers: Array.isArray(data.viewers) ? data.viewers : [],
      hubVersion: typeof data.hub_version === 'string' ? data.hub_version : '',
    };
  }

  function updateHeaderVersion(version) {
    if (!versionEl) return;
    versionEl.textContent = version ? `v${version}` : '';
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

  // 허브가 직접 숨긴 요소에만 마커 속성(HIDE_MARKER)을 남기고, 복원 단계에서도 그 마커가
  // 붙은 요소만 대상으로 삼는다. 이전 버전은 "[data-plugin-id], [data-tab-id]를 가진 페이지
  // 전체 요소 중 display:none이고 hiddenIds에 없는 것"을 전부 복원 대상으로 봤는데, 이러면
  // 다른 코드가 같은 속성 이름을 다른 용도로 쓰면서 의도적으로 숨겨둔 요소까지 실수로 다시
  // 보이게 만들 위험이 있었다. 마커를 우리가 직접 찍고 우리가 찍은 것만 되돌리면 그 문제가
  // 원천적으로 사라진다.
  const HIDE_MARKER = 'data-plugin-hub-hidden';

  function cleanUpSidebarTabs(viewerList) {
    if (!Array.isArray(viewerList)) return;
    const hiddenIds = new Set(viewerList.map((p) => p && p.id).filter(Boolean));
    hiddenIds.delete(SELF_ID);

    try {
      // 1. 허브에 포함된 플러그인의 개별 사이드바 탭 숨김 (숨긴 요소에는 마커를 남긴다)
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
            if (el.closest('[data-uf-root]')) return;
            el.style.display = 'none';
            el.setAttribute(HIDE_MARKER, p.id);
          });
        });
      });

      // 2. 허브가 이전에 숨겨뒀지만(마커 보유) 이제는 더 이상 숨길 대상이 아닌 요소만 복원.
      //    마커가 없는 요소(다른 이유로 display:none인 요소)는 절대 건드리지 않는다.
      document.querySelectorAll(`[${HIDE_MARKER}]`).forEach((el) => {
        const pid = el.getAttribute(HIDE_MARKER);
        if (pid && !hiddenIds.has(pid)) {
          el.style.display = '';
          el.removeAttribute(HIDE_MARKER);
        }
      });
    } catch (_) {}
  }

  async function reloadViewerTabs() {
    try {
      const result = await fetchViewers();
      plugins = result.viewers;
      renderTabs();
      cleanUpSidebarTabs(plugins);
      updateHeaderVersion(result.hubVersion);
    } catch (err) {
      console.error('[PluginHub] reload error:', err);
    }
  }

  // 설정이 바뀌면(예: 병합된 플러그인이 update_manifest로 자기 UI 파일을 자동 업데이트한
  // 직후) 캐시된 UI 번들이 새로고침 전까지 계속 옛 버전으로 남아있지 않도록 bundleCache도
  // 함께 비운다. 탭 목록 자체만 새로 받아오고 번들 캐시는 그대로 두던 것이 이전 동작이었다.
  function reloadViewerTabsAndClearCache() {
    bundleCache.clear();
    return reloadViewerTabs();
  }

  window.reloadPluginHubTabs = reloadViewerTabsAndClearCache;
  window.addEventListener('plugin_hub:config_updated', reloadViewerTabsAndClearCache);

  async function init() {
    try {
      const result = await fetchViewers();
      plugins = result.viewers;
      renderTabs();
      cleanUpSidebarTabs(plugins);
      updateHeaderVersion(result.hubVersion);
    } catch (err) {
      console.error('[PluginHub] init error:', err);
      showStatus('뷰어 목록을 불러오지 못했습니다: ' + (err.message || '오류'), true);
    }
  }

  init();
})();
