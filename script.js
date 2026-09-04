(function () {
  'use strict';

  const SELF_ID = 'plugin_hub';
  const root = document.querySelector('[data-uf-root]');
  if (!root) return;

  // 화면(뷰포트) 높이에 안 맞고 스크롤이 생기는 문제 대응. `.uf-plugin { height: 100% }`는
  // 부모 요소들이 전부 명시적인 height를 갖고 있어야만 실제로 동작하는데, 코어가 이 플러그인을
  // 마운트하는 컨테이너 체인 중 어딘가가 height: auto(내용에 따라 늘어나는 방식)이면 100%가
  // 0으로 무너지거나 무제한으로 늘어나 버려서, 원래 .uf-panes 안에서만 나야 할 스크롤이 페이지
  // 전체 스크롤로 새버린다. 그래서 부모 체인에 기대는 대신 뷰포트 높이(window.innerHeight)에서
  // 루트 요소의 화면상 y좌표(top)를 뺀 실제 픽셀 값을 직접 계산해 인라인으로 고정한다.
  function fitToViewportHeight() {
    try {
      const top = root.getBoundingClientRect().top;
      const initial = Math.max(240, Math.floor(window.innerHeight - top));
      root.style.height = `${initial}px`;

      // 계산 하나만으로는 코어 레이아웃에 우리가 모르는 요소(하단 고정 바, 실제
      // 가시 영역과 window.innerHeight의 오차 등)가 있을 때 못 잡아낼 수 있다. 그래서
      // 적용 직후 문서 전체에 실제로 세로 스크롤이 남아있는지 다시 측정해서, 남아있으면
      // 그 초과분만큼 우리 쪽 높이를 한 번 더 줄이는 보정을 거친다(최대 5회, 무한루프 방지).
      // 목표를 0px 초과분보다 여유 있게(버퍼 4px) 잡는 이유: 병합된 뷰어가 스크롤바
      // 색상/두께를 커스텀 스타일링(예: 주황색 두꺼운 스크롤바)한 CSS가 스코프 없이
      // 페이지 전체에 새어나가면, 남은 오버플로우가 1px 미만이라도 그 스타일링 그대로
      // 굵고 눈에 띄는 막대로 렌더링될 수 있기 때문에, 애매하게 0에 걸치지 않고
      // 확실히 0 아래로 내려가게 한다.
      const OVERFLOW_BUFFER_PX = 4;
      for (let i = 0; i < 5; i += 1) {
        const doc = document.documentElement;
        const overflow = doc.scrollHeight - doc.clientHeight;
        if (overflow <= 0) break;
        const current = root.getBoundingClientRect().height;
        const next = Math.floor(current - overflow - OVERFLOW_BUFFER_PX);
        if (next < 240 || next >= current) break;
        root.style.height = `${next}px`;
      }
    } catch (e) {
      /* noop */
    }
  }

  fitToViewportHeight();
  window.addEventListener('resize', fitToViewportHeight);
  // 코어 레이아웃이 리사이즈 이벤트 없이도 바뀔 수 있는 경우(사이드바 접기/펼치기 등)에
  // 대비해, 화면 크기 변화를 폭넓게 잡아내는 ResizeObserver도 함께 건다(부모 요소 크기 변화
  // 감지용 — root 자신이 아니라 root의 부모를 관찰해야 한다. 지원 안 하는 구형 브라우저에서는
  // 조용히 건너뛴다).
  try {
    if (typeof ResizeObserver === 'function' && root.parentElement) {
      const ro = new ResizeObserver(() => fitToViewportHeight());
      ro.observe(root.parentElement);
    }
  } catch (e) {
    /* noop */
  }

  // 병합된 뷰어(M3U 플레이어 등)는 자기 채널 목록을 비동기로 채우는 등, 마운트 직후에도
  // DOM이 한동안 계속 바뀔 수 있다. 그 시점을 고정된 타이머로 추측하는 대신, panes 내부
  // DOM 변화를 직접 관찰해서 바뀔 때마다(짧게 디바운스해서) 높이를 다시 보정한다.
  // 병합된 뷰어(bundle.css)는 <style> 태그로 스코프 없이 통째로 주입되기 때문에, 그
  // 뷰어가 자기 채널 목록용으로 정의한 스크롤바 커스텀 스타일(예: 두껍고 튀는 색상의
  // ::-webkit-scrollbar)이 페이지 전체(html/body)로 새어나갈 수 있다. 그러면 위
  // 자기보정 루프로 오버플로우를 0에 최대한 가깝게 줄여도, 아주 미세하게 남는 순간에
  // 그 스타일 그대로 굵고 눈에 띄는 막대로 렌더링되어 버린다. html/body의 스크롤바
  // 모양만큼은 항상 브라우저 기본값으로 강제 복원해서, 어떤 병합 뷰어가 무슨 스크롤바
  // 스타일을 페이지 전체에 흘려보내든 html/body에는 영향이 없도록 방어한다(뷰어 자신의
  // 콘텐츠 안쪽 스크롤바 스타일은 그대로 유지됨 — html/body 선택자만 되돌린다).
  try {
    if (!document.head.querySelector('[data-uf-scrollbar-guard]')) {
      const guardStyle = document.createElement('style');
      guardStyle.setAttribute('data-uf-scrollbar-guard', SELF_ID);
      guardStyle.textContent = `
        html::-webkit-scrollbar, html::-webkit-scrollbar-thumb, html::-webkit-scrollbar-track,
        body::-webkit-scrollbar, body::-webkit-scrollbar-thumb, body::-webkit-scrollbar-track {
          all: revert !important;
        }
        html, body { scrollbar-color: auto !important; }
      `;
      document.head.appendChild(guardStyle);
    }
  } catch (e) {
    /* noop */
  }

  let fitDebounceTimer = null;
  function scheduleFit() {
    if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
    fitDebounceTimer = setTimeout(() => {
      fitDebounceTimer = null;
      fitToViewportHeight();
    }, 80);
  }

  // GitHub 저장소의 VERSION 파일을 직접 조회해 최신 버전과 비교한다 (사용자 요청).
  // raw.githubusercontent.com은 기본적으로 CORS를 열어주므로 서버 프록시 없이 브라우저에서
  // 바로 fetch 가능하다. update_manifest(코어 관리자 화면의 "샘플 업데이트" 버튼용)와 같은
  // 저장소/브랜치를 가리키며, 이 배지는 그 화면까지 가지 않아도 탭 헤더에서 바로 눈에 띄게
  // 알려주는 보조 표시일 뿐 — 실제 파일 교체는 여전히 관리자가 환경설정 화면에서 진행해야 한다.
  const GITHUB_VERSION_URL = 'https://raw.githubusercontent.com/yume-script/plugin_hub/refs/heads/main/VERSION';
  const GITHUB_REPO_URL = 'https://github.com/yume-script/plugin_hub';
  // 매 마운트(탭 재진입)마다 GitHub에 요청을 보내면 사용자가 사이드바를 들락날락할 때마다
  // 불필요한 외부 요청이 반복되므로, 브라우저 localStorage에 결과를 6시간 TTL로 캐시한다.
  // localStorage를 못 쓰는 환경(프라이빗 모드 등)에서는 캐시 읽기/쓰기가 조용히 실패하고
  // 자연히 "매번 새로 확인"으로 폴백된다.
  const UPDATE_CHECK_CACHE_KEY = 'plugin_hub:update_check_cache';
  const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000; // 6시간

  function compareVersions(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
  }

  const $ = (role) => root.querySelector(`[data-role="${role}"]`);
  const tabsEl = $('tabs');
  const panesEl = $('panes');
  const statusEl = $('status');
  const settingsBtn = $('open-settings');
  const versionEl = $('header-version');

  // panes 내부 DOM이 바뀔 때마다(병합된 뷰어가 자기 콘텐츠를 비동기로 채우는 경우 포함)
  // 높이를 다시 보정한다.
  try {
    if (typeof MutationObserver === 'function' && panesEl) {
      const mo = new MutationObserver(() => scheduleFit());
      mo.observe(panesEl, { childList: true, subtree: true });
    }
  } catch (e) {
    /* noop */
  }


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

  function showUpdateNotice(latestVersion) {
    if (!versionEl || !versionEl.parentElement) return;
    let link = versionEl.parentElement.querySelector('[data-role="header-update-notice"]');
    if (!link) {
      link = document.createElement('a');
      link.setAttribute('data-role', 'header-update-notice');
      link.className = 'uf-header-update';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.href = GITHUB_REPO_URL;
      link.title = 'GitHub에서 새 버전을 확인하고, 환경설정 > 플러그인 설정에서 업데이트하세요: ' + GITHUB_REPO_URL;
      versionEl.insertAdjacentElement('afterend', link);
    }
    link.textContent = `⬆ v${latestVersion} 업데이트 가능`;
  }

  function readUpdateCheckCache() {
    try {
      const raw = localStorage.getItem(UPDATE_CHECK_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.ts !== 'number' || typeof parsed.latest !== 'string') return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeUpdateCheckCache(latest) {
    try {
      localStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify({ ts: Date.now(), latest }));
    } catch (e) {
      // localStorage 사용 불가 — 캐시 없이 매번 확인하는 것으로 자연히 폴백된다.
    }
  }

  // GitHub 최신 VERSION과 비교해 새 버전이 있으면 배지를 띄운다. 캐시가 6시간 이내면 네트워크
  // 요청 없이 캐시된 결과로만 판단하고, 캐시가 없거나 만료됐을 때만 실제로 GitHub에 확인한다.
  // 네트워크 실패/오프라인/사내망 차단 등은 조용히 무시한다 — 이건 어디까지나 부가 안내이지
  // 핵심 기능이 아니므로 실패해도 나머지 UI 동작에 영향을 주면 안 된다.
  async function checkForUpdate(currentVersion) {
    if (!currentVersion) return;

    const cached = readUpdateCheckCache();
    if (cached && (Date.now() - cached.ts) < UPDATE_CHECK_TTL_MS) {
      if (compareVersions(cached.latest, currentVersion) > 0) {
        showUpdateNotice(cached.latest);
      }
      return;
    }

    try {
      const res = await fetch(GITHUB_VERSION_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const latest = data && data['plugin version'];
      if (!latest) return;
      writeUpdateCheckCache(latest);
      if (compareVersions(latest, currentVersion) > 0) {
        showUpdateNotice(latest);
      }
    } catch (err) {
      console.debug('[PluginHub] GitHub 버전 확인 실패(무시 가능):', err);
    }
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
        fitToViewportHeight();
        return;
      }
    }
    hideStatus();
    // 마운트 직후 즉시 한 번 보정하고, 이후의 비동기 렌더링 변화는 위 MutationObserver가
    // scheduleFit()으로 이어서 잡는다.
    fitToViewportHeight();
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
      checkForUpdate(result.hubVersion);
    } catch (err) {
      console.error('[PluginHub] init error:', err);
      showStatus('뷰어 목록을 불러오지 못했습니다: ' + (err.message || '오류'), true);
    } finally {
      // 탭/상태 렌더링 직후 한 번, 그리고 폰트 로딩·사이드바 애니메이션처럼 뒤늦게 끝나는
      // 레이아웃 변화까지 잡기 위해 약간의 지연을 두고 한 번 더 재계산한다.
      fitToViewportHeight();
      setTimeout(fitToViewportHeight, 300);
    }
  }

  init();
})();
