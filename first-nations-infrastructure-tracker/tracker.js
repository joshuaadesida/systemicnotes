"use strict";

const data = globalThis.TRACKER_SNAPSHOT;
const get = (id) => document.getElementById(id);
const integer = new Intl.NumberFormat("en-CA");
const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" });
const dateLabel = (value) => dateFormat.format(new Date(value + "T00:00:00Z"));
const millions = (amount) => "$" + (amount / 1_000_000).toFixed(1) + "M";
const rate = (row) => 100 * row.majorRepairs / row.total;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svg(tag, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function sourceLink(title, url) {
  const link = element("a", title, "source-link");
  link.href = url;
  return link;
}

const layers = {
  water: {
    filter: "Active advisory only",
    legend: [["active", "Active long-term advisory"], ["lifted", "Lifted record only"], ["default", "No record in export"]],
  },
  roads: {
    filter: "Winter road listing only",
    legend: [["road", "Listed winter route"], ["default", "No matched listing"]],
  },
  funding: {
    filter: "Funded examples only",
    legend: [["funding", "Named project in ISC release"], ["default", "Outside the five-project release"]],
  },
};

const affiliations = ["Treaty 1", "Treaty 2", "Treaty 3", "Treaty 4", "Treaty 5", "Treaty 6", "Treaty 10", "Dakota Nations"];
const map = get("map");
const frame = get("map-window");
const viewport = get("map-viewport");
const points = get("map-points");
const picker = get("nation");
const query = get("query");
const layer = get("layer");
const treaty = get("treaty");
const only = get("matches-only");
const profileTools = get("profile-tools");
const featureByBand = new Map(data?.collection.features.map((feature) => [feature.id, feature]));
const state = { selected: null, compared: ["", ""], comparing: false, initializing: true, view: { x: 0, y: 0, zoom: 1 }, mapWidth: 760, drag: null };
const mobile = matchMedia("(max-width: 760px)");
const caseBand = "306";
const projection = { x: 376, y: 24, longitude: -96.8, latitude: 60.3, scaleX: 24.8, scaleY: 43.7 };
const maxMapZoom = 4;

function hasActive(nation) {
  return nation.advisories.some((record) => record.status === "Active");
}

function markerKind(nation) {
  if (layer.value === "roads") return nation.roadListing ? "road" : "default";
  if (layer.value === "funding") return nation.fundingExample ? "funding" : "default";
  if (hasActive(nation)) return "active";
  return nation.advisories.length ? "lifted" : "default";
}

function normalized(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function visibleNations() {
  const term = normalized(query.value);
  const bandTerm = term.replace(/^0+(?=\d)/, "");
  return data.collection.features.filter(({ properties: nation }) => {
    return (!treaty.value || nation.treaty === treaty.value)
      && (!only.checked || markerKind(nation) === layers[layer.value].legend[0][0])
      && (!term || normalized(nation.name).includes(term) || nation.band.startsWith(bandTerm));
  });
}

function project([lng, lat]) {
  const { x, y, longitude, latitude, scaleX, scaleY } = projection;
  return [x + (lng - longitude) * scaleX, y + (latitude - lat) * scaleY];
}

function pathFor(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map((polygon) => polygon.map((ring) =>
    ring.map((coord, index) => (index === 0 ? "M" : "L") + project(coord).map((value) => value.toFixed(2)).join(",")).join("") + "Z"
  ).join("")).join("");
}

function basemap() {
  const base = get("map-base");
  const provinces = [...data.provinces].sort((a, b) => Number(a.name === "Manitoba") - Number(b.name === "Manitoba"));
  for (const { name, geometry } of provinces) {
    base.append(svg("path", { class: name === "Manitoba" ? "province mb" : "province", d: pathFor(geometry), "fill-rule": "evenodd" }));
  }
  for (const { geometry } of data.lakes) {
    base.append(svg("path", { class: "lake", d: pathFor(geometry), "fill-rule": "evenodd" }));
  }
  const labels = [
    ["MANITOBA", -98.3, 55.65, "map-region"],
    ["SASKATCHEWAN", -106.3, 53.8, "map-region"],
    ["ONTARIO", -89.85, 51.9, "map-region"],
    ["NUNAVUT", -98.3, 60.65, "map-region"],
    ["Hudson Bay", -89.4, 58.5, "map-water"],
    ["Lake Winnipeg", -98.25, 52.05, "map-water"],
    ["Winnipeg", -97, 49.86, "map-place"],
    ["Thompson", -97.72, 55.87, "map-place"],
    ["Churchill", -94.12, 58.79, "map-place"],
  ];
  for (const [text, lng, lat, className] of labels) {
    const [x, y] = project([lng, lat]);
    const anchor = svg("g", { transform: "translate(" + x + " " + y + ")" });
    const label = svg("text", { class: className });
    label.textContent = text;
    anchor.append(label);
    get("map-context").append(anchor);
  }
}

function updateView() {
  const { x, y, zoom } = state.view;
  viewport.setAttribute("transform", "translate(" + x + " " + y + ") scale(" + zoom + ")");
  get("zoom-in").disabled = zoom >= maxMapZoom;
  get("zoom-out").disabled = zoom <= 1;
  for (const marker of points.children) {
    const size = Number(marker.dataset.radius) / zoom;
    resizeMarker(marker.querySelector(".visible"), size);
    resizeMarker(marker.querySelector(".halo"), size + 3 / zoom);
    marker.querySelector(".hit").setAttribute("r", Math.max(size, 8 / zoom));
  }
  for (const label of get("map-context").querySelectorAll("text")) {
    label.setAttribute("transform", "scale(" + 1 / zoom + ")");
  }
  positionMapLabel();
}

function resizeMarker(node, size) {
  if (node.tagName === "polygon") {
    node.setAttribute("points", "0," + -size + " " + size + ",0 0," + size + " " + -size + ",0");
  } else {
    node.setAttribute("r", size);
  }
}

function wrapMapLabel(name) {
  const lines = [""];
  for (const word of name.split(" ")) {
    const line = lines.at(-1);
    if (line && line.length + word.length > 23) lines.push(word);
    else lines[lines.length - 1] = line ? line + " " + word : word;
  }
  return lines;
}

function positionMapLabel() {
  const label = get("map-label");
  label.replaceChildren();
  const feature = featureByBand.get(state.selected);
  if (!feature) return;
  const [x, y] = project(feature.geometry.coordinates);
  const { x: offset, y: offsetY, zoom } = state.view;
  const west = (760 - state.mapWidth) / 2;
  const sx = x * zoom + offset;
  const sy = y * zoom + offsetY;
  if (sx < west || sx > west + state.mapWidth || sy < 0 || sy > 560) return;
  const left = sx > west + state.mapWidth - 174;
  const dx = left ? -13 : 13;
  const lines = wrapMapLabel(feature.properties.name);
  const dy = sy > 505 ? -(lines.length - 1) * 15 : 0;
  const text = svg("text", {
    class: "map-selection", transform: "translate(" + x + " " + y + ") scale(" + 1 / zoom + ")",
    "text-anchor": left ? "end" : "start",
  });
  for (const [index, line] of lines.entries()) {
    const span = svg("tspan", { x: dx, y: dy + index * 15 + 4 });
    span.textContent = line;
    text.append(span);
  }
  label.append(text);
}

function resetView() {
  state.view = { x: 0, y: 0, zoom: 1 };
  updateView();
}

function zoomBy(factor) {
  const old = state.view;
  const zoom = Math.max(1, Math.min(maxMapZoom, old.zoom * factor));
  if (zoom === 1) return resetView();
  const scale = zoom / old.zoom;
  state.view = { x: 380 - (380 - old.x) * scale, y: 280 - (280 - old.y) * scale, zoom };
  updateView();
}

function focusMap(feature, zoom = Math.max(1.7, state.view.zoom)) {
  const [x, y] = project(feature.geometry.coordinates);
  state.view = { x: 380 - x * zoom, y: 280 - y * zoom, zoom };
  updateView();
}

function tooltip(event, label) {
  const tip = get("map-tip");
  tip.textContent = label;
  tip.hidden = false;
  const bounds = frame.getBoundingClientRect();
  const x = Math.min(frame.clientWidth - tip.offsetWidth - 8, Math.max(8, event.clientX - bounds.left + 12));
  const y = Math.max(8, Math.min(frame.clientHeight - tip.offsetHeight - 8, event.clientY - bounds.top - tip.offsetHeight - 7));
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function setSelected(band, recenter = false) {
  state.selected = band;
  const feature = featureByBand.get(band);
  picker.value = band ?? "";
  for (const marker of points.children) {
    const selected = marker.dataset.band === band;
    marker.classList.toggle("selected", selected);
    marker.setAttribute("aria-pressed", String(selected));
  }
  showProfile(feature?.properties);
  updateProfileTools();
  updateActiveSelection();
  if (feature && recenter) focusMap(feature);
  else positionMapLabel();
  syncUrl();
}

function openSelection(band, recenter = false) {
  setSelected(band, recenter);
  if (mobile.matches) {
    const profile = get("profile").querySelector("h3");
    get("community-profile").scrollIntoView({ block: "start" });
    profile?.focus({ preventScroll: true });
  }
}

function activeFilterOn() {
  return layer.value === "water" && only.checked;
}

function updateActiveSelection() {
  for (const button of get("active-results").children) {
    button.setAttribute("aria-pressed", String(button.dataset.band === state.selected));
  }
}

function drawActiveList(results) {
  get("filter-active").setAttribute("aria-pressed", String(activeFilterOn()));
  get("active-list").hidden = !activeFilterOn();
  const list = get("active-results");
  list.replaceChildren();
  if (!activeFilterOn()) return;
  if (!results.length) list.append(element("p", "No active advisories match these filters.", "muted"));
  for (const { id, properties: nation } of results) {
    const button = element("button", null, "active-result");
    button.type = "button";
    button.dataset.band = id;
    const diamond = element("span", null, "advisory-diamond");
    diamond.setAttribute("aria-hidden", "true");
    button.append(diamond, element("span", nation.name));
    button.addEventListener("click", () => openSelection(id, true));
    list.append(button);
  }
}

function drawResults() {
  const results = visibleNations();
  const current = layers[layer.value];
  get("map-tip").hidden = true;
  get("filter-label").textContent = current.filter;
  get("layer-filter").hidden = layer.value === "water";
  get("clear-filters").hidden = !(only.checked || treaty.value || query.value);
  drawActiveList(results);
  get("result-count").textContent = results.length + " of " + data.collection.features.length + " First Nations";
  get("map-empty").hidden = results.length > 0;
  get("legend").replaceChildren(...current.legend.map(([className, text]) => {
    const key = element("span", null, "key");
    key.append(element("i", null, className), document.createTextNode(text));
    return key;
  }));
  picker.replaceChildren(new Option(results.length ? "Select a First Nation" : "No matching First Nations", ""),
    ...results.map(({ properties: p }) => new Option(p.name + " · " + p.band, p.band)));
  picker.disabled = results.length === 0;
  points.replaceChildren();

  const ordered = [...results].sort((a, b) => Number(markerKind(a.properties) !== "default") - Number(markerKind(b.properties) !== "default"));
  for (const feature of ordered) {
    const nation = feature.properties;
    const type = markerKind(nation);
    const statusText = current.legend.find(([kind]) => kind === type)[1];
    const [x, y] = project(feature.geometry.coordinates);
    const marker = svg("g", { transform: "translate(" + x + " " + y + ")", class: "marker " + type,
      tabindex: "0", role: "button", "aria-label": nation.name + ", " + statusText });
    marker.dataset.band = nation.band;
    marker.dataset.radius = String(type === "default" ? 4.8 : 6.6);
    const shape = type === "active" ? "polygon" : "circle";
    marker.append(svg(shape, { class: "halo", "aria-hidden": "true" }),
      svg(shape, { class: "visible", "aria-hidden": "true" }),
      svg("circle", { class: "hit", fill: "transparent", "aria-hidden": "true" }));
    marker.addEventListener("pointermove", (event) => tooltip(event, nation.name + " · " + statusText));
    marker.addEventListener("pointerleave", () => { get("map-tip").hidden = true; });
    marker.addEventListener("click", () => openSelection(nation.band));
    marker.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSelection(nation.band);
      }
    });
    points.append(marker);
  }

  const matching = results.some((result) => result.id === state.selected);
  setSelected(matching ? state.selected : results.length === 1 ? results[0].id : null);
  updateView();
}

