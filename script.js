(function () {
  "use strict";

  var SELF_ID = "plugin_hub";

  var root = document.querySelector("[data-ph-root]");
  if (!root) return;

  var tabsEl = root.querySelector('[data-role="tabs"]');
  var panesEl = root.querySelector('[data-role="panes"]');
  var statusEl = panesEl.querySelector('[data-role="status"]');

  var uiCache = Object.create(null); // pluginId -> {css, html, js}
  var activeId = null;

  function getSession() {
    try {
      var params = new URLSearchParams(window.location.search);
      var t = params.get("type");
      if (t) return t;
    } catch (e) {
      /* noop */
    }
    return "general";
  }

  function storageKey() {
    return "ph_last_tab__" + getSession();
  }

  async function fetchDashboardData() {
    var session = getSession();
    var res = await fetch(
      "/api/media/dashboard/widgets/" + SELF_ID + "/data?type=" + encodeURIComponent(session),
      { credentials: "same-origin" }
    );
    if (!res.ok) throw new Error("dashboard fetch failed: " + res.status);
    return res.json();
  }

  async function fetchViewerUI(pluginId) {
    if (uiCache[pluginId]) return uiCache[pluginId];
    var res = await fetch("/api/media/plugins/" + pluginId + "/ui", {
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error("ui fetch failed: " + res.status);
    var data = await res.json();
    uiCache[pluginId] = data;
    return data;
  }

  function cleanupPane(pluginId) {
    try {
      var registry = window.__bookOasisViewerCleanups;
      if (registry && typeof registry[pluginId] === "function") {
        registry[pluginId]();
        delete registry[pluginId];
      }
    } catch (e) {
      console.error("[plugin_hub] cleanup failed for", pluginId, e);
    }
  }

  function mountViewer(pluginId, container, ui) {
    var css = (ui && ui.css) || "";
    var html = (ui && ui.html) || "";
    var js = (ui && ui.js) || "";
    container.innerHTML = (css ? "<style>" + css + "</style>" : "") + html;
    if (js) {
      try {
        // eslint-disable-next-line no-new-func
        var fn = new Function("pluginId", "container", js);
        fn(pluginId, container);
      } catch (e) {
        console.error("[plugin_hub] mount script error for", pluginId, e);
      }
    }
  }

  function setActiveTabButton(pluginId) {
    var buttons = tabsEl.querySelectorAll(".ph-tab");
    for (var i = 0; i < buttons.length; i++) {
      var el = buttons[i];
      var isActive = el.getAttribute("data-tab-id") === pluginId;
      el.classList.toggle("active", isActive);
    }
  }

  async function switchTo(pluginId) {
    if (activeId === pluginId) return;

    if (activeId) {
      var prevPane = panesEl.querySelector('[data-pane="' + activeId + '"]');
      cleanupPane(activeId);
      if (prevPane) prevPane.style.display = "none";
    }

    setActiveTabButton(pluginId);

    var pane = panesEl.querySelector('[data-pane="' + pluginId + '"]');
    if (!pane) {
      pane = document.createElement("div");
      pane.className = "ph-pane";
      pane.setAttribute("data-pane", pluginId);
      panesEl.appendChild(pane);
      pane.innerHTML = '<div class="ph-status">불러오는 중...</div>';
      try {
        var ui = await fetchViewerUI(pluginId);
        mountViewer(pluginId, pane, ui);
      } catch (e) {
        pane.innerHTML = '<div class="ph-status ph-error">뷰어를 불러오지 못했습니다.</div>';
        console.error("[plugin_hub]", e);
      }
    }

    pane.style.display = "";
    activeId = pluginId;

    try {
      localStorage.setItem(storageKey(), pluginId);
    } catch (e) {
      /* noop */
    }
  }

  function renderTabs(tabs) {
    tabsEl.innerHTML = "";
    tabs.forEach(function (tab) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ph-tab";
      btn.setAttribute("data-tab-id", tab.id);
      btn.innerHTML =
        '<i class="' +
        (tab.icon || "fa-solid fa-puzzle-piece") +
        '"></i><span>' +
        tab.title +
        "</span>";
      btn.addEventListener("click", function () {
        switchTo(tab.id);
      });
      tabsEl.appendChild(btn);
    });
  }

  async function init() {
    try {
      var data = await fetchDashboardData();
      var tabs = (data && data.viewers) || [];
      if (!tabs.length) {
        statusEl.textContent =
          "통합 표시로 선택된 플러그인이 없습니다. 환경설정에서 표시할 플러그인을 선택하세요.";
        return;
      }
      renderTabs(tabs);

      var initial = tabs[0].id;
      try {
        var saved = localStorage.getItem(storageKey());
        if (saved && tabs.some(function (t) { return t.id === saved; })) {
          initial = saved;
        }
      } catch (e) {
        /* noop */
      }

      statusEl.remove();
      await switchTo(initial);
    } catch (e) {
      statusEl.textContent = "뷰어 목록을 불러오지 못했습니다.";
      console.error("[plugin_hub]", e);
    }
  }

  init();
})();
