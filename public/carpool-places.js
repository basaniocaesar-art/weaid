/* Place search for carpool pages (OpenStreetMap Nominatim, biased to Kerala).
   attachPlace(input) → input.place = { name, lat, lng } once a suggestion is picked. */
(function () {
  const css = document.createElement("style");
  css.textContent = ".pl-wrap{position:relative}.pl-list{position:absolute;left:0;right:0;top:100%;z-index:20;background:#fff;border:1px solid #e7ebf0;border-radius:12px;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,.08);overflow:hidden}.pl-list div{padding:10px 12px;font-size:14px;cursor:pointer;border-bottom:1px solid #f1f5f9}.pl-list div:hover{background:#f0fdfa}.pl-list small{display:block;color:#5b6573;font-size:12px}";
  document.head.appendChild(css);
  window.attachPlace = function (input, onPick) {
    const wrap = document.createElement("div"); wrap.className = "pl-wrap";
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    const list = document.createElement("div"); list.className = "pl-list"; list.hidden = true; wrap.appendChild(list);
    let t = null, last = "";
    input.addEventListener("input", () => {
      input.place = null; clearTimeout(t);
      const q = input.value.trim(); if (q.length < 3) { list.hidden = true; return; }
      t = setTimeout(async () => {
        if (q === last) return; last = q;
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=in&viewbox=74.8,12.8,77.5,8.1&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": "en" } });
          const d = await r.json();
          list.innerHTML = d.map((p, i) => { const parts = p.display_name.split(", "); return `<div data-i="${i}">${parts[0]}<small>${parts.slice(1, 4).join(", ")}</small></div>`; }).join("");
          list.hidden = !d.length;
          list.querySelectorAll("[data-i]").forEach((el) => el.onclick = () => {
            const p = d[+el.dataset.i]; const parts = p.display_name.split(", ");
            input.value = parts.slice(0, 2).join(", "); input.place = { name: input.value, lat: +p.lat, lng: +p.lon };
            list.hidden = true; if (onPick) onPick(input.place);
          });
        } catch { list.hidden = true; }
      }, 700);
    });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) list.hidden = true; });
  };
})();