function block(title) {
  const section = element("section", null, "profile-block");
  section.append(element("h4", title));
  return section;
}

function timeline(events) {
  const list = element("ol", null, "timeline");
  for (const event of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    const item = element("li", null, event.kind);
    const time = element("time", dateLabel(event.date));
    time.dateTime = event.date;
    item.append(time, element("strong", event.title));
    if (event.context) item.append(element("p", event.context, "event-context"));
    list.append(item);
  }
  return list;
}

function advisoryEvents(record) {
  return [
    { date: record.issued, title: "Advisory issued", context: record.type },
    { date: record.longTermSince, title: "Advisory became long-term" },
    record.lifted
      ? { date: record.lifted, title: "Advisory lifted" }
      : { date: data.collection.asOf, title: "Still active in the ISC snapshot", kind: "active" },
  ];
}

function advisorySection(nation, isComparison = false) {
  const water = block("Drinking water advisories");
  if (!nation.advisories.length) {
    water.append(element("p", "No long-term advisory record in this ISC snapshot.", "muted"));
  }
  for (const record of [...nation.advisories].sort((a, b) => a.status.localeCompare(b.status))) {
    const card = element("div", null, "record");
    const tag = element("span", record.status === "Active" ? "Active in snapshot" : "Lifted", "tag " + record.status.toLowerCase());
    const title = element("p");
    title.append(element("strong", record.system));
    card.append(tag, title);
    if (isComparison) {
      card.append(timeline(advisoryEvents(record)));
    } else {
      const details = element("details");
      details.append(element("summary", "View advisory timeline"), timeline(advisoryEvents(record)));
      card.append(element("p", record.type + " · Long-term since " + dateLabel(record.longTermSince)), details);
    }
    water.append(card);
  }
  return water;
}

