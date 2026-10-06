/** PRIORA offline-first decision dashboard. */
"use strict";

const SCREENING_THRESHOLD = 0.35;
const TOP_K_PERCENT = 0.10;
const PAGE_SIZE = 25;
const DEFAULT_WEIGHTS = Object.freeze({ h: 0.40, v: 0.30, c: 0.30 });

const state = {
  dataset: null,
  geojson: null,
  month: null,
  province: "ALL",
  query: "",
  status: "ALL",
  page: 1,
  sortKey: "rank",
  sortDirection: "asc",
  selectedRegionId: null,
  weights: { ...DEFAULT_WEIGHTS },
  currentNational: [],
  lastFocusedElement: null,
  mapReady: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", async () => {
  bindControls();
  try {
    const [dataResponse, mapResponse] = await Promise.all([
      fetch("data/priora_data_fast.json"),
      fetch("data/priora_regions.geojson")
    ]);
    if (!dataResponse.ok) throw new Error("Dataset prioritas tidak dapat dimuat.");
    if (!mapResponse.ok) throw new Error("Geometri peta tidak dapat dimuat.");
    state.dataset = await dataResponse.json();
    state.geojson = await mapResponse.json();
    initializeDataControls();
    buildMap();
    renderDashboard();
    $("#loading-screen").classList.add("hidden");
  } catch (error) {
    console.error(error);
    $("#loading-screen").classList.add("hidden");
    showToast(`Gagal menyiapkan dashboard: ${error.message}`, 8000);
    $("#table-body").innerHTML = `<tr><td colspan="8" class="empty-cell">${escapeHtml(error.message)}</td></tr>`;
  }
});

function initializeDataControls() {
  state.month = state.dataset.months[0];

  const provinces = [...new Set(state.dataset.records.map(row => row.p_name))].sort((a, b) => a.localeCompare(b, "id"));
  $("#select-province").innerHTML = `<option value="ALL">Seluruh Indonesia</option>${provinces.map(name => `<option value="${escapeAttribute(name)}">${escapeHtml(name)}</option>`).join("")}`;
}

function bindControls() {
  $$(".nav-link").forEach(link => link.addEventListener("click", () => updateActiveNavigation(link.getAttribute("href"))));
  window.addEventListener("hashchange", () => updateActiveNavigation(window.location.hash));
  updateActiveNavigation(window.location.hash);

  $("#select-province").addEventListener("change", event => {
    state.province = event.target.value;
    state.page = 1;
    renderDashboard();
  });

  let searchTimer;
  $("#input-search").addEventListener("input", event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = event.target.value.trim().toLocaleLowerCase("id");
      state.page = 1;
      renderDashboard();
    }, 120);
  });

  $$(".filter-chip").forEach(button => button.addEventListener("click", () => {
    state.status = button.dataset.status;
    state.page = 1;
    $$(".filter-chip").forEach(item => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderDashboard();
  }));

  $$(".sort-button").forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.sort;
    if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    else {
      state.sortKey = key;
      state.sortDirection = "asc";
    }
    state.page = 1;
    updateSortControls();
    renderTable(getDisplayedRecords());
  }));
  $("#mobile-sort-key").addEventListener("change", event => {
    state.sortKey = event.target.value;
    state.sortDirection = "asc";
    state.page = 1;
    updateSortControls();
    renderTable(getDisplayedRecords());
  });
  $("#mobile-sort-direction").addEventListener("click", () => {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    state.page = 1;
    updateSortControls();
    renderTable(getDisplayedRecords());
  });

  $("#btn-prev-page").addEventListener("click", () => { state.page = Math.max(1, state.page - 1); renderTable(getDisplayedRecords()); });
  $("#btn-next-page").addEventListener("click", () => { state.page += 1; renderTable(getDisplayedRecords()); });

  $("#btn-selected-detail").addEventListener("click", () => {
    if (state.selectedRegionId) openRegionModal(state.selectedRegionId);
  });
  $("#btn-close-modal").addEventListener("click", closeRegionModal);
  $("#modal-region").addEventListener("click", event => { if (event.target === $("#modal-region")) closeRegionModal(); });
  document.addEventListener("keydown", handleGlobalKeydown);
}

