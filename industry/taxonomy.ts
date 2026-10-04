// 法律案源线索搜索的行业分类、标签和公共机构主体词典。
// 模型按这里的白名单打标签；所有“案源线索”都只是基于公开材料的待核验信号。

export const CATEGORIES = [
  { key: "bankruptcy-restructuring", label: "破产重整", section: "破产与重整", guide: "企业或经营主体已公开出现的破产申请、受理、重整、预重整、清算、债务重组、资产处置及债权申报信息。普通经营困难或未经证实的资金传闻不归入本类。" },
  { key: "securities-disputes", label: "证券争议", section: "证券与资本市场争议", guide: "上市公司信息披露、证券虚假陈述、内幕交易、操纵市场、投资者索赔、债券违约及证券监管调查或处罚。一般融资新闻或股价波动本身不构成线索。" },
  { key: "labor-employment", label: "劳动用工", section: "劳动与用工", guide: "裁员、欠薪、工伤、劳动关系、竞业限制、群体性用工调整、平台用工及劳动监管执法。仅有招聘、员工福利或职场观点而无具体法律事实的不归入本类。" },
  { key: "intellectual-property", label: "知识产权", section: "知识产权", guide: "专利、商标、著作权、商业秘密、不正当竞争、技术许可及相关确权、无效、侵权争议或行政执法。新品发布本身不构成知识产权线索。" },
  { key: "regulatory-compliance", label: "监管合规", section: "监管与合规", guide: "正式发布或实施的法律规则、监管调查、行政处罚、数据与个人信息保护、反垄断、反商业贿赂、消费者权益和行业合规事件。只谈政策方向而没有明确文件或行动的材料应降低确定性。" },
  { key: "legal-practice", label: "实务观察", section: "实务与观察", guide: "对上述领域有明确法律依据、程序节点或可复用核验方法的案例解读、实务指南与趋势分析。营销软文、获客承诺、泛泛观点和无法回到公开材料的推断属于噪声。", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

// 法律案源线索不存在适合跨领域统计的统一“发布”指标。
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

export const PLAIN_TERMS: readonly string[] = ["法律", "法院", "监管", "合规", "诉讼", "仲裁", "行政处罚", "案源线索"];

export const ITEM_TYPES = ["court_case", "regulatory_action", "rule_update", "corporate_distress", "public_dispute", "legal_analysis", "practice_guide"] as const;

export const CATEGORY_TAGS = ["争议/诉讼", "监管/执法", "政策/规则", "企业风险", "实务/方法", "观察/趋势", "其他"] as const;

export const TOPIC_TAGS = ["破产重整", "证券争议", "劳动用工", "知识产权", "监管合规", "数据与隐私", "反垄断", "消费者权益", "商业秘密", "债券违约", "集体争议", "行政处罚"] as const;

export const ENTITY_TAGS = ["最高人民法院", "证监会", "市场监管总局", "国家知识产权局", "人力资源社会保障部"] as const;

export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  诉讼: "争议/诉讼", 仲裁: "争议/诉讼", 判决: "争议/诉讼",
  处罚: "监管/执法", 执法: "监管/执法", 调查: "监管/执法", 监管: "监管/执法",
  法律: "政策/规则", 法规: "政策/规则", 司法解释: "政策/规则", 指导意见: "政策/规则",
  破产: "企业风险", 重整: "企业风险", 清算: "企业风险", 违约: "企业风险",
  指南: "实务/方法", 实务: "实务/方法", 方法: "实务/方法", 解读: "实务/方法",
  趋势: "观察/趋势", 观点: "观察/趋势",
  劳动: "劳动用工", 用工: "劳动用工", 知产: "知识产权", 专利: "知识产权", 商标: "知识产权", 著作权: "知识产权",
  合规: "监管合规", 隐私: "数据与隐私",
};

// 这里只列公共机构，用于主题归类和防止标题摘要凭空加入机构名称；不维护公司或潜在客户名单。
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  spc: { name: "最高人民法院", displayTag: "最高人民法院", aliases: ["最高人民法院", "最高法", "SPC"] },
  csrc: { name: "中国证券监督管理委员会", displayTag: "证监会", aliases: ["中国证监会", "证监会", "CSRC"] },
  samr: { name: "国家市场监督管理总局", displayTag: "市场监管总局", aliases: ["市场监管总局", "国家市场监管总局", "SAMR"] },
  cnipa: { name: "国家知识产权局", displayTag: "国家知识产权局", aliases: ["国家知识产权局", "国知局", "CNIPA"] },
  mohrss: { name: "人力资源和社会保障部", displayTag: "人力资源社会保障部", aliases: ["人力资源社会保障部", "人社部", "MOHRSS"] },
};

export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "spc", name: "最高人民法院", patterns: [/最高人民法院|最高法|\bSPC\b/i] },
  { id: "csrc", name: "中国证监会", patterns: [/中国证券监督管理委员会|中国证监会|证监会|\bCSRC\b/i] },
  { id: "samr", name: "市场监管总局", patterns: [/国家市场监督管理总局|国家市场监管总局|市场监管总局|\bSAMR\b/i] },
  { id: "cnipa", name: "国家知识产权局", patterns: [/国家知识产权局|国知局|\bCNIPA\b/i] },
  { id: "mohrss", name: "人力资源社会保障部", patterns: [/人力资源和社会保障部|人力资源社会保障部|人社部|\bMOHRSS\b/i] },
];

export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "spc", domains: ["court.gov.cn"] },
  { entityId: "csrc", domains: ["csrc.gov.cn"] },
  { entityId: "samr", domains: ["samr.gov.cn"] },
  { entityId: "cnipa", domains: ["cnipa.gov.cn"] },
  { entityId: "mohrss", domains: ["mohrss.gov.cn"] },
];

export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