function featuredCase(nation) {
  const active = nation.advisories.find((record) => record.status === "Active");
  if (nation.band !== caseBand || !active || !nation.fundingExample) return null;
  const section = block("What happened after the upgrades?");
  const item = nation.fundingExample;
  const events = advisoryEvents(active);
  events.push({
    date: data.fundingRelease.date,
    title: "ISC reports " + millions(item.cad) + " and completed upgrades",
    context: "The June backgrounder describes a new treatment plant and system upgrades.",
    kind: "capital",
  });
  section.append(element("p", active.system), timeline(events));
  const references = element("div", null, "timeline-sources");
  references.append(sourceLink("ISC funding backgrounder", data.sources.funding),
    sourceLink("ISC advisory map", data.sources.water));
  section.append(references);
  return section;
}

function roadSection(nation) {
  const roads = block("Winter road listing");
  if (nation.roadListing) {
    roads.append(element("span", "Route listed", "tag road"), element("p", nation.roadListing));
    roads.append(sourceLink("Manitoba winter-road reports", data.sources.roads));
  } else {
    roads.append(element("p", "No matched route in the reports used here. All-weather access status is unverified.", "muted"));
  }
  return roads;
}

function projectSection(nation, featured = false) {
  const capital = block("Water and wastewater projects");
  if (nation.fundingExample && !featured) {
    const item = nation.fundingExample;
    const card = element("div", null, "record");
    card.append(element("span", millions(item.cad) + " · ISC", "tag funding"), element("p", item.title), element("small", item.milestone));
    capital.append(card, sourceLink("June 2026 funding release", data.sources.funding));
  }
  if (nation.projects.length) {
    const count = nation.projects.filter((project) => project.stage === "Completed").length;
    const details = element("details");
    const list = element("ul", null, "project-list");
    details.append(element("summary", nation.projects.length + (nation.projects.length === 1 ? " project record" : " project records")
      + " · " + count + " reported complete"));
    for (const item of nation.projects) {
      const entry = element("li", item.title);
      entry.append(element("div", item.stage, "muted"));
      list.append(entry);
    }
    details.append(list, sourceLink("ISC water and project map", data.sources.water));
    capital.append(details);
  } else {
    capital.append(element("p", "No project record in the ISC map snapshot.", "muted"));
  }
  return capital;
}