function updateActiveNavigation(hash) {
  const target = $$(".nav-link").some(link => link.getAttribute("href") === hash) ? hash : "#main-content";
  $$(".nav-link").forEach(link => link.classList.toggle("active", link.getAttribute("href") === target));
}

function renderDashboard() {
  if (!state.dataset || !state.month) return;
  const monthRecords = state.dataset.records.filter(row => row.m === state.month);
  state.currentNational = calculateTopsis(monthRecords, state.weights);

  if (!state.selectedRegionId || !state.currentNational.some(row => String(row.r_id) === String(state.selectedRegionId))) {
    state.selectedRegionId = state.currentNational[0] ? String(state.currentNational[0].r_id) : null;
  }

  updateDecisionSummary();
  updateMap();
  updateSelectedRegionSummary();
  renderTopPriorities();
  renderTable(getDisplayedRecords());
}

function calculateTopsis(records, requestedWeights) {
  if (!records.length) return [];
  const screenedIn = [];
  const screenedOut = [];
  records.forEach(record => {
    const validHvc = record.v !== null && record.c !== null;
    if (record.h >= SCREENING_THRESHOLD && validHvc) screenedIn.push({ ...record, scr_status: "screened_in" });
    else screenedOut.push({ ...record, scr_status: validHvc ? "screened_out" : "missing_hvc", calc_topsis_score: null, calc_topsis_rank: null });
  });
  if (!screenedIn.length) return screenedOut.sort((a, b) => b.h - a.h);

  const total = requestedWeights.h + requestedWeights.v + requestedWeights.c || 1;
  const w = { h: requestedWeights.h / total, v: requestedWeights.v / total, c: requestedWeights.c / total };
  const norms = {
    h: Math.sqrt(screenedIn.reduce((sum, row) => sum + row.h ** 2, 0)) || 1,
    v: Math.sqrt(screenedIn.reduce((sum, row) => sum + row.v ** 2, 0)) || 1,
    c: Math.sqrt(screenedIn.reduce((sum, row) => sum + row.c ** 2, 0)) || 1
  };
  const weighted = screenedIn.map(row => ({
    row,
    h: row.h / norms.h * w.h,
    v: row.v / norms.v * w.v,
    c: row.c / norms.c * w.c
  }));
  const positive = { h: Math.max(...weighted.map(row => row.h)), v: Math.max(...weighted.map(row => row.v)), c: Math.min(...weighted.map(row => row.c)) };
  const negative = { h: Math.min(...weighted.map(row => row.h)), v: Math.min(...weighted.map(row => row.v)), c: Math.max(...weighted.map(row => row.c)) };
  const ranked = weighted.map(item => {
    const dPositive = Math.hypot(item.h - positive.h, item.v - positive.v, item.c - positive.c);
    const dNegative = Math.hypot(item.h - negative.h, item.v - negative.v, item.c - negative.c);
    return { ...item.row, calc_topsis_score: dNegative / (dPositive + dNegative + 1e-12) };
  }).sort((a, b) => b.calc_topsis_score - a.calc_topsis_score).map((row, index) => ({ ...row, calc_topsis_rank: index + 1 }));
  screenedOut.sort((a, b) => b.h - a.h);
  return [...ranked, ...screenedOut];
}

function updateDecisionSummary() {
  const topK = Math.ceil(state.currentNational.length * TOP_K_PERCENT);
  const screened = state.currentNational.filter(row => row.scr_status === "screened_in");
  const priorities = screened.filter(row => row.calc_topsis_rank <= topK);
  const top = screened[0];
  $("#kpi-priority").textContent = priorities.length.toLocaleString("id-ID");
  $("#kpi-screened").textContent = screened.length.toLocaleString("id-ID");
  $("#kpi-total").textContent = state.currentNational.length.toLocaleString("id-ID");
  $("#kpi-top-region").textContent = top ? top.d_name : "—";
  $("#kpi-top-region-province").textContent = top ? top.p_name : "Tidak ada wilayah yang lolos penyaringan";
}

