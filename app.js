const ROUTES = [
  ["selected", "精选"],
  ["all", "全部"],
  ["hot", "热点"],
  ["daily", "日报"],
  ["topics", "主题"],
  ["leads", "案源线索"],
];

const PRACTICES = [
  ["all", "全部类别"],
  ["securities", "证券"],
  ["insolvency", "破产"],
  ["labor", "劳动"],
  ["intellectual-property", "知识产权"],
  ["compliance", "监管合规"],
];

const CATEGORY_LABELS = new Map([
  ["bankruptcy-restructuring", "破产重整"],
  ["securities-disputes", "证券争议"],
  ["labor-employment", "劳动用工"],
  ["intellectual-property", "知识产权"],
  ["regulatory-compliance", "监管合规"],
  ["legal-practice", "实务观察"],
]);

const state = { snapshot: null, reportKind: "daily", reportKey: null };
const page = document.querySelector("#page");
const pageTitle = document.querySelector("#page-title");
const snapshotTime = document.querySelector("#snapshot-time");

function element(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined && text !== null) value.textContent = String(text);
  return value;
}

function append(parent, ...children) {
  parent.append(...children.filter(Boolean));
  return parent;
}

function safeUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return null;
    const host = url.hostname.toLocaleLowerCase("en-US").replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    const ipv4 = host.split(".").map(Number);
    if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      if (ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] >= 224
        || (ipv4[0] === 169 && ipv4[1] === 254) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
        || (ipv4[0] === 192 && ipv4[1] === 168) || (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127)) return null;
    }
    if (host === "::" || host === "::1" || /^(?:fc|fd|fe[89ab])/i.test(host)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function externalTitle(title, url, heading = "h2") {
  const h = element(heading);
  const safe = safeUrl(url);
  if (!safe) return append(h, element("span", "card-title", title));
  const a = element("a", "card-link", title);
  a.href = safe;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return append(h, a);
}

function dateText(value, time = false) {
  if (!value) return "日期未提供";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(time ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date);
}

function categoryLabel(value) {
  return CATEGORY_LABELS.get(value) || value;
}

function newestFirst(items) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.publishedAt || left.discoveredAt || "");
    const rightTime = Date.parse(right.publishedAt || right.discoveredAt || "");
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

function intro(text) {
  return element("p", "intro", text);
}

function empty(title, detail) {
  const box = element("div", "empty");
  return append(box, element("strong", "", title), element("span", "", detail));
}

function metaLine(parts) {
  const line = element("div", "meta");
  for (const part of parts.filter(Boolean)) line.append(element("span", "", part));
  return line;
}

function itemCard(item) {
  const card = element("article", "card");
  append(card, metaLine([item.sourceName, item.publishedAt ? `原文发布 ${dateText(item.publishedAt)}` : null, `本站发现 ${dateText(item.discoveredAt)}`]));
  append(card, externalTitle(item.title, item.originalUrl));
  if (item.summary) card.append(element("p", "", item.summary));
  if (item.reason) card.append(element("p", "reason", `推荐理由：${item.reason}`));
  const tags = element("div", "tags");
  if (item.category) tags.append(element("span", "badge", categoryLabel(item.category)));
  for (const tag of (item.tags || []).slice(0, 4)) tags.append(element("span", "tag", `#${tag}`));
  if (tags.childElementCount) card.append(tags);
  return card;
}

function renderItems(items, emptyTitle, emptyDetail) {
  if (!items.length) return empty(emptyTitle, emptyDetail);
  const list = element("div", "list");
  for (const item of items) list.append(itemCard(item));
  return list;
}

function renderSelected() {
  return append(
    document.createDocumentFragment(),
    intro("公开资料精选阅读索引，内容仍需人工核验。标题只链接原始公开来源，时间保持原始记录。"),
    renderItems(newestFirst(state.snapshot.selected), "暂时没有精选", "当前快照没有可公开展示的精选内容。"),
  );
}