function showProfile(nation) {
  const profile = get("profile");
  profile.replaceChildren();
  const head = element("div", null, "profile-head");
  const title = element("h3", nation?.name ?? "Select a First Nation");
  title.tabIndex = -1;
  if (!nation) {
    head.append(element("p", "First Nation profile", "eyebrow"), title);
    const help = element("div", null, "profile-block");
    help.append(element("p", "Select a marker or choose a name from the list to see advisory records, winter road listings and reported water projects.", "muted"));
    profile.append(head, profileTools, help);
    return;
  }
  head.append(element("p", "Band number " + nation.band, "band"), title);
  head.append(element("p", nation.treaty === "Dakota Nations" ? "Dakota Nations · no numbered treaty affiliation listed" : nation.treaty, "profile-meta"));
  const story = featuredCase(nation);
  profile.append(head, profileTools, story ?? advisorySection(nation), roadSection(nation), projectSection(nation, Boolean(story)));
  if (story && nation.advisories.length > 1) profile.append(advisorySection(nation));
}

function updateProfileTools() {
  const pinned = state.compared.includes(state.selected);
  get("pin-nation").hidden = !state.selected;
  get("pin-nation").disabled = !pinned && state.compared.every(Boolean);
  get("pin-nation").setAttribute("aria-pressed", String(pinned));
  get("pin-nation").textContent = pinned ? "Remove pin" : "Pin for comparison";
  get("share-profile").hidden = !state.selected;
  get("zoom-nation").disabled = !state.selected;
  const count = state.compared.filter(Boolean).length;
  get("open-compare").textContent = count ? "View comparison (" + count + "/2)" : "Compare Nations";
}

