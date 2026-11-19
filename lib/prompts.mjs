/**
 * The prompts the Archify panel sends or offers: one for a new diagram (a type,
 * an optional project folder and focus) and one for a review of a drawn
 * architecture. Each is complete on its own, so the same text works sent from
 * the panel, pasted into any conversation, or placed in a new conversation's
 * composer.
 */

import { basename } from 'node:path';

/** The diagram types a person can pick, in the panel's order; `auto` lets the model choose. */
export const PICKABLE = ['auto', 'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall', 'explainer'];

const NAMES = {
  zh: { architecture: '架构图', workflow: '流程图', sequence: '时序图', dataflow: '数据流图', lifecycle: '状态图', erd: 'ER 图', class: '类图', tree: '树图', timeline: '时间线', waterfall: '瀑布图', explainer: '一页讲解页' },
  en: { architecture: 'architecture diagram', workflow: 'workflow diagram', sequence: 'sequence diagram', dataflow: 'data-flow diagram', lifecycle: 'state (lifecycle) diagram', erd: 'ER diagram', class: 'class diagram', tree: 'tree diagram', timeline: 'timeline', waterfall: 'waterfall (timing) diagram', explainer: 'one-page explainer' },
};

/** What a type is called in a prompt. */
export function typeName(type, lang = 'en') {
  return NAMES[lang === 'zh' ? 'zh' : 'en'][type] ?? type;
}

const clean = (s, n = 2000) => String(s ?? '').replace(/\s+$/g, '').slice(0, n);

/**
 * The prompt for a new diagram.
 * @param {{lang?: 'zh'|'en', type?: string, focus?: string, dir?: string, quality?: 'showcase'|'standard', digest?: string}} o
 *   `dir`: a project folder (the diagram is of that codebase); `digest`: its scan, attached so the model need not list it again.
 */
export function generationPrompt({ lang = 'en', type = 'auto', focus = '', dir = '', quality = 'showcase', digest = '' } = {}) {
  const zh = lang === 'zh';
  const auto = !PICKABLE.includes(type) || type === 'auto';
  const what = auto ? (zh ? '一张最合适的图（类型你来选）' : 'the diagram that fits best (choose the type)') : zh ? `一张${typeName(type, 'zh')}` : `a${/^[aeio]/.test(typeName(type)) ? 'n' : ''} ${typeName(type)}`;
  const f = clean(focus, 1500).trim();
  const lines = [];
  if (dir) {
    const name = basename(dir) || dir;
    if (zh) {
      lines.push(`用 archify 技能为 ${name} 这个代码仓库画${what}${f ? `，重点：${f}` : type === 'architecture' || auto ? '，画它的整体结构' : ''}。`);
      lines.push(`仓库位置：${dir}`);
    } else {
      lines.push(`Use the archify skill to draw ${what} of the ${name} codebase${f ? `, focused on: ${f}` : type === 'architecture' || auto ? ', showing its overall structure' : ''}.`);
      lines.push(`Repository: ${dir}`);
    }
  } else if (zh) {
    lines.push(`用 archify 技能画${what}${f ? `：${f}` : '。'}`);
  } else {
    lines.push(`Use the archify skill to draw ${what}${f ? `: ${f}` : '.'}`);
  }
  if (type === 'explainer') lines.push(zh ? '做成一页讲解页：结论在前，下面分块讲理由。' : 'Make it a one-page explainer: the conclusion first, then the reasons in panels.');
  if (quality === 'standard') lines.push(zh ? '质量用 standard，先快速交付一版。' : 'Use the standard quality profile and deliver a first version quickly.');
  lines.push(zh ? '图里的文字用中文。第一次检查通过就交付，回复一两句说出要点即可。' : 'Write the diagram text in English. Deliver the first page that passes, and reply in a sentence or two with the key point.');
  if (dir && digest) {
    lines.push('');
    lines.push(zh ? '下面是插件刚扫描到的仓库概况（目录、清单、部署文件、Git 版本），不必再逐个列目录或打开清单；需要作为证据引用的源码再去读：' : 'Below is the plugin\'s scan of the repository (folders, manifests, deployment files, Git revision); no need to list folders or open manifests again; read the source files you cite as evidence:');
    lines.push('');
    lines.push(clean(digest, 16_000));
  } else if (dir) {
    lines.push(zh ? '先调用 archify_scan 看一下仓库概况。' : 'Start with archify_scan for an overview of the repository.');
  }
  return lines.join('\n');
}

/**
 * The prompt for a review of the system a delivered Architecture diagram shows.
 * @param {{lang?: 'zh'|'en', title?: string, candidate: string, findings?: string[], repo?: string}} o
 *   `findings`: the plugin's structural checks, as lines; `repo`: the codebase the diagram was drawn from.
 */
export function reviewPrompt({ lang = 'en', title = '', candidate, findings = [], repo = '' } = {}) {
  const zh = lang === 'zh';
  const lines = [];
  if (zh) {
    lines.push(`请点评架构图「${title || basename(String(candidate ?? ''))}」描述的这个系统架构本身（不是图的画法）。`);
    lines.push(`图的数据在 ${candidate}（components、connections、boundaries 就是系统的组成和调用关系）。`);
    if (repo) lines.push(`它画的是 ${repo} 这个仓库；拿不准的地方去代码里核实。`);
    if (findings.length) {
      lines.push('插件的结构检查先发现了这些（启发式，只看图，请判断是否成立）：');
      lines.push(...findings);
    }
    lines.push('请按这个结构回答，简洁具体，指名组件：');
    lines.push('1. 一句话总评');
    lines.push('2. 主要风险，按严重程度排（单点、耦合、扩展性、安全、数据一致性、可观测性）');
    lines.push('3. 改进建议，每条能落地');
    lines.push('4. 做得好的地方');
    lines.push('不用重画图，除非我要求。');
  } else {
    lines.push(`Review the system architecture that the diagram "${title || basename(String(candidate ?? ''))}" describes: the system itself, not how it is drawn.`);
    lines.push(`The diagram's data is at ${candidate} (its components, connections and boundaries are the system's parts and calls).`);
    if (repo) lines.push(`It was drawn from the repository at ${repo}; check the code where unsure.`);
    if (findings.length) {
      lines.push('The plugin\'s structural checks found these first (heuristics over the drawing only; judge whether each holds):');
      lines.push(...findings);
    }
    lines.push('Answer in this shape, briefly and concretely, naming components:');
    lines.push('1. A one-line verdict');
    lines.push('2. The main risks, most serious first (single points of failure, coupling, scalability, security, data consistency, observability)');
    lines.push('3. Suggestions that can be acted on');
    lines.push('4. What is done well');
    lines.push('Do not redraw the diagram unless I ask.');
  }
  return lines.join('\n');
}