function renderAll() {
  const root = document.createDocumentFragment();
  const allItems = newestFirst(state.snapshot.all);
  root.append(intro("当前公开快照中的全部动态。可按标题、摘要、来源、分类或标签在浏览器本地筛选。"));
  const toolbar = element("div", "toolbar");
  const searchLabel = element("label", "field");
  append(searchLabel, element("span", "", "搜索公开内容"));
  const search = element("input");
  search.type = "search";
  search.placeholder = "输入机构、事件或业务关键词";
  search.autocomplete = "off";
  searchLabel.append(search);
  const categoryLabel = element("label", "field");
  append(categoryLabel, element("span", "", "分类"));
  const category = element("select");
  const categories = [...new Set(allItems.map((item) => item.category).filter(Boolean))]
    .sort((left, right) => categoryLabel(left).localeCompare(categoryLabel(right), "zh-CN"));
  category.append(new Option("全部分类", ""), ...categories.map((value) => new Option(categoryLabel(value), value)));
  categoryLabel.append(category);
  append(toolbar, searchLabel, categoryLabel);
  const results = element("div");
  const update = () => {
    const needle = search.value.trim().toLocaleLowerCase("zh-CN");
    const wanted = category.value;
    const matches = allItems.filter((item) => {
      if (wanted && item.category !== wanted) return false;
      if (!needle) return true;
      return [item.title, item.summary, item.reason, item.sourceName, item.category, categoryLabel(item.category), ...(item.tags || [])]
        .filter(Boolean).join("\n").toLocaleLowerCase("zh-CN").includes(needle);
    });
    results.replaceChildren(renderItems(matches, "没有匹配内容", "请更换关键词或分类。"));
  };
  search.addEventListener("input", update);
  category.addEventListener("change", update);
  update();
  append(root, toolbar, results);
  return root;
}

function renderHot() {
  const root = document.createDocumentFragment();
  root.append(intro("热点只展示真实生成的公开排名数据；当前快照没有排名时保持空白，不补算热度。"));
  const items = state.snapshot.hot?.items || [];
  if (!items.length) return append(root, empty("暂时没有热点", "当前快照没有足够的真实热点排名数据。"));
  const list = element("div", "list");
  for (const item of items) {
    const card = element("article", "card rank");
    card.append(element("div", "rank-no", String(item.rank).padStart(2, "0")));
    const body = element("div");
    append(body, metaLine([item.sourceName, `最近更新 ${dateText(item.latestAt, true)}`]), externalTitle(item.title, item.originalUrl));
    const counts = element("div", "rank-count", `${item.sourceCount} 个来源 · ${item.participantCount} 位参与者`);
    append(card, body, counts);
    list.append(card);
  }
  root.append(list);
  return root;
}

function reportLabel(kind) {
  return kind === "daily" ? "日报" : kind === "weekly" ? "周报" : "月报";
}

function renderReportItem(item) {
  const card = element("article", "card");
  append(card, metaLine([item.sourceName, item.publishedAt ? `原文发布 ${dateText(item.publishedAt)}` : null]), externalTitle(item.title, item.originalUrl, "h3"));
  if (item.summary) card.append(element("p", "", item.summary));
  return card;
}