function updateComparison() {
  get("compare").hidden = !state.comparing;
  get("share-compare").disabled = !state.compared.every(Boolean);
  for (const [index, slot] of ["first", "second"].entries()) {
    const selector = get("compare-" + slot);
    const otherBand = state.compared[1 - index];
    const chosen = state.compared[index];
    const options = data.collection.features.filter((feature) => feature.id !== otherBand);
    selector.replaceChildren(new Option("Choose a First Nation", ""),
      ...options.map(({ properties: nation }) => new Option(nation.name + " · " + nation.band, nation.band)));
    selector.value = chosen;
    const body = get("compare-" + slot + "-body");
    body.replaceChildren();
    const nation = featureByBand.get(chosen)?.properties;
    if (nation) body.append(advisorySection(nation, true), roadSection(nation), projectSection(nation));
    else body.append(element("p", "Choose a First Nation from the list or pin its map profile.", "muted"));
  }
  updateProfileTools();
  syncUrl();
}

function pinSelected() {
  const match = state.compared.indexOf(state.selected);
  if (match !== -1) state.compared[match] = "";
  else if (!state.compared.every(Boolean)) state.compared[state.compared.indexOf("")] = state.selected;
  state.comparing = true;
  updateComparison();
}

function syncUrl(hash) {
  if (state.initializing || location.protocol === "file:") return;
  const url = new URL(location.href);
  for (const key of ["nation", "compare", "layer", "active", "basemap"]) url.searchParams.delete(key);
  if (state.selected) url.searchParams.set("nation", state.selected);
  if (state.compared.some(Boolean)) url.searchParams.set("compare", state.compared.join(","));
  if (layer.value !== "water") url.searchParams.set("layer", layer.value);
  if (activeFilterOn()) url.searchParams.set("active", "1");
  if (hash) url.hash = hash;
  history.replaceState(null, "", url);
}

function sectionFocus(id, headingId) {
  syncUrl(id);
  get(id).scrollIntoView({ block: "start" });
  get(headingId).focus({ preventScroll: true });
}

async function shareSelection(comparison) {
  const canonical = document.querySelector('link[rel="canonical"]').href;
  // Published share links follow the public hostname serving the page.
  const url = location.protocol === "https:" ? new URL("./", location.href) : new URL(canonical);
  if (comparison) {
    url.searchParams.set("compare", state.compared.join(","));
    url.hash = "compare";
  } else {
    url.searchParams.set("nation", state.selected);
    if (layer.value !== "water") url.searchParams.set("layer", layer.value);
    url.hash = "explore";
  }
  const message = get("share-message");
  const fallback = get("share-fallback");
  const input = get("share-url");
  message.hidden = false;
  fallback.hidden = true;
  get("share-status").textContent = "";
  try {
    await navigator.clipboard.writeText(url.href);
    get("share-status").textContent = comparison ? "Comparison link copied." : "Profile link copied.";
  } catch {
    get("share-status").textContent = "Copy the link from the selected field.";
    fallback.hidden = false;
    input.value = url.href;
    input.select();
  }
}

function chartBar(name, label, width, className, handler) {
  const row = element(handler ? "button" : "div", null, "bar-row " + (className ?? ""));
  if (handler) {
    row.type = "button";
    row.addEventListener("click", handler);
  }
  const top = element("span", null, "bar-label");
  const track = element("span", null, "bar-track");
  track.setAttribute("aria-hidden", "true");
  const bar = element("span", null, "bar");
  bar.style.width = width + "%";
  top.append(element("span", name, "bar-name"), element("span", label, "bar-value"));
  track.append(bar);
  row.append(top, track);
  return row;
}

