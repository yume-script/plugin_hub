(function () {
  "use strict";

  var SELF_ID = "plugin_hub";

  var root = document.querySelector("[data-ph-settings-root]");
  if (!root) return;

  var cardsEl = root.querySelector('[data-role="cards"]');

  var SESSION_LABELS = {
    general: "일반",
    adult: "성인",
    audiobook: "오디오",
    video: "비디오",
  };

  function getSession() {
    try {
      var params = new URLSearchParams(window.location.search);
      return params.get("type") || "general";
    } catch (e) {
      return "general";
    }
  }

  async function load() {
    try {
      var res = await fetch(
        "/api/media/dashboard/widgets/" + SELF_ID + "/data?type=" + encodeURIComponent(getSession()),
        { credentials: "same-origin" }
      );
      if (!res.ok) throw new Error("status " + res.status);
      var data = await res.json();
      render((data && data.catalog) || []);
    } catch (e) {
      cardsEl.innerHTML = '<div class="ph-status ph-error">플러그인 목록을 불러오지 못했습니다.</div>';
      console.error("[plugin_hub settings]", e);
    }
  }

  function render(catalog) {
    if (!catalog.length) {
      cardsEl.innerHTML = '<div class="ph-status">표시할 카테고리 뷰 플러그인이 없습니다.</div>';
      return;
    }

    cardsEl.innerHTML = "";
    catalog.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "ph-card";

      var head = document.createElement("div");
      head.className = "ph-card-head";

      var nameEl = document.createElement("span");
      nameEl.className = "ph-card-name";
      nameEl.textContent = item.name;

      var metaEl = document.createElement("span");
      metaEl.className = "ph-card-meta";
      metaEl.textContent = "v" + (item.version || "-") + " · " + item.id;

      head.appendChild(nameEl);
      head.appendChild(metaEl);
      card.appendChild(head);

      var row = document.createElement("div");
      row.className = "ph-card-sessions";

      (item.sessions || []).forEach(function (s) {
        var label = document.createElement("label");
        label.className = "ph-check";

        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "SHOW_" + item.id + "__" + s;
        cb.checked = !!(item.checked && item.checked[s]);

        label.appendChild(cb);
        label.appendChild(document.createTextNode(SESSION_LABELS[s] || s));
        row.appendChild(label);
      });

      card.appendChild(row);
      cardsEl.appendChild(card);
    });
  }

  load();
})();