function renderReports() {
  const root = document.createDocumentFragment();
  root.append(intro("日报、周报和月报只展示已经真实生成并进入公开快照的期次。"));
  const kinds = element("div", "segmented");
  for (const kind of ["daily", "weekly", "monthly"]) {
    const button = element("button", "segment", reportLabel(kind));
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.reportKind === kind));
    button.addEventListener("click", () => {
      state.reportKind = kind;
      state.reportKey = null;
      renderRoute();
    });
    kinds.append(button);
  }
  root.append(kinds);
  const collection = state.snapshot.reports?.[state.reportKind];
  const index = collection?.index || [];
  if (!index.length) return append(root, empty(`还没有发布${reportLabel(state.reportKind)}`, "生成并公开第一期后会出现在这里。"));
  const key = state.reportKey && collection.details[state.reportKey] ? state.reportKey : index[0].key;
  const detail = collection.details[key];
  const selector = element("div", "segmented");
  for (const issue of index) {
    const button = element("button", "segment", issue.headline || issue.key);
    button.type = "button";
    button.setAttribute("aria-pressed", String(issue.key === key));
    button.addEventListener("click", () => { state.reportKey = issue.key; renderRoute(); });
    selector.append(button);
  }
  root.append(selector);
  if (!detail) return append(root, empty("期次内容不可用", "索引存在，但当前快照没有这一期的公开正文。"));
  const head = element("header", "report-head");
  append(
    head,
    metaLine([`${reportLabel(detail.kind)} · ${detail.key}`, `生成 ${dateText(detail.generatedAt, true)}`, `${dateText(detail.windowStart)} 至 ${dateText(detail.windowEnd)}`]),
    element("h2", "", detail.headline || `${reportLabel(detail.kind)} · ${detail.key}`),
  );
  if (detail.introduction) head.append(element("p", "", detail.introduction));
  root.append(head);
  for (const section of detail.sections || []) {
    const block = element("section", "report-section");
    block.append(element("h2", "", section.label));
    if (section.summary) block.append(element("p", "intro", section.summary));
    const list = element("div", "list");
    for (const item of section.items || []) list.append(renderReportItem(item));
    if (list.childElementCount) block.append(list);
    root.append(block);
  }
  if (detail.flashes?.length) {
    const block = element("section", "report-section");
    block.append(element("h2", "", "快讯"));
    const list = element("div", "list");
    for (const item of detail.flashes) list.append(renderReportItem(item));
    block.append(list);
    root.append(block);
  }
  return root;
}

function renderTopics() {
  const root = document.createDocumentFragment();
  root.append(intro("按公共机构、业务领域和内容类型浏览公开主题。没有精选的主题仍如实显示为零。"));
  const groups = state.snapshot.topics?.groups || [];
  const topics = state.snapshot.topics?.topics || [];
  if (!topics.length) return append(root, empty("暂时没有主题", "当前快照没有公开主题索引。"));
  for (const group of groups) {
    const section = element("section", "report-section");
    append(section, element("h2", "", group.name), element("p", "intro", group.blurb));
    const grid = element("div", "grid");
    for (const topic of topics.filter((item) => item.group === group.key)) {
      const card = element("article", "card topic-card");
      append(card, element("span", "badge", group.name), element("h3", "", topic.name), element("p", "", topic.definition));
      const latest = topic.latest ? `最新：${topic.latest.title} · ${dateText(topic.latest.at)}` : "暂无公开精选";
      card.append(element("p", "count", `${topic.total} 条精选 · 近 30 天 ${topic.recent} 条 · ${latest}`));
      grid.append(card);
    }
    if (grid.childElementCount) section.append(grid);
    root.append(section);
  }
  return root;
}

function leadCard(lead, reference = false) {
  const card = element("article", "card");
  const practice = reference ? PRACTICES.find(([key]) => key === lead.category)?.[1] || lead.category : lead.practiceLabel;
  const status = element("div", "tags");
  append(status, element("span", "badge", practice), element("span", "badge warn", "待人工核验"));
  if (reference) status.append(element("span", "tag", "人工整理公开事件 · 非实时"));
  card.append(status);
  append(card, externalTitle(lead.title, reference ? lead.sourceUrl : lead.originalUrl));
  if (lead.summary) card.append(element("p", "", lead.summary));
  card.append(element("p", "reason", `${reference ? "业务关联说明" : "候选理由（关键词规则）"}：${lead.reason}`));
  const dates = reference
    ? [lead.sourceName, `原文发布 ${dateText(lead.publishedAt)}`, lead.eventAt ? `事件发生 ${dateText(lead.eventAt)}` : "事件发生时间待核验", `人工核验 ${dateText(lead.checkedAt)}`]
    : [lead.sourceName, lead.publishedAt ? `原文发布 ${dateText(lead.publishedAt)}` : "原文发布时间未知", `本站发现 ${dateText(lead.discoveredAt)}`, `命中词：${lead.matchedTerms.join("、")}`];
  card.append(metaLine(dates));
  return card;
}