function openFromChart(band) {
  query.value = "";
  treaty.value = "";
  only.checked = false;
  layer.value = "funding";
  drawResults();
  setSelected(band, true);
  sectionFocus("explore", "explore-heading");
}

function renderEvidence() {
  const snapshot = data.collection.asOf;
  const active = data.collection.features.flatMap(({ properties }) =>
    properties.advisories.filter((record) => record.status === "Active").map((record) => ({ record, properties })));
  const housing = data.housing;
  const on = rate(housing["On reserve"]);
  const off = rate(housing["Off reserve"]);
  const gap = (on - off).toFixed(1);

  get("metric-active").textContent = active.length;
  get("metric-roads").textContent = data.noAllWeatherRoads;
  get("metric-housing").textContent = gap + " pp";
  get("metric-funding").textContent = millions(data.fundingRelease.reportedMinimumCad) + "+";
  get("map-date").textContent = "Water snapshot · " + dateLabel(snapshot);

  for (const [label, row] of Object.entries(housing)) {
    get("housing-chart").append(chartBar(label, rate(row).toFixed(1) + "%", rate(row), label === "Off reserve" ? "other" : ""));
  }
  get("housing-note").textContent = "On reserve: " + integer.format(housing["On reserve"].majorRepairs) + " of " +
    integer.format(housing["On reserve"].total) + " people. Off reserve: " + integer.format(housing["Off reserve"].majorRepairs) +
    " of " + integer.format(housing["Off reserve"].total) + " people.";

  const funding = data.collection.features.map((feature) => feature.properties).filter((p) => p.fundingExample)
    .sort((a, b) => b.fundingExample.cad - a.fundingExample.cad);
  const ceiling = Math.ceil(funding[0].fundingExample.cad / 10_000_000) * 10_000_000;
  for (const { name, band, fundingExample } of funding) {
    get("funding-chart").append(chartBar(name, millions(fundingExample.cad), 100 * fundingExample.cad / ceiling,
      "investment", () => openFromChart(band)));
  }

  const oldest = [...active].sort((a, b) => a.record.longTermSince.localeCompare(b.record.longTermSince))[0];
  const caseStudy = data.collection.features.find((feature) => feature.id === "306").properties;
  const continuing = hasActive(caseStudy);
  const caseText = continuing ?
    " ISC reported that Tataskweyak Cree Nation completed its plant and system upgrades in its June backgrounder. The water map snapshot still listed an active advisory." : "";
  get("brief-water").textContent = "ISC listed " + active.length + " active long-term advisories as of " + dateLabel(snapshot) + "."
    + (oldest ? " The oldest listed episode had been long-term since " + dateLabel(oldest.record.longTermSince) + "." : "") + caseText;
  get("brief-findings").textContent = "In the 2021 Census, " + on.toFixed(1) + "% of First Nations people in private households on reserve in Manitoba lived in housing needing major repairs, compared with " +
    off.toFixed(1) + "% off reserve. ISC’s regional overview separately reports " + data.noAllWeatherRoads + " First Nations without all-weather road access.";
  document.querySelectorAll("[data-source]").forEach((link) => { link.href = data.sources[link.dataset.source]; });
}

function bindMap() {
  const local = (event) => new DOMPoint(event.clientX, event.clientY).matrixTransform(map.getScreenCTM().inverse());
  get("zoom-in").addEventListener("click", () => zoomBy(1.45));
  get("zoom-out").addEventListener("click", () => zoomBy(1 / 1.45));
  get("zoom-reset").addEventListener("click", resetView);
  get("zoom-nation").addEventListener("click", () => {
    const feature = featureByBand.get(state.selected);
    if (feature) focusMap(feature, maxMapZoom);
  });
  map.addEventListener("pointerdown", (event) => {
    if (state.drag || event.pointerType === "touch"
      || event.button !== 0 || event.target.closest(".marker")) return;
    const start = local(event);
    state.drag = { x: start.x - state.view.x, y: start.y - state.view.y };
    map.setPointerCapture(event.pointerId);
    frame.classList.add("dragging");
  });
  map.addEventListener("pointermove", (event) => {
    if (!state.drag) return;
    const point = local(event);
    const limitX = 380 * state.view.zoom;
    const limitY = 280 * state.view.zoom;
    state.view.x = Math.min(limitX, Math.max(-limitX * 2, point.x - state.drag.x));
    state.view.y = Math.min(limitY, Math.max(-limitY * 2, point.y - state.drag.y));
    updateView();
  });
  map.addEventListener("lostpointercapture", () => {
    state.drag = null;
    frame.classList.remove("dragging");
  });
  new ResizeObserver(() => {
    state.mapWidth = Math.max(440, Math.min(760, frame.clientWidth * 560 / frame.clientHeight));
    map.setAttribute("viewBox", ((760 - state.mapWidth) / 2) + " 0 " + state.mapWidth + " 560");
    positionMapLabel();
  }).observe(frame);
}

