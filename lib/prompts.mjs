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
 * The prompt for a change to a delivered diagram, sent to the conversation that drew it: it
 * names the diagram's files, so the change is made in place and the same page is rendered again.
 * @param {{lang?: 'zh'|'en', title?: string, type?: string, candidate: string, output?: string, instruction: string}} o
 */
export function editPrompt({ lang = 'en', title = '', type = '', candidate, output = '', instruction } = {}) {
  const zh = lang === 'zh';
  const what = type ? typeName(type, zh ? 'zh' : 'en') : zh ? '图' : 'diagram';
  const name = title || basename(String(candidate ?? ''));
  if (zh) {
    return [
      `请修改已经画好的${what}「${name}」：${String(instruction).trim()}`,
      `图的数据在 ${candidate}${output ? `，页面在 ${output}` : ''}。用 archify 技能：直接改这个候选文件，只改要求的部分，其余保持不变；如果要的是改造前后的对比，就保留这一版作为改造前，另存一份改造后的，再生成差异页。然后用 archify_render 传 candidate 重新渲染。`,
      '改完用一两句话说明改了什么。',
    ].join('\n');
  }
  return [
    `Change the ${what} "${name}" that is already drawn: ${String(instruction).trim()}`,
    `Its data is at ${candidate}${output ? ` and the page at ${output}` : ''}. With the archify skill, edit that candidate in place, changing only what is asked and keeping the rest; for a before/after comparison, keep this version as the before, save the after as a copy and make the delta page. Then render it again with archify_render and candidate.`,
    'Say in a sentence or two what changed.',
  ].join('\n');
}

/**
 * The prompt for a professional review of the system a delivered diagram shows. With code
 * behind it, every point is verified in the code and cites it; the `archify_review` tool
 * refuses a point whose citations do not check out. Without code, the review is of the
 * described design and cites the diagram's components.
 * @param {{lang?: 'zh'|'en', title?: string, candidate: string, repo?: string, revision?: string, basis?: 'code'|'description'}} o
 */
export function reviewPrompt({ lang = 'en', title = '', candidate, repo = '', revision = '', basis = repo ? 'code' : 'description' } = {}) {
  const zh = lang === 'zh';
  const name = title || basename(String(candidate ?? ''));
  const rev = revision ? revision.slice(0, 12) : '';
  const lines = [];
  if (zh) {
    lines.push(`请对架构图「${name}」所描述的系统做一次专业的架构评审。图的数据在 ${candidate}。`);
    if (basis === 'code') {
      lines.push(`代码在 ${repo}${rev ? `（当前提交 ${rev}）` : ''}。评审必须以代码为准，图只是索引。`);
      lines.push('要求：');
      lines.push('1. 先读代码，弄清这是什么软件、怎么运行（桌面或移动应用、命令行工具、插件、库、Web 服务、分布式系统……），用一句话写进 software。只评这类软件真正重要的方面，不适用的不提（比如单机应用不谈横向扩展、消息队列、网关）。');
      lines.push('2. 每条结论都要在代码里核实过，并给出依据：仓库根目录下的相对路径和行号范围（line、end_line），指向支撑这条结论的那段代码。核实不了的不写；不要泛泛而谈，不要套模板。');
      lines.push('3. 宁缺毋滥：只写对这个项目有实际影响的问题，按严重程度定级（risk、warn、info），一般 3–8 条；做得好的地方用 good，同样要有依据。');
      lines.push('4. 每个问题写清代码现在怎么做、为什么有影响，并给出能落地的改进建议（suggestion）。');
      lines.push(`写完后调用 archify_review 提交：candidate 填 ${candidate}，basis 填 code。工具会核对每条依据的文件和行号是否存在，不通过会告诉你哪一条要改。提交成功后，在对话里用几句话说结论，不用重复依据。`);
    } else {
      lines.push('这张图是按描述画的，没有代码。评审只能针对图里的设计方案：');
      lines.push('1. 先判断这是什么软件、打算怎么运行，用一句话写进 software；只评这类软件真正重要的方面。');
      lines.push('2. 每条结论都要指向图里的具体组件作为依据（evidence 填 {"component": "<组件 id>"}）。不要假设图里没有的事实；需要更多信息才能判断的，写成待确认的问题。');
      lines.push('3. 宁缺毋滥，按严重程度定级（risk、warn、info），做得好的用 good；每个问题给出改进建议（suggestion）。');
      lines.push(`写完后调用 archify_review 提交：candidate 填 ${candidate}，basis 填 description。提交成功后，在对话里用几句话说结论。`);
    }
    lines.push('不用重画图，除非我要求。');
  } else {
    lines.push(`Review, as an architect would, the system that the diagram "${name}" describes. The diagram's data is at ${candidate}.`);
    if (basis === 'code') {
      lines.push(`The code is at ${repo}${rev ? ` (commit ${rev})` : ''}. The code is the authority; the diagram is only a map to it.`);
      lines.push('Requirements:');
      lines.push('1. Read the code first and establish what kind of software this is and how it runs (a desktop or mobile app, a CLI, a plugin, a library, a web service, a distributed system…); put it in one line in `software`. Judge only what matters for that kind and leave out what does not apply (no scaling out, queues or gateways for an app on one machine).');
      lines.push('2. Verify every point in the code and cite it: a path relative to the repository root and the line range (`line`, `end_line`) of the code it rests on. Leave out what you cannot verify; no generic advice, no checklists.');
      lines.push('3. Fewer, better points: only problems with a real effect on this project, levelled risk, warn or info, usually three to eight; what is done well as good, cited the same way.');
      lines.push('4. For each problem, say what the code does now and why it matters, and give a change that can be made (`suggestion`).');
      lines.push(`Then submit it with archify_review: candidate ${candidate}, basis code. The tool checks that every cited file and line range exists and says which point to fix if not. Once it is saved, reply in a few sentences with the verdict; do not repeat the citations.`);
    } else {
      lines.push('The diagram was drawn from a description; there is no code behind it. Review the design it shows:');
      lines.push('1. Say what kind of software it is meant to be and how it would run, in one line in `software`; judge only what matters for that kind.');
      lines.push('2. Rest every point on components of the diagram (`evidence`: {"component": "<id>"}). Assume nothing the diagram does not show; what needs more information is a question to confirm.');
      lines.push('3. Fewer, better points, levelled risk, warn or info, and good for what is done well; a suggestion for each problem.');
      lines.push(`Then submit it with archify_review: candidate ${candidate}, basis description. Once it is saved, reply in a few sentences with the verdict.`);
    }
    lines.push('Do not redraw the diagram unless I ask.');
  }
  return lines.join('\n');
}