function getDisplayedRecords() {
  const topK = Math.ceil(state.currentNational.length * TOP_K_PERCENT);
  return state.currentNational.filter(row => {
    if (state.province !== "ALL" && row.p_name !== state.province) return false;
    if (state.query && !`${row.d_name} ${row.p_name}`.toLocaleLowerCase("id").includes(state.query)) return false;
    if (state.status === "priority") return row.scr_status === "screened_in" && row.calc_topsis_rank <= topK;
    if (state.status === "screened_in") return row.scr_status === "screened_in";
    if (state.status === "screened_out") return row.scr_status !== "screened_in";
    return true;
  });
}

function renderTopPriorities() {
  const rows = state.currentNational.filter(row => row.scr_status === "screened_in").slice(0, 10);
  $("#top-priority-list").innerHTML = rows.map(row => {
    return `<li><button class="priority-item" type="button" data-region-id="${escapeAttribute(row.r_id)}" aria-label="Buka detail ${escapeAttribute(row.d_name)}, peringkat ${row.calc_topsis_rank}">
      <span class="priority-rank">${row.calc_topsis_rank}</span>
      <span class="priority-name"><strong>${escapeHtml(row.d_name)}</strong><span>${escapeHtml(row.p_name)}</span>
        <span class="micro-profile" aria-label="Ancaman ${percent(row.h)}, kerentanan ${percent(row.v)}, kapasitas ${percent(row.c)}">
          <i style="--value:${row.h * 100}%;--color:var(--cyan)"></i><i style="--value:${row.v * 100}%;--color:var(--orange)"></i><i style="--value:${(1 - row.c) * 100}%;--color:var(--red)"></i>
        </span>
      </span>
      <span class="priority-score"><strong>${Math.round(row.calc_topsis_score * 100)}/100</strong><span class="rank-delta">indeks</span></span>
    </button></li>`;
  }).join("");
  $$(".priority-item").forEach(button => button.addEventListener("click", () => selectRegion(button.dataset.regionId, true)));
}