if (data) {
  const params = new URLSearchParams(location.search);
  const requestedBand = params.get("nation");
  const requestedLayer = params.get("layer");
  const requestedCompare = (params.get("compare") ?? "").split(",", 2);
  const hasSharedProfile = featureByBand.has(requestedBand);
  state.selected = hasSharedProfile ? requestedBand : (featureByBand.has(caseBand) ? caseBand : null);
  state.compared = [0, 1].map((index) => {
    const band = requestedCompare[index];
    return featureByBand.has(band) && requestedCompare.indexOf(band) === index ? band : "";
  });
  state.comparing = state.compared.some(Boolean) || location.hash === "#compare";

  if (requestedLayer && Object.hasOwn(layers, requestedLayer)) layer.value = requestedLayer;
  only.checked = layer.value === "water" && params.get("active") === "1";
  for (const label of affiliations) treaty.append(new Option(label, label));
  renderEvidence();
  basemap();
  bindMap();
  drawResults();
  updateComparison();
  state.initializing = false;
  if (hasSharedProfile && state.selected === requestedBand) focusMap(featureByBand.get(requestedBand));
  if (location.hash === "#compare") requestAnimationFrame(() => get("compare").scrollIntoView());
  if (location.hash === "#explore" && hasSharedProfile) requestAnimationFrame(() => get("explore").scrollIntoView());

  const redraw = () => { resetView(); drawResults(); };
  const clearFilters = () => { query.value = ""; treaty.value = ""; only.checked = false; };
  query.addEventListener("input", redraw);
  query.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const [first] = visibleNations();
    if (first) openSelection(first.id, true);
  });
  layer.addEventListener("change", () => { only.checked = false; drawResults(); });
  treaty.addEventListener("change", redraw);
  only.addEventListener("change", redraw);
  get("clear-filters").addEventListener("click", () => { clearFilters(); redraw(); query.focus(); });
  get("filter-active").addEventListener("click", () => {
    const wasActive = activeFilterOn();
    clearFilters();
    layer.value = "water";
    only.checked = !wasActive;
    redraw();
    if (!wasActive && mobile.matches) {
      get("active-list").scrollIntoView({ block: "start" });
      get("active-list-heading").focus({ preventScroll: true });
    }
  });
  picker.addEventListener("change", () => {
    if (picker.value) openSelection(picker.value, true);
    else { resetView(); setSelected(null); }
  });
  get("show-case").addEventListener("click", () => {
    clearFilters();
    layer.value = "water";
    drawResults();
    setSelected(caseBand, true);
    if (mobile.matches) {
      syncUrl("community-profile");
      get("community-profile").scrollIntoView({ block: "start" });
      get("profile").querySelector("h3")?.focus({ preventScroll: true });
    } else sectionFocus("explore", "explore-heading");
  });
  get("open-compare").addEventListener("click", () => {
    state.comparing = true;
    updateComparison();
    sectionFocus("compare", "compare-heading");
  });
  get("pin-nation").addEventListener("click", pinSelected);
  for (const [index, slot] of ["first", "second"].entries()) {
    const selector = get("compare-" + slot);
    selector.addEventListener("change", () => {
      state.compared[index] = selector.value;
      updateComparison();
    });
  }
  get("share-profile").addEventListener("click", () => shareSelection(false));
  get("share-compare").addEventListener("click", () => shareSelection(true));
  get("dismiss-share").addEventListener("click", () => { get("share-message").hidden = true; });
} else {
  get("profile").replaceChildren(element("p", "The data snapshot could not load. Reload this page or download the GeoJSON from Sources.", "muted"));
  get("result-count").textContent = "Data unavailable";
}
