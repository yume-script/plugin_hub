/* 플러그인 허브 — 설정 페이지: 세션 레인(칩 드래그 순서/세션 이동) + 카드형 세션 선택 UI
   코어 계약: new Function('window','pluginId','root','config', js)(...)
   저장은 코어 폼 submit이 root 내부 input[name]을 수집하므로:
   - 체크박스 name: SHOW_<plugin_id>__<session>
   - 세션별 순서 hidden input name: TAB_ORDER_<session> (콤마 구분 id 목록)
   카드 체크 ON → 레인에 칩 추가, OFF/칩 x 클릭 → 칩 제거(체크 해제 연동).
   칩 드래그: 같은 레인 = 순서 변경, 다른 레인 = 세션 이동(체크박스 연동).
   플러그인이 지원하지 않는 세션 레인으로는 이동 불가. */
(function () {
  'use strict';

  const SESSION_LABELS = { general: '일반', adult: '성인', audiobook: '오디오', video: '비디오' };
  const SESSIONS = Object.keys(SESSION_LABELS);
  const grid = root.querySelector('[data-pv-role="grid"]');
  const lanesEl = root.querySelector('[data-pv-role="lanes"]');
  const excludedInput = root.querySelector('[data-pv-role="excluded-input"]');
  const selectAllBtn = root.querySelector('[data-pv-role="select-all"]');
  const deselectAllBtn = root.querySelector('[data-pv-role="deselect-all"]');
  if (!grid || !lanesEl) return;

  let catalogById = {};
  const orderInputs = {};

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function ensureOrderInputs() {
    SESSIONS.forEach((s) => {
      const name = `TAB_ORDER_${s}`;
      let input = root.querySelector(`input[name="${name}"]`);
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        lanesEl.appendChild(input);
      }
      orderInputs[s] = input;
    });
  }

  function laneBody(session) {
    return lanesEl.querySelector(`[data-pv-lane="${session}"]`);
  }

  function chipSession(chip) {
    const body = chip.closest('[data-pv-lane]');
    return body ? body.getAttribute('data-pv-lane') : null;
  }

  function supports(pluginId, session) {
    const p = catalogById[pluginId];
    return !!(p && Array.isArray(p.sessions) && p.sessions.includes(session));
  }

  function syncOrder(session) {
    const body = laneBody(session);
    if (!body) return;
    const ids = Array.from(body.querySelectorAll('.pv-chip')).map((el) => el.getAttribute('data-pv-id'));
    orderInputs[session].value = ids.join(',');
    body.classList.toggle('pv-lane-empty', !ids.length);
  }

  function syncAllOrders() {
    SESSIONS.forEach(syncOrder);
  }

  function findCheckbox(pluginId, session) {
    return grid.querySelector(`input[name="SHOW_${CSS.escape(pluginId)}__${CSS.escape(session)}"]`);
  }

  function setChecked(pluginId, session, on) {
    const cb = findCheckbox(pluginId, session);
    if (cb) cb.checked = !!on;
  }

  /* ---------- 칩 ---------- */

  let dragChip = null;
  let dragFromSession = null;

  function clearDropHints() {
    lanesEl.querySelectorAll('.pv-lane-body').forEach((el) =>
      el.classList.remove('pv-drop-ok', 'pv-drop-deny'));
  }

  // 세션 이동 확정: 출발/도착 체크박스 연동 + 순서 재계산
  function finishMove(pluginId, fromSession, toSession) {
    if (fromSession !== toSession) {
      setChecked(pluginId, fromSession, false);
      setChecked(pluginId, toSession, true);
    }
    syncAllOrders();
  }

  function makeChip(pluginId) {
    const p = catalogById[pluginId] || { name: pluginId };
    const chip = document.createElement('span');
    chip.className = 'pv-chip';
    chip.setAttribute('data-pv-id', pluginId);
    chip.setAttribute('draggable', 'true');
    chip.innerHTML = `<span class="pv-chip-name">${esc(p.name)}</span><button type="button" class="pv-chip-x" title="표시 해제">&times;</button>`;

    chip.querySelector('.pv-chip-x').addEventListener('click', (e) => {
      e.preventDefault();
      const s = chipSession(chip);
      if (s) setChecked(pluginId, s, false);
      chip.remove();
      if (s) syncOrder(s);
    });

    chip.addEventListener('dragstart', (e) => {
      dragChip = chip;
      dragFromSession = chipSession(chip);
      chip.classList.add('pv-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', pluginId); } catch (_) {}
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('pv-dragging');
      clearDropHints();
      if (dragChip) {
        // 드롭 이벤트가 안 온 경우에도 DOM 상 현재 위치 기준으로 확정
        const toSession = chipSession(chip);
        if (toSession && dragFromSession) finishMove(pluginId, dragFromSession, toSession);
      }
      dragChip = null;
      dragFromSession = null;
    });
    // 다른 칩 위로 드래그: 지원 세션이면 그 위치로 삽입(레인 이동 포함)
    chip.addEventListener('dragover', (e) => {
      if (!dragChip || dragChip === chip) return;
      const targetSession = chipSession(chip);
      const dragId = dragChip.getAttribute('data-pv-id');
      if (!targetSession || !supports(dragId, targetSession)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const chips = Array.from(chip.parentElement.querySelectorAll('.pv-chip'));
      if (chips.includes(dragChip) && chips.indexOf(dragChip) < chips.indexOf(chip)) chip.after(dragChip);
      else chip.before(dragChip);
    });
    return chip;
  }

  function addChip(pluginId, session) {
    const body = laneBody(session);
    if (!body || body.querySelector(`.pv-chip[data-pv-id="${CSS.escape(pluginId)}"]`)) return;
    body.appendChild(makeChip(pluginId));
    syncOrder(session);
  }

  function removeChip(pluginId, session) {
    const body = laneBody(session);
    if (!body) return;
    const chip = body.querySelector(`.pv-chip[data-pv-id="${CSS.escape(pluginId)}"]`);
    if (chip) chip.remove();
    syncOrder(session);
  }

  /* ---------- 렌더 ---------- */

  function renderLanes(catalog, orders) {
    lanesEl.querySelectorAll('.pv-lane').forEach((el) => el.remove());
    SESSIONS.forEach((s) => {
      const lane = document.createElement('div');
      lane.className = 'pv-lane';
      lane.innerHTML = `<div class="pv-lane-title">${esc(SESSION_LABELS[s])}</div><div class="pv-lane-body pv-lane-empty" data-pv-lane="${esc(s)}"></div>`;
      const body = lane.querySelector('.pv-lane-body');
      // 레인 빈 공간으로 드래그: 지원 세션이면 맨 뒤에 추가(레인 이동 포함)
      body.addEventListener('dragover', (e) => {
        if (!dragChip) return;
        const dragId = dragChip.getAttribute('data-pv-id');
        clearDropHints();
        if (!supports(dragId, s)) {
          body.classList.add('pv-drop-deny');
          return;
        }
        body.classList.add('pv-drop-ok');
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragChip.parentElement !== body && !e.target.closest('.pv-chip')) {
          body.appendChild(dragChip);
        }
      });
      body.addEventListener('dragleave', () => body.classList.remove('pv-drop-ok', 'pv-drop-deny'));
      body.addEventListener('drop', (e) => {
        e.preventDefault();
        clearDropHints();
      });
      lanesEl.appendChild(lane);
    });

    // 체크된 플러그인을 저장된 순서 → 나머지 이름순으로 레인에 채움
    // 레인(탭 순서 시각화)에는 "실제로 지금 탭에 뜨는" 것만 넣는다 — 정지된 플러그인은
    // 체크는 유지되지만(재활성화 시 자동 복원용) 지금 탭으로 뜨지 않으므로 레인에선 제외.
    SESSIONS.forEach((s) => {
      const checkedIds = catalog.filter((p) => p.enabled !== false && p.checked && p.checked[s]).map((p) => p.id);
      const order = Array.isArray(orders && orders[s]) ? orders[s] : [];
      const sorted = order.filter((id) => checkedIds.includes(id))
        .concat(checkedIds.filter((id) => !order.includes(id)));
      sorted.forEach((id) => addChip(id, s));
      syncOrder(s);
    });
  }

  function renderCards(catalog) {
    if (!catalog.length) {
      grid.innerHTML = '<div class="pv-settings-empty">표시할 카테고리 뷰 플러그인이 설치되어 있지 않습니다.</div>';
      return;
    }
    grid.innerHTML = catalog.map((p) => {
      const version = p.version ? `v${esc(p.version)}` : '';
      const isEnabled = p.enabled !== false;
      const checks = (p.sessions || []).map((s) => {
        const key = `SHOW_${p.id}__${s}`;
        const checked = p.checked && p.checked[s] ? 'checked' : '';
        // 정지된 플러그인도 name/checked는 그대로 둔다 — save-config가 config 전체를
        // 덮어쓰는 방식이라, 여기서 값을 지우거나 disabled로 빼면 저장 시 원래 선택이
        // 영구 소실된다. 대신 클릭만 JS로 막아서(readOnly 흉내) 값은 항상 보존되게 한다.
        return `
          <label class="pv-session-check${isEnabled ? '' : ' pv-session-check-locked'}">
            <input type="checkbox" name="${esc(key)}" data-pv-plugin="${esc(p.id)}" data-pv-session="${esc(s)}" data-pv-locked="${isEnabled ? '0' : '1'}" ${checked}>
            <span>${esc(SESSION_LABELS[s] || s)}</span>
          </label>`;
      }).join('');
      return `
        <div class="pv-card${isEnabled ? '' : ' pv-card-disabled'}">
          <div class="pv-card-head">
            <h5 class="pv-card-title">${esc(p.name)}</h5>
            ${version ? `<span class="pv-card-version">${version}</span>` : ''}
          </div>
          <div class="pv-card-id">${esc(p.id)}${isEnabled ? '' : ' · <span class="pv-card-badge">정지됨</span>'}</div>
          <div class="pv-card-sessions">${checks}</div>
        </div>`;
    }).join('');

    grid.querySelectorAll('input[data-pv-plugin]').forEach((cb) => {
      // 잠긴(정지된 플러그인) 체크박스는 클릭 자체를 막아 값이 항상 유지되게 한다.
      cb.addEventListener('click', (e) => {
        if (cb.getAttribute('data-pv-locked') === '1') {
          e.preventDefault();
        }
      });
      cb.addEventListener('change', () => {
        if (cb.getAttribute('data-pv-locked') === '1') return;
        const pid = cb.getAttribute('data-pv-plugin');
        const s = cb.getAttribute('data-pv-session');
        if (cb.checked) addChip(pid, s);
        else removeChip(pid, s);
      });
    });
  }

  // 일괄 선택/해제: 잠긴(정지된 플러그인) 체크박스는 값이 보존돼야 하므로 건드리지 않는다.
  function bulkSetAll(checkedValue) {
    grid.querySelectorAll('input[data-pv-plugin]').forEach((cb) => {
      if (cb.getAttribute('data-pv-locked') === '1') return;
      if (cb.checked === checkedValue) return;
      cb.checked = checkedValue;
      const pid = cb.getAttribute('data-pv-plugin');
      const s = cb.getAttribute('data-pv-session');
      if (checkedValue) addChip(pid, s);
      else removeChip(pid, s);
    });
  }

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      if (window.confirm('현재 목록에 보이는 모든(잠기지 않은) 플러그인을 전부 켭니다. 계속할까요?')) {
        bulkSetAll(true);
      }
    });
  }
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
      if (window.confirm('현재 목록에 보이는 모든(잠기지 않은) 플러그인을 전부 끕니다. 저장을 누르면 기존 선택이 사라집니다. 계속할까요?')) {
        bulkSetAll(false);
      }
    });
  }

  function refreshOnlyViewerTabs() {
    try {
      window.dispatchEvent(new CustomEvent('plugin_hub:config_updated'));
      if (typeof window.reloadPluginHubTabs === 'function') {
        window.reloadPluginHubTabs();
      }
    } catch (_) {}
  }

  function wrapSaveConfigApi() {
    try {
      if (!window.__origFetchForPluginHub) {
        window.__origFetchForPluginHub = window.fetch;
        window.fetch = async function (resource, options) {
          const response = await window.__origFetchForPluginHub.apply(this, arguments);
          try {
            const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
            if (url && url.includes('/api/media/metadata/plugins/save-config') && options && options.method === 'POST') {
              const cloned = response.clone();
              cloned.json().then((data) => {
                if (data && data.success) {
                  refreshOnlyViewerTabs();
                }
              }).catch(() => {});
            }
          } catch (_) {}
          return response;
        };
      }
    } catch (_) {}
  }

  async function load() {
    wrapSaveConfigApi();
    try {
      const res = await fetch(`/api/media/dashboard/widgets/${encodeURIComponent(pluginId)}/data?type=general`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '조회 실패');
      const catalog = Array.isArray(data.catalog) ? data.catalog : [];
      catalogById = {};
      catalog.forEach((p) => { catalogById[p.id] = p; });
      ensureOrderInputs();
      renderCards(catalog);
      renderLanes(catalog, data.orders || {});
      if (excludedInput && typeof data.excluded_ids === 'string') {
        excludedInput.value = data.excluded_ids;
      }
    } catch (err) {
      console.error('[PluginHub-Settings] load error:', err);
      grid.innerHTML = `<div class="pv-settings-error">플러그인 목록을 불러오지 못했습니다: ${esc(err.message || '오류')}</div>`;
    }
  }

  load();
})();