function renderTable(records) {
  const sortedRecords = sortRecords(records);
  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), totalPages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = sortedRecords.slice(start, start + PAGE_SIZE);
  const topK = Math.ceil(state.currentNational.length * TOP_K_PERCENT);
  $("#table-body").innerHTML = pageRows.length ? pageRows.map(row => {
    const priority = row.scr_status === "screened_in" && row.calc_topsis_rank <= topK;
    const badge = priority ? ["Prioritas intervensi", "priority"] : row.scr_status === "screened_in" ? ["Lolos screening", "screened"] : ["Pemantauan rutin", "monitored"];
    return `<tr>
      <td data-label="Peringkat"><span class="rank-badge ${priority ? "top" : ""}">${row.calc_topsis_rank ? `#${row.calc_topsis_rank}` : "—"}</span></td>
      <td data-label="Wilayah" class="region-cell"><strong>${escapeHtml(row.d_name)}</strong><span>${escapeHtml(row.p_name)}</span></td>
      <td data-label="Peluang banjir"><strong>${percent(row.h)}</strong></td>
      <td data-label="Kerentanan">${row.v === null ? "N/A" : percent(row.v)}</td>
      <td data-label="Kapasitas">${row.c === null ? "N/A" : percent(row.c)}</td>
      <td data-label="Skor prioritas">${row.calc_topsis_score === null ? "—" : `${Math.round(row.calc_topsis_score * 100)}/100`}</td>
      <td data-label="Status"><span class="badge ${badge[1]}">${badge[0]}</span></td>
      <td><button type="button" class="detail-button" data-region-id="${escapeAttribute(row.r_id)}" aria-label="Lihat detail ${escapeAttribute(row.d_name)}">Detail</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="8" class="empty-cell">Tidak ada wilayah yang sesuai dengan filter.</td></tr>`;
  $("#table-count").textContent = sortedRecords.length ? `Menampilkan ${start + 1}–${Math.min(start + PAGE_SIZE, sortedRecords.length)} dari ${sortedRecords.length} wilayah` : "0 wilayah";
  $("#page-indicator").textContent = `Halaman ${state.page} dari ${totalPages}`;
  $("#btn-prev-page").disabled = state.page <= 1;
  $("#btn-next-page").disabled = state.page >= totalPages;
  $$(".detail-button").forEach(button => button.addEventListener("click", () => openRegionModal(button.dataset.regionId)));
}

function sortRecords(records) {
  const direction = state.sortDirection === "asc" ? 1 : -1;
  const statusOrder = row => {
    const topK = Math.ceil(state.currentNational.length * TOP_K_PERCENT);
    if (row.scr_status === "screened_in" && row.calc_topsis_rank <= topK) return "Prioritas intervensi";
    if (row.scr_status === "screened_in") return "Lolos screening";
    return "Pemantauan rutin";
  };
  const valueFor = row => ({
    rank: row.calc_topsis_rank,
    district: `${row.d_name} ${row.p_name}`,
    hazard: row.h,
    vulnerability: row.v,
    capacity: row.c,
    score: row.calc_topsis_score,
    status: statusOrder(row)
  })[state.sortKey];

  return records.map((row, index) => ({ row, index })).sort((a, b) => {
    const aValue = valueFor(a.row), bValue = valueFor(b.row);
    const aMissing = aValue === null || aValue === undefined || Number.isNaN(aValue);
    const bMissing = bValue === null || bValue === undefined || Number.isNaN(bValue);
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (aMissing && bMissing) return a.index - b.index;
    const comparison = typeof aValue === "string"
      ? aValue.localeCompare(bValue, "id", { sensitivity: "base", numeric: true })
      : aValue - bValue;
    return comparison === 0 ? a.index - b.index : comparison * direction;
  }).map(item => item.row);
}

function updateSortControls() {
  $$(".sort-button").forEach(button => {
    const active = button.dataset.sort === state.sortKey;
    const header = button.closest("th");
    button.classList.toggle("active", active);
    button.querySelector("span").textContent = active ? (state.sortDirection === "asc" ? "↑" : "↓") : "↕";
    header.setAttribute("aria-sort", active ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
  });
  $("#mobile-sort-key").value = state.sortKey;
  const directionButton = $("#mobile-sort-direction");
  const ascending = state.sortDirection === "asc";
  directionButton.innerHTML = `${ascending ? "Naik" : "Turun"} <span aria-hidden="true">${ascending ? "↑" : "↓"}</span>`;
  directionButton.setAttribute("aria-label", `Ubah arah pengurutan menjadi ${ascending ? "menurun" : "menaik"}`);
}

function buildMap() {
  const layer = $("#map-layer");
  const fragment = document.createDocumentFragment();
  state.geojson.features.forEach(feature => {
    const regionId = String(feature.properties.region_id);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", geometryToPath(feature.geometry.coordinates));
    path.setAttribute("class", "map-region status-monitored");
    path.setAttribute("data-region-id", regionId);
    path.setAttribute("tabindex", "0");
    path.setAttribute("role", "button");
    path.setAttribute("aria-label", `${feature.properties.district}, ${feature.properties.province}`);
    path.addEventListener("click", () => selectRegion(regionId, false));
    path.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectRegion(regionId, false); }
    });
    path.addEventListener("pointerenter", event => showMapTooltip(event, regionId));
    path.addEventListener("pointermove", event => positionMapTooltip(event));
    path.addEventListener("pointerleave", hideMapTooltip);
    fragment.appendChild(path);
  });
  layer.replaceChildren(fragment);
  $("#map-empty").hidden = true;
  state.mapReady = true;
}

function geometryToPath(multiPolygon) {
  const minLon = 94.0, maxLon = 141.5, minLat = -11.5, maxLat = 6.5;
  const project = ([lon, lat]) => [((lon - minLon) / (maxLon - minLon)) * 1000, ((maxLat - lat) / (maxLat - minLat)) * 390];
  let output = "";
  multiPolygon.forEach(polygon => polygon.forEach(ring => {
    ring.forEach((point, index) => {
      const [x, y] = project(point);
      output += `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    output += "Z";
  }));
  return output;
}

function updateMap() {
  if (!state.mapReady) return;
  const rowById = new Map(state.currentNational.map(row => [String(row.r_id), row]));
  const topK = Math.ceil(state.currentNational.length * TOP_K_PERCENT);
  $$(".map-region").forEach(path => {
    const row = rowById.get(path.dataset.regionId);
    const priority = row && row.scr_status === "screened_in" && row.calc_topsis_rank <= topK;
    const statusClass = priority ? "status-priority" : row && row.scr_status === "screened_in" ? "status-screened" : "status-monitored";
    path.classList.remove("status-priority", "status-screened", "status-monitored", "selected", "dimmed");
    path.classList.add(statusClass);
    const visible = row && (state.province === "ALL" || row.p_name === state.province) && (!state.query || `${row.d_name} ${row.p_name}`.toLocaleLowerCase("id").includes(state.query));
    if (!visible) path.classList.add("dimmed");
    if (path.dataset.regionId === String(state.selectedRegionId)) path.classList.add("selected");
  });
}