function renderLeads() {
  const root = document.createDocumentFragment();
  root.append(
    intro("从已公开内容中检索按固定关键词规则生成的候选，以及人工整理的公开参考。结果不是已确认客户或案件，不推算获赔、胜诉或期限。"),
    element("div", "legal-note", "候选只用于律师人工核验。请回到原始公开来源核对主体、事实、日期、程序状态和业务冲突。"),
  );
  const toolbar = element("div", "toolbar");
  const queryLabel = element("label", "field");
  append(queryLabel, element("span", "", "搜索线索"));
  const query = element("input");
  query.type = "search";
  query.placeholder = "例：裁员、信息披露、数据泄露";
  query.maxLength = 120;
  queryLabel.append(query);
  const practiceLabel = element("label", "field");
  append(practiceLabel, element("span", "", "业务类别"));
  const practice = element("select");
  for (const [value, label] of PRACTICES) practice.append(new Option(label, value));
  practiceLabel.append(practice);
  append(toolbar, queryLabel, practiceLabel);
  const results = element("div");
  const update = () => {
    const needle = query.value.trim().toLocaleLowerCase("zh-CN");
    if (!needle) {
      results.replaceChildren(empty("输入关键词开始搜索", "候选只在公开内容或人工参考匹配查询时显示。"));
      return;
    }
    const contains = (lead) => [lead.title, lead.summary, lead.reason, lead.sourceName, ...(lead.matchedTerms || [])]
      .filter(Boolean).join("\n").toLocaleLowerCase("zh-CN").includes(needle);
    const candidates = (state.snapshot.leadCandidates || []).filter((lead) => (practice.value === "all" || lead.practice === practice.value) && contains(lead));
    const references = (state.snapshot.references || []).filter((lead) => (practice.value === "all" || lead.category === practice.value) && contains(lead));
    if (!candidates.length && !references.length) {
      results.replaceChildren(empty("未发现符合规则的候选线索", "请更换关键词或业务类别。没有结果不代表不存在法律需求。"));
      return;
    }
    const list = element("div", "list");
    for (const lead of references) list.append(leadCard(lead, true));
    for (const lead of candidates) list.append(leadCard(lead));
    results.replaceChildren(list);
  };
  query.addEventListener("input", update);
  practice.addEventListener("change", update);
  update();
  append(root, toolbar, results);
  return root;
}

function currentRoute() {
  const route = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return ROUTES.some(([key]) => key === route) ? route : "selected";
}

function renderNavigation(route) {
  for (const id of ["desktop-nav", "mobile-nav"]) {
    const nav = document.getElementById(id);
    const links = ROUTES.map(([key, label]) => {
      const link = element("a", "nav-link", label);
      link.href = `#/${key}`;
      if (key === route) link.setAttribute("aria-current", "page");
      return link;
    });
    nav.replaceChildren(...links);
  }
}

function renderRoute() {
  if (!state.snapshot) return;
  const route = currentRoute();
  const label = ROUTES.find(([key]) => key === route)[1];
  pageTitle.textContent = label;
  document.title = `${label} · ${state.snapshot.site.name}`;
  renderNavigation(route);
  const views = { selected: renderSelected, all: renderAll, hot: renderHot, daily: renderReports, topics: renderTopics, leads: renderLeads };
  page.replaceChildren(views[route]());
  page.setAttribute("aria-busy", "false");
  document.querySelector("#content").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "auto" });
}

async function start() {
  try {
    const response = await fetch("./data.json", { cache: "no-cache", credentials: "omit" });
    if (!response.ok) throw new Error(`数据文件返回 ${response.status}`);
    const snapshot = await response.json();
    if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.selected) || !Array.isArray(snapshot.all)) throw new Error("数据快照格式不受支持");
    state.snapshot = snapshot;
    snapshotTime.textContent = `快照生成于 ${dateText(snapshot.generatedAt, true)}`;
    window.addEventListener("hashchange", renderRoute);
    if (!location.hash) history.replaceState(null, "", "#/selected");
    renderRoute();
  } catch (error) {
    page.setAttribute("aria-busy", "false");
    const box = element("div", "error");
    append(box, element("strong", "", "公开数据暂时无法读取"), element("span", "", error instanceof Error ? error.message : "未知错误"));
    page.replaceChildren(box);
  }
}

void start();
