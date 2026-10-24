/**
 * 有效词条评分：系数来自官方数值表，权重来自角色定位。
 *
 * 评分 = Σ 每条词条（数值 × 系数 × 收益权重）
 *
 * 系数（用户提供的官方公式表）：
 *   暴击率 ×2、暴击伤害 ×2、元素精通 ×0.33、元素充能 ×1.1979、
 *   大攻击 ×1.33、大生命 ×1.33、大防御 ×1.06、
 *   小攻击 ×0.398×0.5、小生命 ×0.026×0.66、小防御 ×0.335×0.66
 *
 * 收益权重按角色定位给（同一份权重同时作用于该属性的主词条与副词条）。
 * 这个模块只负责“算分”，分档留给 UI/调用方决定。
 */

/** 每条词条的系数（数值 → 分）。 */
export const COEFFICIENTS = {
  critRate_: 2,
  critDMG_: 2,
  eleMas: 0.33,
  enerRech_: 1.1979,
  atk_: 1.33,
  hp_: 1.33,
  def_: 1.06,
  atk: 0.398 * 0.5,
  hp: 0.026 * 0.66,
  def: 0.335 * 0.66,
  // 元素/物理伤害加成只作为主词条出现，用同一套百分比系数
  pyro_dmg_: 1.33,
  electro_dmg_: 1.33,
  hydro_dmg_: 1.33,
  dendro_dmg_: 1.33,
  anemo_dmg_: 1.33,
  cryo_dmg_: 1.33,
  geo_dmg_: 1.33,
  physical_dmg_: 1.06,
  heal_: 1.33,
};

/** 八个定位模板；顺序与 UI 下拉一致。 */
export const ROLES = {
  crit: {
    label: '暴击主C',
    hint: '以双暴与攻击为主的输出',
    weights: { hp: 0, atk: 0.7, def: 0, critRate: 1, critDMG: 1, em: 0.5, er: 0 },
  },
  reaction: {
    label: '精通反应',
    hint: '激化 / 超绽放 / 蒸发等，精通是主属性',
    weights: { hp: 0.2, atk: 0.4, def: 0, critRate: 0.5, critDMG: 0.5, em: 1, er: 0.5 },
  },
  burst: {
    label: '爆发输出',
    hint: '靠元素爆发打伤害，充能需求高',
    weights: { hp: 0.2, atk: 0.6, def: 0, critRate: 0.9, critDMG: 0.9, em: 0.3, er: 0.8 },
  },
  support: {
    label: '充能辅助',
    hint: '增益 / 聚怪 / 后台，充能与功能属性优先',
    weights: { hp: 0.5, atk: 0.5, def: 0.4, critRate: 0.2, critDMG: 0.2, em: 0.3, er: 1 },
  },
  hp: {
    label: '生命增益',
    hint: '生命值转伤害或护盾',
    weights: { hp: 1, atk: 0.2, def: 0, critRate: 0.3, critDMG: 0.3, em: 0.3, er: 0.5 },
  },
  def: {
    label: '防御护盾',
    hint: '防御力转伤害或护盾',
    weights: { hp: 0.4, atk: 0.1, def: 1, critRate: 0.3, critDMG: 0.3, em: 0.2, er: 0.5 },
  },
  heal: {
    label: '治疗',
    hint: '治疗量取决于生命或攻击',
    weights: { hp: 0.8, atk: 0.3, def: 0.3, critRate: 0.3, critDMG: 0.3, em: 0.4, er: 0.8 },
  },
  generic: {
    label: '通用',
    hint: '未确定定位，按平均收益估',
    weights: { hp: 0.3, atk: 0.5, def: 0.3, critRate: 0.6, critDMG: 0.6, em: 0.4, er: 0.4 },
  },
};

/**
 * 词条 → 收益权重所属的组。
 * 双暴共用 `crit`，大小攻击共用 `atk`，其余同理。
 */
export const WEIGHT_GROUP = {
  critRate_: 'critRate',
  critDMG_: 'critDMG',
  eleMas: 'em',
  enerRech_: 'er',
  atk_: 'atk',
  atk: 'atk',
  hp_: 'hp',
  hp: 'hp',
  def_: 'def',
  def: 'def',
  pyro_dmg_: 'atk',
  electro_dmg_: 'atk',
  hydro_dmg_: 'atk',
  dendro_dmg_: 'atk',
  anemo_dmg_: 'atk',
  cryo_dmg_: 'atk',
  geo_dmg_: 'atk',
  physical_dmg_: 'atk',
  heal_: 'hp',
};

export function weightOf(key, roleKey) {
  const role = ROLES[roleKey] || ROLES.generic;
  const group = WEIGHT_GROUP[key];
  if (!group) return 0;
  return role.weights[group] || 0;
}

/** 单条词条的得分。 */
export function scoreSub(key, value, roleKey) {
  const coefficient = COEFFICIENTS[key];
  if (!coefficient) return 0;
  const value_ = Number(value) || 0;
  return value_ * coefficient * weightOf(key, roleKey);
}