function showMapTooltip(event, regionId) {
  const row = state.currentNational.find(item => String(item.r_id) === String(regionId));
  if (!row) return;
  const topK = Math.ceil(state.currentNational.length * TOP_K_PERCENT);
  const status = row.scr_status === "screened_in" && row.calc_topsis_rank <= topK ? "Prioritas intervensi" : row.scr_status === "screened_in" ? "Lolos screening" : "Pemantauan rutin";
  $("#map-tooltip").innerHTML = `<strong>${escapeHtml(row.d_name)}</strong>${escapeHtml(row.p_name)}<br>${status} · P(banjir) ${percent(row.h)}`;
  $("#map-tooltip").classList.add("visible");
  positionMapTooltip(event);
}

function positionMapTooltip(event) {
  const stage = $("#map-stage").getBoundingClientRect();
  const tooltip = $("#map-tooltip");
  tooltip.style.left = `${Math.min(stage.width - 245, Math.max(8, event.clientX - stage.left + 12))}px`;
  tooltip.style.top = `${Math.max(8, event.clientY - stage.top + 12)}px`;
}
function hideMapTooltip() { $("#map-tooltip").classList.remove("visible"); }

function selectRegion(regionId, openDetail = false) {
  state.selectedRegionId = String(regionId);
  updateMap();
  updateSelectedRegionSummary();
  if (openDetail) openRegionModal(regionId);
}

function updateSelectedRegionSummary() {
  const row = state.currentNational.find(item => String(item.r_id) === String(state.selectedRegionId));
  if (!row) return;
  $("#selected-region-name").textContent = `${row.d_name}, ${row.p_name}`;
  $("#selected-region-reason").textContent = buildReason(row);
  $("#btn-selected-detail").disabled = false;
}

function openRegionModal(regionId) {
  const row = state.currentNational.find(item => String(item.r_id) === String(regionId));
  if (!row) return;
  state.selectedRegionId = String(regionId);
  state.lastFocusedElement = document.activeElement;
  const topK = Math.ceil(state.currentNational.length * TOP_K_PERCENT);
  const priority = row.scr_status === "screened_in" && row.calc_topsis_rank <= topK;
  $("#modal-status-kicker").textContent = priority ? "Prioritas intervensi nasional" : row.scr_status === "screened_in" ? "Lolos penyaringan hazard" : "Pemantauan rutin";
  $("#modal-title").textContent = row.d_name;
  $("#modal-subtitle").textContent = row.p_name;
  $("#modal-rank").textContent = row.calc_topsis_rank ? `#${row.calc_topsis_rank}` : "—";
  $("#modal-score").textContent = row.calc_topsis_score === null ? "—" : `${Math.round(row.calc_topsis_score * 100)}/100`;
  $("#modal-h").textContent = percent(row.h);
  $("#modal-reason").textContent = buildReason(row);
  $("#modal-v").textContent = row.v === null ? "N/A" : `${levelLabel(row.v)} · ${percent(row.v)}`;
  $("#modal-c").textContent = row.c === null ? "N/A" : `${capacityLabel(row.c)} · ${percent(row.c)}`;
  $("#modal-v-bar").style.width = row.v === null ? "0" : `${row.v * 100}%`;
  $("#modal-c-bar").style.width = row.c === null ? "0" : `${row.c * 100}%`;
  $("#modal-pov").textContent = row.pov_rate === null ? "N/A" : `${row.pov_rate.toFixed(2)}%`;
  $("#modal-pdrb").textContent = row.pdrb === null ? "N/A" : `Rp ${row.pdrb.toLocaleString("id-ID")} ribu`;
  $("#modal-ikd").textContent = row.ikd === null ? "N/A" : row.ikd.toFixed(2);
  $("#modal-screening-status").textContent = row.scr_status === "screened_in" ? "Lolos" : row.scr_status === "missing_hvc" ? "Data HVC belum lengkap" : "Tidak lolos";
  $("#modal-action").textContent = buildAction(row, priority);
  $("#modal-legacy").textContent = `Region ID ${row.r_id} adalah kunci boundary legacy untuk join spasial, bukan kode administrasi resmi terkini.`;
  renderTrend(row.r_id);
  document.body.classList.add("modal-open");
  $("#modal-region").classList.add("open");
  $("#modal-region").setAttribute("aria-hidden", "false");
  $("#btn-close-modal").focus();
}