/** 一件圣遗物的得分：主词条 + 副词条。 */
export function scorePiece(artifact, roleKey = 'generic') {
  if (!artifact) return 0
  let total = 0
  const main = artifact.main
  if (main && COEFFICIENTS[main.key]) total += scoreSub(main.key, main.value, roleKey)
  for (const sub of artifact.subs || []) total += scoreSub(sub.key, sub.value, roleKey)
  return Math.round(total * 10) / 10
}

/** 五件套总分。 */
export function scoreBuildForRole(artifacts, roleKey = 'generic') {
  const list = Array.isArray(artifacts) ? artifacts.filter(Boolean) : []
  if (!list.length) return { total: 0, count: 0 }
  const total = list.reduce((sum, artifact) => sum + scorePiece(artifact, roleKey), 0)
  return { total: Math.round(total * 10) / 10, count: list.length }
}

/**
 * 角色 → 默认定位。
 *
 * 只列把握大的；没列到的一律 `generic`，由用户在角色页自己选。
 * 标记 `unsure` 的是新角色或定位有争议，需要确认。
 */
export const CHARACTER_ROLE = {
  // ── 五星 ──────────────────────────────────────────────────────────────
  阿蕾奇诺: 'crit', 埃洛伊: 'crit', 艾尔海森: 'reaction', 八重神子: 'reaction',
  白术: 'hp', 达达利亚: 'crit', 迪卢克: 'crit', 迪希雅: 'hp',
  枫原万叶: 'reaction', 芙宁娜: 'hp', 甘雨: 'crit', 胡桃: 'crit',
  克洛琳德: 'crit', 刻晴: 'crit', 雷电将军: 'burst', 流浪者: 'crit',
  玛薇卡: 'crit', 莫娜: 'burst', 那维莱特: 'hp', 纳西妲: 'reaction',
  娜维娅: 'crit', 七七: 'heal', 恰斯卡: 'crit', 琴: 'heal',
  珊瑚宫心海: 'heal', 申鹤: 'support', 神里绫华: 'crit', 丝柯克: 'crit',
  提纳里: 'reaction', 温迪: 'support', 希诺宁: 'def', 闲云: 'heal',
  夜兰: 'hp', 优菈: 'crit', 钟离: 'hp', 兹白: 'def',
  // 新角色 / 定位有争议，先按通用
  奥黛塔: 'generic', 哥伦比娅: 'generic', 莉奈娅: 'generic', 旅行者: 'generic',
  梦见月瑞希: 'generic', 奈芙尔: 'generic', 尼可: 'generic',
  '奇偶·男性': 'generic', '奇偶·女性': 'generic', 桑多涅: 'generic',
  瓦雷莎: 'generic', 沃雅妮莎: 'generic', 茜特菈莉: 'generic',

  // ── 四星 ──────────────────────────────────────────────────────────────
  安柏: 'crit', 芭芭拉: 'heal', 班尼特: 'support', 北斗: 'burst',
  迪奥娜: 'hp', 多莉: 'support', 珐露珊: 'support', 菲米尼: 'crit',
  菲谢尔: 'crit', 嘉明: 'crit', 九条裟罗: 'support', 久岐忍: 'reaction',
  卡齐娜: 'def', 卡维: 'reaction', 凯亚: 'crit', 坎蒂丝: 'hp',
  柯莱: 'reaction', 莱依拉: 'hp', 雷泽: 'crit', 丽莎: 'reaction',
  琳妮特: 'support', 鹿野院平藏: 'crit', 罗莎莉亚: 'crit', 米卡: 'support',
  凝光: 'crit', 诺艾尔: 'def', 绮良良: 'hp', 赛索斯: 'crit',
  砂糖: 'reaction', 托马: 'hp', 五郎: 'def', 夏洛蒂: 'heal',
  夏沃蕾: 'hp', 香菱: 'burst', 辛焱: 'def', 行秋: 'burst',
  烟绯: 'crit', 瑶瑶: 'heal', 云堇: 'def', 早柚: 'heal', 重云: 'crit',
  // 新角色
  阿罗夏: 'generic', 爱诺: 'generic', 布伦妮: 'generic', 蓝砚: 'generic',
  欧洛伦: 'generic', 塔利雅: 'generic', 雅珂达: 'generic', 叶洛亚: 'generic',
  伊法: 'generic',
};

/** 这个角色是否有明确拟定（未列入的都是 generic）。 */
export function roleOf(name) {
  return CHARACTER_ROLE[name] || 'generic';
}

export function roleLabel(roleKey) {
  return (ROLES[roleKey] || ROLES.generic).label;
}

/** 全部角色名 → 定位，供“逐角色核对”的表格使用。 */
export function roleTable(names) {
  return names.map((name) => {
    const role = roleOf(name);
    return { name, role, label: roleLabel(role), weights: ROLES[role].weights, unsure: !(name in CHARACTER_ROLE) };
  });
}