function closeRegionModal() {
  document.body.classList.remove("modal-open");
  $("#modal-region").classList.remove("open");
  $("#modal-region").setAttribute("aria-hidden", "true");
  updateMap();
  updateSelectedRegionSummary();
  state.lastFocusedElement?.focus();
}

function renderTrend(regionId) {
  const rows = state.dataset.records.filter(row => String(row.r_id) === String(regionId) && row.m <= state.month).sort((a, b) => a.m.localeCompare(b.m)).slice(-12);
  const svg = $("#trend-chart");
  if (!rows.length) { svg.innerHTML = ""; $("#trend-caption").textContent = "Data tidak tersedia"; return; }
  const width = 560, height = 100, pad = 8;
  const points = rows.map((row, index) => {
    const x = pad + index * ((width - pad * 2) / Math.max(1, rows.length - 1));
    const y = height - pad - row.h * (height - pad * 2);
    return [x, y, row.h];
  });
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)[0].toFixed(1)},${height - pad} L${points[0][0].toFixed(1)},${height - pad} Z`;
  svg.innerHTML = `<path class="trend-area" d="${area}"></path><path class="trend-line" d="${line}"></path>${points.map(([x, y], index) => `<circle class="trend-dot" cx="${x}" cy="${y}" r="${index === points.length - 1 ? 4 : 2.5}"><title>Peluang ${percent(rows[index].h)}</title></circle>`).join("")}`;
  const change = points.at(-1)[2] - points[0][2];
  $("#trend-caption").textContent = `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)} poin persentase`;
}

function buildReason(row) {
  if (row.scr_status !== "screened_in") return `Peluang laporan banjir ${percent(row.h)} berada di bawah ambang penyaringan 35%, sehingga wilayah ditempatkan pada pemantauan rutin.`;
  return `Peluang laporan banjir ${levelLabel(row.h).toLowerCase()} (${percent(row.h)}), kerentanan ${levelLabel(row.v).toLowerCase()}, dan kapasitas daerah ${capacityLabel(row.c).toLowerCase()} menempatkan wilayah ini pada peringkat nasional #${row.calc_topsis_rank}.`;
}

function buildAction(row, priority) {
  if (priority) return "Prioritaskan verifikasi lapangan, kesiapan logistik dan posko, serta koordinasi peringatan dini dengan BPBD setempat.";
  if (row.scr_status === "screened_in") return "Pertahankan pemantauan intensif dan verifikasi kesiapan sumber daya jika indikator lapangan memburuk.";
  return "Lanjutkan pemantauan rutin. Eskalasi keputusan harus mempertimbangkan informasi lapangan dan peringatan resmi.";
}

function levelLabel(value) { if (value === null) return "Tidak tersedia"; return value >= .66 ? "Tinggi" : value >= .33 ? "Sedang" : "Rendah"; }
function capacityLabel(value) { if (value === null) return "Tidak tersedia"; return value >= .66 ? "Tinggi" : value >= .33 ? "Sedang" : "Rendah"; }

function handleGlobalKeydown(event) {
  if (event.key === "Escape") {
    if ($("#modal-region").classList.contains("open")) closeRegionModal();
  }
  const openContainer = $("#modal-region").classList.contains("open") ? $(".region-modal") : null;
  if (event.key === "Tab" && openContainer) trapFocus(event, openContainer);
}

function trapFocus(event, container) {
  const focusable = $$Within(container, 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function $$Within(container, selector) { return Array.from(container.querySelectorAll(selector)); }

let toastTimer;
function showToast(message, duration = 3200) {
  clearTimeout(toastTimer);
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

function percent(value) { return value === null || Number.isNaN(value) ? "N/A" : `${(value * 100).toFixed(1)}%`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function escapeAttribute(value) { return escapeHtml(value); }
