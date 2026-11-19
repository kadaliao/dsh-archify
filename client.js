window.__ModuleLoader__.load({
  id: '@kadaliao/dsh-archify',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;
    let ReactDOM = null;
    try {
      ReactDOM = require('react-dom');
    } catch {
      ReactDOM = null;
    }
    let primitives = null;
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch {
      primitives = null;
    }

    const NS = 'archify';
    const RENDER_TOOL = 'archify_render';
    const CLI_TOOL = 'archify_cli';
    const PANEL_ID = 'archify';
    const LIST_ROUTE = '/__dsh_archify/list';
    const FILE_ROUTE = '/__dsh_archify/file/';
    const DELETE_ROUTE = '/__dsh_archify/delete';
    const OPEN_ROUTE = '/__dsh_archify/open';
    const PROMPT_ROUTE = '/__dsh_archify/prompt';
    const GENERATE_ROUTE = '/__dsh_archify/generate';
    const JOBS_ROUTE = '/__dsh_archify/jobs';
    const DISMISS_ROUTE = '/__dsh_archify/jobs/dismiss';
    const REVIEW_ROUTE = '/__dsh_archify/review';
    const ASK_ROUTE = '/__dsh_archify/ask';
    const EDIT_ROUTE = '/__dsh_archify/edit';
    const STATE_ROUTE = '/__dsh_archify/state';
    const PREVIEW_ROUTE = '/__dsh_archify/preview/';
    const EXAMPLE_ROUTE = '/__dsh_archify/example/';
    const SCAN_TOOL = 'archify_scan';
    const REVIEW_TOOL = 'archify_review';
    const PAGE = 60;
    const POLL_MS = 5000;
    const SANDBOX = 'allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals';

    const C = {
      base: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      layer3: 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2))',
      border: 'var(--dsw-alias-border-l2, rgba(127,127,127,.25))',
      border1: 'var(--dsw-alias-border-l1, rgba(127,127,127,.15))',
      label: 'var(--dsw-alias-brand-primary)',
      primary: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      faint: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))',
      error: 'var(--dsw-alias-state-error-primary, #f25a5a)',
      ok: 'var(--dsw-alias-state-success-primary, #22a06b)',
    };
    const FONT = 'var(--dsh-content-font-size, 13.5px)';
    const SMALL = 'var(--dsh-content-font-size-secondary, 12.5px)';

    // Outside a page (a test, a closed window) there is no fetch: nothing to load.
    const getJson = (url) => (typeof fetch !== 'function' ? Promise.resolve(null) : fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)));
    const postJson = (url, body) =>
      typeof fetch !== 'function'
        ? Promise.resolve(null)
        : fetch(url, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }).then((r) => (r.ok ? r.json() : null));

    /** Light or dark, from the Harness page's own background, so the diagram matches it. */
    function pageTheme() {
      try {
        const bg = getComputedStyle(document.body).backgroundColor;
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
        if (m) {
          const [r, g, b] = [m[1], m[2], m[3]].map(Number);
          return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light';
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch {
        return 'light';
      }
    }

    /** The page's address: `embed` shows only the drawing, without the viewer's controls. */
    function pageUrl(item, { embed = false, theme } = {}) {
      const q = new URLSearchParams();
      if (item.version) q.set('v', item.version);
      if (embed) q.set('embed', '1');
      q.set('theme', theme ?? pageTheme());
      return `${item.src ?? `${FILE_ROUTE}${encodeURIComponent(item.id)}`}?${q.toString()}`;
    }

    function download(item) {
      try {
        const a = document.createElement('a');
        a.href = `${FILE_ROUTE}${encodeURIComponent(item.id)}?download=1`;
        a.download = (item.path ?? item.output ?? 'archify.html').split(/[\\/]/).pop();
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        // Nothing to do without a document.
      }
    }

    function copyText(text) {
      try {
        if (typeof primitives?.writeClipboard === 'function') return void primitives.writeClipboard(text);
        if (navigator?.clipboard?.writeText) void navigator.clipboard.writeText(text).catch(() => {});
      } catch {
        // The clipboard is a convenience.
      }
    }

    const openWithSystem = (item, action) => postJson(OPEN_ROUTE, { id: item.id, action }).catch(() => null);
    const openTab = (item) => {
      try {
        window.open(pageUrl(item), '_blank', 'noopener');
      } catch {
        // A blocked popup leaves the full-screen view.
      }
    };

    function fmtWhen(t, at, now = Date.now()) {
      const ms = Math.max(0, now - at);
      if (ms < 60_000) return t('justNow');
      if (ms < 3_600_000) return t('minutesAgo', { n: Math.round(ms / 60_000) });
      if (ms < 86_400_000) return t('hoursAgo', { n: Math.round(ms / 3_600_000) });
      if (ms < 7 * 86_400_000) return t('daysAgo', { n: Math.round(ms / 86_400_000) });
      try {
        return new Date(at).toLocaleDateString();
      } catch {
        return '';
      }
    }
    const fmtMs = (ms) => (ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

    // --- icons -------------------------------------------------------------------------

    const svg = (size, paths, extra = {}) =>
      h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', ...extra },
        ...paths.map((d, i) => h('path', { key: i, d })),
      );
    const ExpandIcon = ({ size = 15 }) => svg(size, ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5']);
    const BrowserIcon = ({ size = 15 }) => svg(size, ['M14 4h6v6', 'M20 4l-8.5 8.5', 'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4']);
    const DownloadIcon = ({ size = 15 }) => svg(size, ['M12 4v11', 'M7 10l5 5 5-5', 'M4 19h16']);
    const FolderIcon = ({ size = 15 }) => svg(size, ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']);
    const CopyIcon = ({ size = 15 }) => svg(size, ['M9 9h10v10H9z', 'M5 15V5h10']);
    const CloseIcon = ({ size = 16 }) => svg(size, ['M6 6l12 12', 'M18 6L6 18']);
    const ChatIcon = ({ size = 15 }) => svg(size, ['M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.3-4.6A7.5 7.5 0 1 1 20 11.5z']);
    const TrashIcon = ({ size = 15 }) => svg(size, ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13']);
    const EditIcon = ({ size = 15 }) => svg(size, ['M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4z', 'M13.5 6.5l4 4']);
    const ReviewIcon = ({ size = 15 }) => svg(size, ['M10 6h10', 'M10 12h10', 'M10 18h10', 'M3.5 6l1.5 1.5L7.5 5', 'M3.5 12l1.5 1.5L7.5 11', 'M3.5 18l1.5 1.5L7.5 17']);

    /** Opens the Archify panel; set when the client applies. */
    const panelOpener = { fn: null };

    /** The panel's glyph: a node branching to two. */
    function ArchifyGlyph(props) {
      const size = Number(props?.size) > 0 ? Number(props.size) : 18;
      const ink = props?.active ? C.label : 'currentColor';
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: ink, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('rect', { key: 'a', x: 2.5, y: 9.5, width: 7, height: 5, rx: 1.4 }),
        h('rect', { key: 'b', x: 14.5, y: 3.5, width: 7, height: 5, rx: 1.4 }),
        h('rect', { key: 'c', x: 14.5, y: 15.5, width: 7, height: 5, rx: 1.4, fill: props?.active ? C.label : 'none' }),
        h('path', { key: 'p', d: 'M9.5 12h2.5M12 8v8M12 8c0-1 .5-2 2.5-2M12 16c0 1 .5 2 2.5 2' }),
      );
    }

    function ToolButton({ onClick, title, icon, label, ...rest }) {
      return h(
        'button',
        {
          type: 'button',
          title,
          'aria-label': title,
          onClick: (e) => {
            e.stopPropagation();
            onClick?.(e);
          },
          ...rest,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 26,
            padding: label ? '0 9px' : 0,
            width: label ? undefined : 26,
            justifyContent: 'center',
            font: 'inherit',
            fontSize: 12,
            color: C.muted,
            background: 'transparent',
            border: 'none',
            borderRadius: 7,
            cursor: 'pointer',
          },
          onMouseEnter: (e) => {
            e.currentTarget.style.background = C.hover;
            e.currentTarget.style.color = C.primary;
          },
          onMouseLeave: (e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = C.muted;
          },
        },
        icon,
        label ?? null,
      );
    }

    /** The actions every page offers: full screen, browser, download, folder, path. */
    function PageActions({ t, item, onExpand, compact = false }) {
      const [copied, setCopied] = useState(false);
      const path = item.path ?? item.output ?? '';
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' } },
        onExpand ? h(ToolButton, { onClick: onExpand, title: t('fullScreen'), icon: h(ExpandIcon), label: compact ? null : t('fullScreenShort'), 'data-dsh-archify-expand': true }) : null,
        h(ToolButton, { onClick: () => openWithSystem(item, 'open'), title: t('openBrowser'), icon: h(BrowserIcon), label: compact ? null : t('openBrowserShort') }),
        h(ToolButton, { onClick: () => download(item), title: t('download'), icon: h(DownloadIcon) }),
        h(ToolButton, { onClick: () => openWithSystem(item, 'reveal'), title: t('reveal'), icon: h(FolderIcon) }),
        path
          ? h(ToolButton, {
              onClick: () => {
                copyText(path);
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              },
              title: copied ? t('copied') : t('copyPath'),
              icon: copied ? svg(15, ['M5 12.5l4.5 4.5L19 7']) : h(CopyIcon),
            })
          : null,
      );
    }

    const typeLabel = (t, type) => {
      const key = `type.${type}`;
      const label = t(key);
      return label === key ? type : label;
    };

    function TypeChip({ t, type }) {
      return h(
        'span',
        { style: { flex: 'none', fontSize: 11, lineHeight: '17px', padding: '0 7px', borderRadius: 6, color: C.label, background: 'color-mix(in srgb, currentColor 10%, transparent)', fontWeight: 600 } },
        typeLabel(t, type),
      );
    }

    // --- the page itself ---------------------------------------------------------------

    /** Tallest inline preview; a taller drawing is shown narrower, whole. */
    const PREVIEW_MAX = 720;
    /** The embed's padding on each side of the drawing (Archify's 0.5rem), and slack below it. */
    const EMBED_PAD = 8;
    const EMBED_SLACK = 4;

    /**
     * Size of the inline preview in a box `width` wide. The embed fits the
     * drawing to its width, so a drawing too tall for the box gets a narrower
     * frame instead of losing its bottom.
     */
    function previewBox(item, width) {
      const w = Math.max(280, width || 680);
      if (item.type === 'explainer' || !(item.aspect > 0)) return { width: w, height: Math.round(Math.min(620, Math.max(420, w * 0.72))) };
      // The drawing is the frame's width less the side padding, scaled by its aspect.
      const extra = 2 * EMBED_PAD + EMBED_SLACK;
      const fit = Math.min(w, Math.floor((PREVIEW_MAX - extra) / item.aspect + 2 * EMBED_PAD));
      return { width: fit, height: Math.round(Math.max(220, (fit - 2 * EMBED_PAD) * item.aspect + extra)) };
    }

    /** The preview frame, centered in its box when narrower. */
    function FittedFrame({ item, width, title }) {
      const box = previewBox(item, width);
      return h(
        'div',
        { style: { display: 'flex', justifyContent: 'center' } },
        h('div', { style: { width: box.width, maxWidth: '100%' } }, h(PageFrame, { item, height: box.height, title })),
      );
    }

    function PageFrame({ item, embed = true, height, title }) {
      const theme = pageTheme();
      return h('iframe', {
        key: `${item.id}:${item.version}:${theme}:${embed}`,
        src: pageUrl(item, { embed, theme }),
        title,
        sandbox: SANDBOX,
        referrerPolicy: 'no-referrer',
        loading: 'lazy',
        'data-dsh-archify-frame': item.id,
        style: { display: 'block', width: '100%', height: height ?? '100%', border: 'none', background: 'transparent' },
      });
    }

    /** One delivered page in the conversation: the drawing, with its actions. */
    function PageCard({ t, item }) {
      const box = useRef(null);
      const [width, setWidth] = useState(0);
      const [full, setFull] = useState(false);
      useEffect(() => {
        const el = box.current;
        if (!el) return undefined;
        setWidth(el.clientWidth);
        if (typeof ResizeObserver !== 'function') return undefined;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
      }, []);
      return h(
        'div',
        { 'data-dsh-archify-card': item.id, style: { border: `1px solid ${C.border1}`, borderRadius: 12, overflow: 'hidden', background: C.layer1, maxWidth: 980 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 12px', borderBottom: `1px solid ${C.border1}`, minWidth: 0 } },
          h(ArchifyGlyph, { size: 15, active: true }),
          h(TypeChip, { t, type: item.type }),
          h('span', { title: item.title, style: { fontSize: SMALL, fontWeight: 600, color: C.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 } }, item.title),
          h(PageActions, { t, item, onExpand: () => setFull(true), compact: width > 0 && width < 560 }),
          item.type === 'architecture' && typeof panelOpener.fn === 'function'
            ? h(ToolButton, {
                onClick: () => {
                  requestPage(item.id, { review: true });
                  panelOpener.fn();
                },
                title: t('reviewInPanel'),
                icon: h(ReviewIcon),
                'data-dsh-archify-review-open': item.id,
              })
            : null,
        ),
        h(
          'div',
          { ref: box, style: { position: 'relative', cursor: 'zoom-in' }, onDoubleClick: () => setFull(true) },
          width > 0 ? h(FittedFrame, { item, width, title: item.title }) : h('div', { style: { height: previewBox(item, 680).height } }),
        ),
        full ? h(FullScreen, { t, item, onClose: () => setFull(false) }) : null,
      );
    }

    /** The whole viewer over the window: its toolbar, themes, export and motion. */
    const TIP_KEY = 'dsh-archify-fullscreen-tips';
    function FullScreen({ t, item, onClose, onOpenSession }) {
      // How to read the page, the first three times full screen opens.
      const [tip, setTip] = useState(() => {
        try {
          const n = Number(window.localStorage?.getItem(TIP_KEY)) || 0;
          window.localStorage?.setItem(TIP_KEY, String(n + 1));
          return n < 3;
        } catch {
          return false;
        }
      });
      useEffect(() => {
        const onKey = (e) => {
          if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, []);
      const node = h(
        'div',
        {
          'data-dsh-archify-fullscreen': item.id,
          role: 'dialog',
          'aria-label': item.title,
          style: { position: 'fixed', inset: 0, zIndex: 2147483000, display: 'flex', flexDirection: 'column', background: C.base, color: C.primary, fontSize: FONT },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 8px 16px', borderBottom: `1px solid ${C.border1}`, minWidth: 0 } },
          h(ArchifyGlyph, { size: 16, active: true }),
          h(TypeChip, { t, type: item.type }),
          h('span', { style: { fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 } }, item.title),
          onOpenSession ? h(ToolButton, { onClick: onOpenSession, title: t('openSession'), icon: h(ChatIcon), label: t('openSessionShort') }) : null,
          h(ToolButton, { onClick: () => openTab(item), title: t('newTab'), icon: svg(15, ['M4 6h16v12H4z', 'M4 10h16']) }),
          item.example ? null : h(PageActions, { t, item }),
          h('span', { style: { width: 1, height: 18, background: C.border1, margin: '0 4px' } }),
          h(ToolButton, { onClick: onClose, title: t('close'), icon: h(CloseIcon, { size: 17 }), 'data-dsh-archify-close': true }),
        ),
        tip
          ? h(
              'div',
              { 'data-dsh-archify-fullscreen-tip': true, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', fontSize: 12, color: C.muted, background: C.layer1, borderBottom: `1px solid ${C.border1}` } },
              h('span', { style: { flex: 1 } }, t('fullscreenTip')),
              h(ToolButton, { onClick: () => setTip(false), title: t('close'), icon: h(CloseIcon, { size: 13 }) }),
            )
          : null,
        h('div', { style: { flex: 1, minHeight: 0 } }, h(PageFrame, { item, embed: false, title: item.title })),
      );
      return ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' ? ReactDOM.createPortal(node, document.body) : node;
    }

    // --- the tool calls ----------------------------------------------------------------

    function parseArgs(block) {
      const raw = block?.argsRaw ?? block?.call?.argsRaw;
      if (typeof raw === 'string' && raw !== '') {
        try {
          return JSON.parse(raw);
        } catch {
          // Partial JSON while the call streams: pick what is readable.
          const out = {};
          for (const key of ['type', 'name', 'candidate']) {
            const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(raw);
            if (m) out[key] = m[1];
          }
          const title = /"title"\s*:\s*"([^"]*)"/.exec(raw);
          if (title) out.title = title[1];
          return out;
        }
      }
      const args = block?.args;
      if (args && typeof args === 'object') {
        try {
          return typeof args.toJSON === 'function' ? args.toJSON() : { ...args };
        } catch {
          return {};
        }
      }
      return {};
    }

    function resultText(block) {
      return (Array.isArray(block?.content) ? block.content : [])
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
        .trim();
    }

    /** A delivered page as the card wants it, from a result's meta; null when none. */
    function pageOf(meta) {
      if (!meta || meta.ok !== true || typeof meta.id !== 'string' || meta.id === '') return null;
      return { id: meta.id, version: meta.version, type: meta.type, title: meta.title || meta.type, path: meta.output, aspect: Number(meta.aspect) || 0 };
    }

    function Gates({ t, meta }) {
      const gates = meta?.gates && typeof meta.gates === 'object' ? meta.gates : {};
      const names = Object.keys(gates);
      if (names.length === 0) return null;
      return h(
        'span',
        { style: { display: 'inline-flex', gap: 8, flexWrap: 'wrap' } },
        names.map((name) => {
          const s = gates[name];
          const skipped = name === 'browser-check' && meta.browserSkipped;
          const mark = s === 'pass' ? '✓' : s === 'fail' ? '✕' : skipped || s === 'skipped' ? '–' : '·';
          const color = s === 'pass' ? C.ok : s === 'fail' ? C.error : C.faint;
          return h('span', { key: name, title: skipped ? t('browserSkipped') : `${name}: ${s}`, style: { color } }, `${mark} ${t(`gate.${name}`)}`);
        }),
      );
    }

    function RenderToolView(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT;
      const { phase, block } = props;
      const args = parseArgs(block);
      const settled = phase === 'result';
      const meta = settled && block?.meta && typeof block.meta === 'object' ? block.meta : null;
      const [open, setOpen] = useState(false);
      const type = (meta?.type || args.type || '').toString();
      const title = meta?.title || args?.spec?.meta?.title || args.name || (args.candidate ? String(args.candidate).split(/[\\/]/).slice(-2, -1)[0] : '');
      const repair = !args.spec && !args.markdown && args.candidate;

      let state;
      if (!settled) state = h('span', { style: { color: C.faint, fontStyle: 'italic' } }, t(phase === 'preparing' ? 'writing' : 'rendering'));
      else if (block?.isError) state = h('span', { style: { color: C.error } }, t('failed'));
      else if (meta?.ok) state = h('span', { style: { color: C.faint } }, [t('delivered'), meta.ms ? fmtMs(meta.ms) : null].filter(Boolean).join(' · '));
      else if (meta) state = h('span', { style: { color: C.error } }, t('stoppedAt', { stage: t(`gate.${meta.failedStage}`) === `gate.${meta.failedStage}` ? meta.failedStage || meta.status : t(`gate.${meta.failedStage}`) }));

      const head = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: SMALL, color: C.muted, minWidth: 0 } },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: settled && meta?.ok ? C.label : C.faint, fontWeight: 600, flex: 'none' } }, h(ArchifyGlyph, { size: 14, active: settled && meta?.ok }), t('toolTitle')),
        type ? h(TypeChip, { t, type }) : null,
        title ? h('span', { style: { color: C.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, title) : null,
        repair && !settled ? h('span', { style: { color: C.faint, flex: 'none' } }, t('rerun')) : null,
        h('span', { style: { flex: 1 } }),
        state ?? null,
      );

      let body = null;
      if (settled && block?.isError) {
        body = h('div', { style: { fontSize: SMALL, color: C.error, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' } }, resultText(block) || t('failed'));
      } else if (meta && !meta.ok) {
        const diags = Array.isArray(meta.diagnostics) ? meta.diagnostics : [];
        body = h(
          'div',
          { style: { fontSize: 12, color: C.muted, display: 'flex', flexDirection: 'column', gap: 4 } },
          h(Gates, { t, meta }),
          diags.length > 0
            ? h(
                'div',
                null,
                h(
                  'button',
                  { type: 'button', onClick: () => setOpen((v) => !v), style: { font: 'inherit', fontSize: 12, color: C.muted, background: 'none', border: 'none', padding: 0, cursor: 'pointer' } },
                  `${open ? '▾' : '▸'} ${t('diagnostics', { n: meta.diagnosticTotal || diags.length })}`,
                ),
                open
                  ? h(
                      'ul',
                      { style: { margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.5, userSelect: 'text' } },
                      diags.map((d, i) => h('li', { key: i }, h('code', { style: { fontSize: 11.5, color: d.severity === 'error' ? C.error : C.faint } }, d.code), ' ', d.message)),
                    )
                  : null,
              )
            : null,
          h('div', { style: { color: C.faint } }, t('modelRepairs')),
        );
      } else if (meta?.ok) {
        body = h('div', { style: { fontSize: 12, color: C.muted } }, h(Gates, { t, meta }));
      }
      return h('div', { 'data-dsh-archify-call': block?.callId ?? '', style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } }, head, body);
    }

    function CliToolView(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT;
      const { phase, block } = props;
      const args = parseArgs(block);
      const list = Array.isArray(args.args) ? args.args.map(String) : [];
      const settled = phase === 'result';
      const [open, setOpen] = useState(false);
      const text = settled ? resultText(block) : '';
      const exit = /^exit (-?\d+)/.exec(text);
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, fontSize: SMALL } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, color: C.muted, minWidth: 0 } },
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: C.faint, fontWeight: 600, flex: 'none' } }, h(ArchifyGlyph, { size: 14 }), t('toolTitle')),
          h('code', { style: { fontSize: 12, color: C.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, `archify ${list.join(' ')}`),
          h('span', { style: { flex: 1 } }),
          !settled
            ? h('span', { style: { color: C.faint, fontStyle: 'italic' } }, t('running'))
            : h(
                'button',
                { type: 'button', onClick: () => setOpen((v) => !v), style: { font: 'inherit', fontSize: 12, color: exit && exit[1] !== '0' ? C.error : C.faint, background: 'none', border: 'none', padding: 0, cursor: 'pointer' } },
                `${exit ? `exit ${exit[1]}` : ''} ${open ? '▾' : '▸'}`,
              ),
        ),
        settled && open
          ? h('pre', { style: { margin: 0, maxHeight: 320, overflow: 'auto', fontSize: 11.5, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8, background: C.layer2, color: C.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' } }, text)
          : null,
      );
    }

    function ScanToolView(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT;
      const { phase, block } = props;
      const settled = phase === 'result';
      const meta = settled && block?.meta && typeof block.meta === 'object' ? block.meta : null;
      const [open, setOpen] = useState(false);
      const text = settled ? resultText(block) : '';
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, fontSize: SMALL } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, color: C.muted, minWidth: 0 } },
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: C.faint, fontWeight: 600, flex: 'none' } }, h(ArchifyGlyph, { size: 14 }), t('toolTitle')),
          h('span', { style: { color: C.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, meta?.root ? t('scanned', { root: String(meta.root).split(/[\\/]/).pop() }) : t('act.scanning')),
          h('span', { style: { flex: 1 } }),
          !settled
            ? h('span', { style: { color: C.faint, fontStyle: 'italic' } }, t('running'))
            : h(
                'button',
                { type: 'button', onClick: () => setOpen((v) => !v), style: { font: 'inherit', fontSize: 12, color: block?.isError ? C.error : C.faint, background: 'none', border: 'none', padding: 0, cursor: 'pointer' } },
                `${meta?.ms ? fmtMs(meta.ms) : ''} ${open ? '▾' : '▸'}`,
              ),
        ),
        settled && open
          ? h('pre', { style: { margin: 0, maxHeight: 320, overflow: 'auto', fontSize: 11.5, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8, background: C.layer2, color: C.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' } }, text)
          : null,
      );
    }

    function ReviewToolView(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT;
      const { phase, block } = props;
      const settled = phase === 'result';
      const meta = settled && block?.meta && typeof block.meta === 'object' ? block.meta : null;
      const failed = settled && block?.isError;
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, fontSize: SMALL } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, color: C.muted, minWidth: 0 } },
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: meta?.archifyReview ? C.label : C.faint, fontWeight: 600, flex: 'none' } }, h(ReviewIcon, { size: 14 }), t('reviewTitle')),
          h('span', { style: { color: failed ? C.error : C.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, !settled ? t('reviewChecking') : failed ? t('reviewRefused') : t('reviewSaved', { n: meta?.findings ?? 0 })),
          h('span', { style: { flex: 1 } }),
          meta?.id && typeof panelOpener.fn === 'function' ? h(ToolButton, { onClick: () => { requestPage(meta.id, { review: true }); panelOpener.fn(); }, title: t('reviewInPanel'), icon: h(ReviewIcon) }) : null,
        ),
        failed ? h('div', { style: { fontSize: 12, color: C.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' } }, resultText(block)) : null,
      );
    }

    // --- the page as a row of the conversation -----------------------------------------
    //
    // The tool card lives in the turn's process fold, which closes when the turn
    // completes. The page is the answer, so a second node shows it at the `turn`
    // level, beside the model's text, where the fold cannot hide it.

    const RESULT_KIND = 'archify-page';
    const ownCalls = new Set();

    function isOwnResult(event) {
      if (event?.type !== 'tool/result' || event.surfaceOp !== 'append') return false;
      const data = event.data ?? {};
      const callId = String(data.message?.source?.callId ?? data.message?.toolCallId ?? '');
      if (callId !== '' && ownCalls.has(callId)) return true;
      // A replayed feed may start after the call: the meta marks the tool's own results.
      return data.meta?.archify === true;
    }

    const pageResultDefinition = {
      kind: RESULT_KIND,
      target: 'chat',
      match: (event) => {
        if (event?.type === 'tool/call') {
          if (event.data?.name === RENDER_TOOL) ownCalls.add(String(event.data.callId));
          return null;
        }
        if (!isOwnResult(event)) return null;
        const data = event.data;
        return { id: String(data.message?.source?.callId ?? data.message?.toolCallId ?? event.seq), role: 'start' };
      },
      start: (_context, match) => {
        const data = match.event.data ?? {};
        return {
          callId: String(data.message?.source?.callId ?? data.message?.toolCallId ?? ''),
          seq: match.event.seq,
          time: match.event.time,
          isError: data.message?.isError === true,
          meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
        };
      },
      update: (context) => context.state,
      buildViewNode: (context) => {
        const state = context.state;
        if (state === undefined || state.isError || pageOf(state.meta) === null) return null;
        return {
          key: context.key,
          kind: RESULT_KIND,
          id: context.id,
          target: 'chat',
          anchorSeq: state.seq + 0.2,
          location: context.start.location,
          visibility: 'visible',
          groupTree: 'turn',
          data: state,
        };
      },
    };

    function PageRow(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT;
      const state = props.node?.data ?? {};
      const item = pageOf(state.meta);
      if (!item) return null;
      return h('div', { 'data-dsh-archify-row': state.callId, style: { padding: '6px 0 10px' } }, h(PageCard, { t, item }));
    }

    // --- the panel ---------------------------------------------------------------------
    //
    // Three tabs: New (a diagram from a project folder or a description, in one
    // click), Gallery (every page, with a structural review of an architecture)
    // and Guide (what Archify does, as prompts to copy).

    const PICKABLE = ['auto', 'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall', 'explainer'];
    const langOf = (t) => (typeof t === 'function' && t('lang') === 'zh' ? 'zh' : 'en');
    const listJoin = (t, xs) => (Array.isArray(xs) ? xs.slice(0, 6).join(langOf(t) === 'zh' ? '、' : ', ') + (xs.length > 6 ? '…' : '') : String(xs ?? ''));
    const live = (job) => job && (job.state === 'starting' || job.state === 'running');
    const baseName = (p) => String(p ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p ?? '');

    /** Example focuses per type: for a codebase (`repo`) and for a described subject (`desc`). */
    const EXAMPLES = {
      zh: {
        auto: { repo: ['画出这个仓库的整体结构', '这个项目处理一个请求的完整路径'], desc: ['把下面这段说明画成最合适的图：……'] },
        architecture: { repo: ['画整体架构，标出对外接口和数据存储', '只画后端服务之间怎么调用', '部署架构：容器、数据库、缓存和外部服务'], desc: ['电商下单系统：Web/App 客户端、API 网关、订单服务、库存服务、支付服务（对接第三方支付）、消息队列、订单库和 Redis 缓存', '家里的网络：光猫、路由器、NAS、电视、手机和笔记本'] },
        workflow: { repo: ['从提交代码到上线的发布流程（看 CI 配置）', '用户注册的处理流程，包括校验失败和重试'], desc: ['报销审批：员工提交、主管审批（超过 5000 元还要总监审批）、财务打款', '搬家前一个月的准备步骤'] },
        sequence: { repo: ['用户登录：前端、网关、认证服务、数据库之间的调用和返回', '下单接口的一次请求经过哪些模块'], desc: ['缓存未命中时的一次请求：客户端、服务、Redis、数据库', 'OAuth 授权码登录的完整往返'] },
        dataflow: { repo: ['数据从采集到报表经过哪些处理', '日志和埋点数据都去了哪里'], desc: ['埋点：App 上报 → 采集网关 → Kafka → 实时计算和数仓 → BI 报表', '一笔工资从公司到个人账户的流向'] },
        lifecycle: { repo: ['订单有哪些状态、怎么流转（看状态枚举和处理代码）', '后台任务的状态机，包括重试和超时'], desc: ['网购订单：待支付、已支付、已发货、已签收、退款中、已关闭', '一份签证申请从递交到出签的各个状态'] },
        erd: { repo: ['数据库表结构和外键关系（看迁移文件或 ORM 模型）', '只画用户和订单相关的表'], desc: ['博客系统：用户、文章、评论、标签（文章和标签多对多）'] },
        class: { repo: ['核心领域模型的类图', '支付模块的接口和实现类'], desc: ['动物、狗、猫的继承关系和各自的方法'] },
        tree: { repo: ['这个仓库的模块树', '按模块拆开的功能清单'], desc: ['公司组织架构：CEO 下面有技术、产品、市场三个部门', '一个 App 的功能拆解'] },
        timeline: { repo: ['版本历史（看 git tag 和 CHANGELOG）'], desc: ['一次线上故障：告警、定位、回滚、恢复', '我的求职时间线'] },
        waterfall: { repo: ['一次页面加载各步骤的耗时（按代码里的调用顺序估算）'], desc: ['一次 API 请求的耗时：DNS 20ms、TLS 50ms、网关 5ms、服务 120ms（其中数据库 80ms）', '一次 AI 代理运行各步骤的耗时'] },
        explainer: { repo: ['用一页讲清楚这个项目做什么、怎么跑起来', '这个仓库的认证是怎么做的'], desc: ['HTTPS 第一次访问为什么慢', '对比 Postgres 和 MySQL，给团队选型用'] },
      },
      en: {
        auto: { repo: ['The overall structure of this repository', 'The full path one request takes through this project'], desc: ['Draw the description below as whatever diagram fits best: …'] },
        architecture: { repo: ['The overall architecture, with external interfaces and data stores', 'Only how the backend services call each other', 'The deployment: containers, databases, caches and outside services'], desc: ['An online shop: web/app clients, API gateway, order, inventory and payment services (with a payment provider), a message queue, the orders database and a Redis cache', 'My home network: modem, router, NAS, TV, phones and laptops'] },
        workflow: { repo: ['The release process from commit to production (from the CI config)', 'How a sign-up is handled, including validation failures and retries'], desc: ['Expense approval: an employee submits, the manager approves (a director too above $5,000), finance pays', 'The month before moving house, step by step'] },
        sequence: { repo: ['Login: the calls and returns between frontend, gateway, auth service and database', 'Which modules one checkout request goes through'], desc: ['A request on a cache miss: client, service, Redis, database', 'The full OAuth authorization-code round trip'] },
        dataflow: { repo: ['How data goes from collection to reports', 'Where the logs and analytics events end up'], desc: ['Analytics: app events → collector → Kafka → stream processing and warehouse → BI reports', 'Where a salary goes, from the company to a bank account'] },
        lifecycle: { repo: ['The states of an order and how it moves between them (from the enum and its handlers)', 'The state machine of a background job, with retries and timeouts'], desc: ['An online order: awaiting payment, paid, shipped, delivered, refunding, closed', 'A visa application from submission to decision'] },
        erd: { repo: ['The database tables and their foreign keys (from the migrations or ORM models)', 'Only the tables around users and orders'], desc: ['A blog: users, posts, comments and tags (posts and tags many-to-many)'] },
        class: { repo: ['A class diagram of the core domain model', 'The interfaces and implementations of the payments module'], desc: ['Animal, Dog and Cat: inheritance and methods'] },
        tree: { repo: ['The module tree of this repository', 'The feature list broken down by module'], desc: ['An org chart: the CEO with engineering, product and marketing below', 'The features of an app, broken down'] },
        timeline: { repo: ['The release history (from git tags and the CHANGELOG)'], desc: ['An incident: alert, diagnosis, rollback, recovery', 'My job search, month by month'] },
        waterfall: { repo: ['Where the time goes when a page loads (estimated from the call order in the code)'], desc: ['One API request: DNS 20ms, TLS 50ms, gateway 5ms, service 120ms (of which database 80ms)', 'The steps of one AI agent run and how long each took'] },
        explainer: { repo: ['One page on what this project does and how to run it', 'How authentication works in this repository'], desc: ['Why the first HTTPS visit is slower', 'Postgres or MySQL, for the team to decide'] },
      },
    };

    /** Changes people often want on a drawn diagram: they fill the edit box, to be adjusted before sending. */
    const EDIT_SUGGESTIONS = {
      zh: {
        all: ['整理一下布局，减少交叉和绕线', '换成 blueprint 风格', '图里的文字改成英文', '加上图例'],
        architecture: ['真实产品用官方品牌图标（AWS、Redis、Stripe……）', '把「……」拆成两个组件：……', '画一张改造前后的对比页，改动是：……'],
        explainer: ['结论写得更直接', '加一张对比表'],
      },
      en: {
        all: ['Tidy the layout: fewer crossings and detours', 'Switch to the blueprint style', 'Write the diagram text in Chinese', 'Add a legend'],
        architecture: ['Use the official brand marks for real products (AWS, Redis, Stripe…)', 'Split "…" into two components: …', 'Make a before/after comparison page; the change is: …'],
        explainer: ['Make the conclusion more direct', 'Add a comparison table'],
      },
    };
    const editSuggestions = (lang, type) => {
      const d = EDIT_SUGGESTIONS[lang] ?? EDIT_SUGGESTIONS.en;
      return type === 'explainer' ? d.explainer : [...(d[type] ?? []), ...d.all];
    };

    /** A type's thumbnail in the Harness's theme, and its example as a live page. */
    const previewSrc = (type) => `${PREVIEW_ROUTE}${encodeURIComponent(type)}-${pageTheme()}.webp`;
    const exampleItem = (t, type) => ({ id: `example-${type}`, src: `${EXAMPLE_ROUTE}${encodeURIComponent(type)}`, type, title: t('exampleOf', { type: typeLabel(t, type) }), version: 'example', aspect: 0, example: true });

    function Thumb({ type, height, fit = 'cover', onClick, title }) {
      const [broken, setBroken] = useState(false);
      const box = { display: 'block', width: '100%', height, borderRadius: 7, background: C.layer2, border: `1px solid ${C.border1}`, overflow: 'hidden', boxSizing: 'border-box', cursor: onClick ? 'zoom-in' : undefined, flex: 'none' };
      if (type === 'auto') {
        // Best fit: four kinds side by side.
        return h(
          'span',
          { style: { ...box, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 1 } },
          ['architecture', 'sequence', 'workflow', 'erd'].map((k) => h('img', { key: k, src: previewSrc(k), alt: '', loading: 'lazy', style: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top left', display: 'block' } })),
        );
      }
      if (broken) return h('span', { style: box });
      return h(
        'span',
        { style: box, onClick, title, role: onClick ? 'button' : undefined, 'data-dsh-archify-thumb': type },
        h('img', { src: previewSrc(type), alt: title ?? '', loading: 'lazy', onError: () => setBroken(true), style: { width: '100%', height: '100%', objectFit: fit, objectPosition: fit === 'cover' ? 'top center' : 'center', display: 'block' } }),
      );
    }

    const fieldStyle = { font: 'inherit', fontSize: SMALL, color: C.primary, background: C.layer2, border: `1px solid ${C.border1}`, borderRadius: 8, padding: '7px 10px', outline: 'none', boxSizing: 'border-box' };

    function Btn({ kind = 'plain', onClick, disabled, title, children, ...rest }) {
      const primary = kind === 'primary';
      return h(
        'button',
        {
          type: 'button',
          title,
          disabled: disabled === true,
          onClick: (e) => {
            e.stopPropagation();
            if (!disabled) onClick?.(e);
          },
          ...rest,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 30,
            padding: '0 12px',
            font: 'inherit',
            fontSize: SMALL,
            fontWeight: primary ? 620 : 500,
            color: primary ? 'var(--dsw-alias-label-on-brand, #fff)' : C.primary,
            background: primary ? C.label : C.layer2,
            border: primary ? 'none' : `1px solid ${C.border1}`,
            borderRadius: 8,
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            whiteSpace: 'nowrap',
          },
        },
        children,
      );
    }

    function Chip({ on, onClick, children, title, ...rest }) {
      return h(
        'button',
        {
          type: 'button',
          title,
          onClick: (e) => {
            e.stopPropagation();
            onClick?.(e);
          },
          ...rest,
          style: { font: 'inherit', fontSize: 12, lineHeight: '16px', padding: '4px 10px', borderRadius: 999, cursor: 'pointer', color: on ? C.label : C.muted, background: on ? 'color-mix(in srgb, currentColor 10%, transparent)' : 'transparent', border: `1px solid ${on ? 'currentColor' : C.border1}`, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        },
        children,
      );
    }

    function Section({ title, children, aside }) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, h('span', { style: { fontSize: SMALL, fontWeight: 640, color: C.primary } }, title), aside ? h('span', { style: { fontSize: 11.5, color: C.faint } }, aside) : null),
        children,
      );
    }

    function elapsed(job, now = Date.now()) {
      const end = live(job) ? now : job.endedAt ?? now;
      return fmtMs(Math.max(0, end - (job.startedAt ?? end)));
    }

    /** One run started from the panel: what it is doing, and its conversation or page. */
    function JobRow({ t, job, env, onShowPage, onDismiss }) {
      const running = live(job);
      const color = job.state === 'failed' || job.state === 'ended' ? C.error : job.state === 'done' ? C.ok : C.label;
      const mark = running ? '●' : job.state === 'done' ? '✓' : job.state === 'failed' ? '✕' : '–';
      const what = job.kind === 'review' ? t('jobReview') : job.type && job.type !== 'auto' ? typeLabel(t, job.type) : t('type.auto');
      const where = job.dir ? baseName(job.dir) : job.focus || '';
      const status = running ? t(`act.${job.activity || 'thinking'}`) : t(`state.${job.state}`);
      return h(
        'div',
        { 'data-dsh-archify-job': job.id, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 9, background: C.layer2, border: `1px solid ${C.border1}`, fontSize: 12.5, minWidth: 0 } },
        h('span', { style: { color, flex: 'none', animation: running ? 'dsh-archify-pulse 1.4s ease-in-out infinite' : undefined } }, mark),
        h('span', { style: { fontWeight: 600, color: C.primary, flex: 'none' } }, what),
        where ? h('span', { title: job.dir || job.focus, style: { color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, where) : null,
        h('span', { style: { flex: 1 } }),
        h('span', { style: { color: C.faint, flex: 'none' } }, [status, job.steps ? t('steps', { n: job.steps }) : '', elapsed(job)].filter(Boolean).join(' · ')),
        job.state === 'failed' && job.error ? h('span', { title: job.error, style: { color: C.error, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, job.error) : null,
        job.kind !== 'review' && Array.isArray(job.pages) && job.pages.length > 0 ? h(Btn, { onClick: () => onShowPage?.(job.pages[job.pages.length - 1]), 'data-dsh-archify-job-show': job.id }, t('showPage')) : null,
        job.sessionId && env?.canOpen?.() ? h(ToolButton, { onClick: () => env.openSession(job.sessionId), title: t('openSession'), icon: h(ChatIcon) }) : null,
        running ? null : h(ToolButton, { onClick: () => onDismiss?.(job), title: t('dismiss'), icon: h(CloseIcon, { size: 14 }) }),
      );
    }

    function Jobs({ t, jobs, env, onShowPage, onDismiss, kind }) {
      const shown = (jobs ?? []).filter((j) => !kind || j.kind === kind).slice(0, 5);
      if (shown.length === 0) return null;
      return h('div', { 'data-dsh-archify-jobs': true, style: { display: 'flex', flexDirection: 'column', gap: 6 } }, shown.map((job) => h(JobRow, { key: job.id, t, job, env, onShowPage, onDismiss })));
    }

    /** A numbered step of a form. */
    function Step({ n, title, aside, children }) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { width: 20, height: 20, borderRadius: 10, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.label, background: 'color-mix(in srgb, currentColor 12%, transparent)' } }, String(n)),
          h('span', { style: { fontSize: SMALL, fontWeight: 650, color: C.primary } }, title),
          aside ? h('span', { style: { fontSize: 11.5, color: C.faint } }, aside) : null,
        ),
        h('div', { style: { paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 8 } }, children),
      );
    }

    /** What the chosen (or pointed-at) type looks like, with its live example a click away. */
    function TypePreview({ t, type, onOpen, compact }) {
      if (type === 'auto') {
        return h(
          'div',
          { 'data-dsh-archify-example': 'auto', style: { padding: 12, borderRadius: 12, background: C.layer1, border: `1px solid ${C.border1}`, display: 'flex', flexDirection: 'column', gap: 8 } },
          h(Thumb, { type: 'auto', height: compact ? 120 : 200 }),
          h('span', { style: { fontSize: SMALL, fontWeight: 640 } }, t('type.auto')),
          h('span', { style: { fontSize: 12.5, color: C.muted, lineHeight: 1.6 } }, t('use.auto')),
        );
      }
      return h(
        'div',
        { 'data-dsh-archify-example': type, style: { padding: 12, borderRadius: 12, background: C.layer1, border: `1px solid ${C.border1}`, display: 'flex', flexDirection: compact ? 'row' : 'column', gap: compact ? 14 : 10, alignItems: compact ? 'center' : 'stretch', flexWrap: 'wrap' } },
        h('div', { style: compact ? { width: 280, maxWidth: '100%' } : {} }, h(Thumb, { type, height: compact ? 160 : 230, fit: 'contain', onClick: () => onOpen(type), title: t('seeExample') })),
        h(
          'div',
          { style: { flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 6 } },
          h('span', { style: { fontSize: SMALL, fontWeight: 650 } }, t('looksLike', { type: typeLabel(t, type) })),
          h('span', { style: { fontSize: 12.5, color: C.muted, lineHeight: 1.6 } }, t(`use.${type}`)),
          h('div', { style: { marginTop: 2 } }, h(Btn, { onClick: () => onOpen(type), 'data-dsh-archify-see-example': type }, h(ExpandIcon, { size: 14 }), t('seeExample'))),
        ),
      );
    }

    /** The prompt that will be sent, as the plugin composes it. */
    function PromptPreview({ t, text: prompt, scanned, onClose, maxHeight = 260 }) {
      return h(
        'div',
        { 'data-dsh-archify-prompt-preview': true, style: { padding: '10px 12px', borderRadius: 12, background: C.layer1, border: `1px solid ${C.border1}`, display: 'flex', flexDirection: 'column', gap: 8 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: SMALL, fontWeight: 650, flex: 1 } }, t('promptTitle')),
          h(ToolButton, { onClick: () => copyText(prompt), title: t('copyPrompt'), icon: h(CopyIcon) }),
          onClose ? h(ToolButton, { onClick: onClose, title: t('close'), icon: h(CloseIcon, { size: 14 }) }) : null,
        ),
        h('pre', { 'data-dsh-archify-preview-prompt': true, style: { margin: 0, maxHeight, overflow: 'auto', fontSize: 11.5, lineHeight: 1.6, color: C.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text', fontFamily: 'inherit' } }, prompt || '…'),
        scanned ? h('span', { style: { fontSize: 11.5, color: C.faint, lineHeight: 1.5 } }, t('scanNote')) : null,
      );
    }

    /** New: a project folder or a description, a type, a focus; then one click. */
    function NewView({ t, env, jobs, onJob, onShowPage, onDismiss, seed, wide }) {
      const lang = langOf(t);
      // One form: a project folder makes it a diagram of that code; without one, of the description.
      const [dir, setDir] = useState(seed?.mode === 'describe' ? '' : seed?.dir ?? '');
      const [type, setType] = useState(seed?.type ?? 'architecture');
      const [hover, setHover] = useState('');
      const [focus, setFocus] = useState(seed?.focus ?? '');
      const [quality, setQuality] = useState('showcase');
      const [preview, setPreview] = useState('');
      const [folderError, setFolderError] = useState('');
      const [showPrompt, setShowPrompt] = useState(false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [copied, setCopied] = useState(false);
      const [example, setExample] = useState('');
      const seedKey = useRef(seed?.at ?? 0);
      // A Guide example or a gallery action fills the form.
      if (seed && seed.at !== seedKey.current) {
        seedKey.current = seed.at;
        // A described example draws that description, not the folder's code.
        if (seed.mode === 'describe') setDir('');
        if (seed.type) setType(seed.type);
        if (seed.focus !== undefined) setFocus(seed.focus);
        if (seed.dir !== undefined) setDir(seed.dir);
      }
      const folder = dir.trim();
      const fromCode = folder !== '';
      const body = { dir: folder, type, focus, quality, lang };
      const ready = fromCode ? !folderError : focus.trim() !== '';

      // The prompt as it will be sent, and whether the folder is there, follow the form as it changes.
      useEffect(() => {
        const timer = setTimeout(() => {
          void postJson(PROMPT_ROUTE, { ...body, lenient: true })
            .then((r) => {
              setPreview(r?.ok ? r.prompt : r?.reason ? `(${r.reason})` : '');
              setFolderError(r?.folderError ?? '');
            })
            .catch(() => setPreview(''));
        }, 300);
        return () => clearTimeout(timer);
      }, [dir, type, focus, quality, lang]);

      const promptNow = () => postJson(PROMPT_ROUTE, body).then((r) => (r?.ok ? r.prompt : Promise.reject(new Error(r?.reason || t('actionFailed')))));
      const generate = () => {
        if (!ready || busy) return;
        setBusy(true);
        setError('');
        void postJson(GENERATE_ROUTE, body)
          .then((r) => {
            if (r?.job) onJob?.(r.job);
            if (!r?.ok) setError(r?.reason || t('actionFailed'));
          })
          .catch(() => setError(t('actionFailed')))
          .finally(() => setBusy(false));
      };
      const openDraft = () => {
        if (!ready) return;
        setError('');
        void promptNow()
          .then((p) => env.startDraft(p, folder))
          .then((ok) => (ok === false ? setError(t('actionFailed')) : undefined))
          .catch((e) => setError(e?.message || t('actionFailed')));
      };
      const copy = () => {
        if (!ready) return;
        void promptNow()
          .then((p) => {
            copyText(p);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          })
          .catch((e) => setError(e?.message || t('actionFailed')));
      };
      const pick = () => {
        setError('');
        Promise.resolve()
          .then(() => env.pickDirectory())
          .then(
            (picked) => {
              if (typeof picked === 'string' && picked !== '') setDir(picked);
            },
            () => setError(t('pickFailed')),
          );
      };

      const recent = (env?.workspaces?.() ?? []).filter((w) => w.path).slice(0, 8);
      const examples = (EXAMPLES[lang] ?? EXAMPLES.en)[type]?.[fromCode ? 'repo' : 'desc'] ?? [];
      const canRun = env?.canRun?.() !== false;
      const shownType = hover || type;
      const mine = (jobs ?? []).filter((j) => j.kind === 'diagram');
      const latest = mine[0];

      const typeCard = (k) =>
        h(
          'button',
          {
            key: k,
            type: 'button',
            'data-dsh-archify-type': k,
            onClick: () => setType(k),
            onMouseEnter: () => setHover(k),
            onMouseLeave: () => setHover(''),
            onFocus: () => setHover(k),
            onBlur: () => setHover(''),
            title: t(`use.${k}`),
            style: { textAlign: 'left', font: 'inherit', padding: 5, borderRadius: 10, cursor: 'pointer', background: type === k ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent)' : C.layer1, border: `1px solid ${type === k ? C.label : C.border1}`, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
          },
          h(Thumb, { type: k, height: 62 }),
          h('span', { style: { fontSize: 12.5, fontWeight: 620, color: type === k ? C.label : C.primary, padding: '0 3px 1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, k === 'auto' ? t('type.auto') : typeLabel(t, k)),
        );

      const form = h(
        'div',
        { style: { flex: 1, minWidth: 0, maxWidth: wide ? 640 : 'none', display: 'flex', flexDirection: 'column', gap: 22 } },
        h(
          Step,
          { n: 1, title: t('newFrom'), aside: t('newFromHint') },
          h(
            'div',
            { style: { display: 'flex', gap: 8 } },
            h('input', { type: 'text', value: dir, placeholder: t('folderPlaceholder'), spellCheck: false, onChange: (e) => setDir(e.target.value), 'data-dsh-archify-folder': true, style: { ...fieldStyle, flex: 1, minWidth: 0, fontFamily: 'var(--dsw-font-mono, ui-monospace, monospace)', fontSize: 12 } }),
            fromCode ? h(Btn, { onClick: () => setDir(''), 'data-dsh-archify-folder-clear': true, title: t('clearFolderHint') }, t('clearFolder')) : null,
            env?.canPickDirectory?.() ? h(Btn, { onClick: pick, 'data-dsh-archify-pick': true }, h(FolderIcon, { size: 14 }), t('pickFolder')) : null,
          ),
          folder && folderError ? h('span', { 'data-dsh-archify-folder-error': true, style: { fontSize: 12, color: C.error } }, t('folderMissing')) : null,
          recent.length > 0
            ? h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
                h('span', { style: { fontSize: 11.5, color: C.faint } }, t('recentFolders')),
                recent.map((w) => h(Chip, { key: w.path, on: dir === w.path, title: w.path, onClick: () => setDir(dir === w.path ? '' : w.path) }, w.title || baseName(w.path))),
              )
            : null,
        ),
        h(
          Step,
          { n: 2, title: t('newType'), aside: wide ? t('typeHint') : null },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 8 } }, PICKABLE.map(typeCard)),
          // Narrow: the preview comes right under the cards, where the click was.
          wide ? null : h(TypePreview, { t, type: shownType, onOpen: setExample, compact: true }),
        ),
        h(
          Step,
          { n: 3, title: t('newWhatToDraw'), aside: fromCode ? t('optional') : t('required') },
          h('textarea', { value: focus, rows: fromCode ? 2 : 4, placeholder: examples[0] ?? '', onChange: (e) => setFocus(e.target.value), 'data-dsh-archify-focus': true, style: { ...fieldStyle, width: '100%', resize: 'vertical', lineHeight: 1.55 } }),
          h(
            'div',
            { 'data-dsh-archify-run-kind': fromCode ? 'code' : 'describe', style: { display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, lineHeight: 1.55, color: C.muted, padding: '7px 10px', borderRadius: 8, background: C.layer2 } },
            h('span', { style: { flex: 'none', color: C.label } }, fromCode ? h(FolderIcon, { size: 14 }) : h(ChatIcon, { size: 14 })),
            h('span', null, fromCode ? t('runFromCode', { name: baseName(folder) }) : t('runFromText')),
          ),
          type === 'explainer'
            ? h(
                'div',
                { 'data-dsh-archify-rules-hint': true, style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: C.muted, lineHeight: 1.55 } },
                h('span', null, t('helpRules')),
                h('code', { style: { fontSize: 11.5, padding: '1px 6px', borderRadius: 5, background: C.layer2, color: C.primary } }, '[archify explainer: proactive]'),
                h(Btn, { onClick: () => copyText('[archify explainer: proactive]') }, t('copyLine')),
              )
            : null,
          examples.length > 0
            ? h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
                h('span', { style: { fontSize: 11.5, color: C.faint } }, t('examples')),
                examples.map((ex) => h(Chip, { key: ex, on: focus === ex, title: ex, onClick: () => setFocus(ex) }, ex.length > 40 ? `${ex.slice(0, 39)}…` : ex)),
              )
            : null,
        ),
        h(
          Step,
          { n: 4, title: t('newQuality') },
          h(
            'div',
            { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
            h(Chip, { on: quality === 'showcase', onClick: () => setQuality('showcase') }, t('qualityShowcase')),
            h(Chip, { on: quality === 'standard', onClick: () => setQuality('standard') }, t('qualityStandard')),
            h('span', { style: { fontSize: 11.5, color: C.faint } }, quality === 'standard' ? t('qualityStandardHint') : t('qualityShowcaseHint')),
          ),
        ),
      );

      // Wide: what the form will do stays in view beside it.
      const side = wide
        ? h(
            'div',
            { 'data-dsh-archify-side': true, style: { width: 380, flex: 'none', position: 'sticky', top: 0, display: 'flex', flexDirection: 'column', gap: 12 } },
            h(TypePreview, { t, type: shownType, onOpen: setExample }),
            showPrompt ? h(PromptPreview, { t, text: preview, scanned: fromCode, onClose: () => setShowPrompt(false) }) : null,
            mine.length > 0 ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, h('span', { style: { fontSize: 11.5, color: C.faint, fontWeight: 600 } }, t('runs')), h(Jobs, { t, jobs: mine, env, onShowPage, onDismiss })) : null,
          )
        : null;

      const hint = error
        ? h('span', { style: { fontSize: 12, color: C.error } }, error)
        : !ready
          ? h('span', { style: { fontSize: 12, color: fromCode && folderError ? C.error : C.faint } }, fromCode && folderError ? t('folderMissing') : t('needSomething'))
          : null;
      const footer = h(
        'div',
        { 'data-dsh-archify-actions': true, style: { flex: 'none', borderTop: `1px solid ${C.border1}`, background: C.base, padding: '10px 22px 12px', display: 'flex', flexDirection: 'column', gap: 8 } },
        // Narrow: the prompt and the latest run show here, above the buttons, where they are seen.
        !wide && showPrompt ? h(PromptPreview, { t, text: preview, scanned: fromCode, onClose: () => setShowPrompt(false), maxHeight: 160 }) : null,
        !wide && latest ? h(JobRow, { t, job: latest, env, onShowPage, onDismiss }) : null,
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h(Btn, { kind: 'primary', onClick: generate, disabled: !ready || busy || !canRun, 'data-dsh-archify-generate': true, title: canRun ? t('generateHint') : t('cannotRun') }, h(ArchifyGlyph, { size: 14 }), busy ? t('starting') : t('generate')),
          env?.canDraft?.() ? h(Btn, { onClick: openDraft, disabled: !ready, 'data-dsh-archify-draft': true, title: t('openInChatHint') }, h(ChatIcon, { size: 14 }), t('openInChat')) : null,
          h(Btn, { onClick: copy, disabled: !ready }, h(CopyIcon, { size: 14 }), copied ? t('copied') : t('copyPrompt')),
          hint,
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', 'data-dsh-archify-prompt-toggle': true, onClick: () => setShowPrompt((v) => !v), style: { font: 'inherit', fontSize: 12, color: showPrompt ? C.primary : C.faint, background: 'none', border: 'none', cursor: 'pointer', padding: 0 } }, showPrompt ? t('hidePrompt') : t('showPrompt')),
        ),
      );

      return h(
        'div',
        { 'data-dsh-archify-new': true, style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } }, h('div', { style: { display: 'flex', gap: 28, padding: '20px 22px 28px', alignItems: 'flex-start' } }, form, side)),
        footer,
        example ? h(FullScreen, { t, item: exampleItem(t, example), onClose: () => setExample('') }) : null,
      );
    }

    const LEVEL_COLOR = { risk: C.error, warn: 'var(--dsw-alias-state-warning-primary, #d08a1c)', info: C.faint, good: C.ok };

    /** One citation: the file and lines a point rests on, opening to the code itself. */
    function Citation({ t, e }) {
      const [open, setOpen] = useState(false);
      if (e.component) {
        return h('span', { 'data-dsh-archify-cite': e.component, style: { fontSize: 11.5, color: C.muted } }, h('code', { style: { fontSize: 11.5, padding: '1px 6px', borderRadius: 5, background: C.layer2 } }, e.component), e.note ? ` ${e.note}` : '');
      }
      const where = `${e.path}:${e.line}${e.end_line && e.end_line !== e.line ? `–${e.end_line}` : ''}`;
      return h(
        'div',
        { 'data-dsh-archify-cite': where, style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(
          'button',
          { type: 'button', onClick: () => setOpen((v) => !v), title: t('citeHint'), style: { font: 'inherit', alignSelf: 'flex-start', display: 'inline-flex', gap: 6, alignItems: 'baseline', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.muted, fontSize: 11.5 } },
          h('code', { style: { fontSize: 11.5, padding: '1px 6px', borderRadius: 5, background: C.layer2, color: C.label, wordBreak: 'break-all' } }, `${open ? '▾' : '▸'} ${where}`),
          e.note ? h('span', null, e.note) : null,
        ),
        open ? h('pre', { style: { margin: 0, padding: '8px 10px', borderRadius: 8, background: C.layer2, color: C.primary, fontSize: 11, lineHeight: 1.55, overflowX: 'auto', whiteSpace: 'pre', userSelect: 'text' } }, `${e.excerpt}${e.more ? '\n…' : ''}`) : null,
      );
    }

    /**
     * Review: the architecture review the model wrote from the code, every point checked
     * against its citations, or, before there is one, what one will rest on.
     */
    function ReviewBox({ t, item, env, jobs, onJob, data }) {
      const [asking, setAsking] = useState(false);
      const [error, setError] = useState('');
      const job = (jobs ?? []).find((j) => j.kind === 'review' && j.pageId === item.id);
      const ask = () => {
        setAsking(true);
        setError('');
        void postJson(ASK_ROUTE, { id: item.id, lang: langOf(t) })
          .then((r) => {
            if (r?.job) onJob?.(r.job);
            if (!r?.ok) setError(r?.reason || t('actionFailed'));
          })
          .catch(() => setError(t('actionFailed')))
          .finally(() => setAsking(false));
      };
      const review = data?.review ?? null;
      const running = job && live(job);
      const basisLine = (basis, repo, revision) => (basis === 'code' ? t('reviewBasisCode', { repo: repo || '', rev: revision ? revision.slice(0, 7) : '' }) : t('reviewBasisDesign'));
      const action = running
        ? h('span', { style: { fontSize: 12, color: C.faint } }, `${t(`act.${job.activity || 'thinking'}`)} · ${elapsed(job)}`)
        : h(Btn, { kind: review ? 'plain' : 'primary', onClick: ask, disabled: asking || env?.canRun?.() === false, 'data-dsh-archify-ask': item.id, title: t('askReviewHint') }, h(ChatIcon, { size: 14 }), review ? t('askAgain') : t('askReview'));
      let body;
      if (data === null) body = h('div', { style: { fontSize: 12, color: C.faint } }, '…');
      else if (!data.supported) body = h('div', { style: { fontSize: 12, color: C.faint } }, t('reviewUnavailable'));
      else if (!review)
        body = h(
          'div',
          { 'data-dsh-archify-review-empty': data.basis, style: { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: C.muted, lineHeight: 1.65 } },
          h('span', null, data.basis === 'code' ? t('reviewHowCode', { repo: data.repo }) : t('reviewHowDesign')),
        );
      else
        body = h(
          'div',
          { 'data-dsh-archify-review-done': review.basis, style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h('div', { style: { fontSize: 13, color: C.primary, lineHeight: 1.65, fontWeight: 560 } }, review.verdict),
          h('div', { style: { fontSize: 11.5, color: C.faint, lineHeight: 1.6 } }, [review.software, basisLine(review.basis, review.repo, review.revision), review.at ? fmtWhen(t, review.at) : ''].filter(Boolean).join(' · ')),
          h(
            'ol',
            { style: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 } },
            review.findings.map((f, i) =>
              h(
                'li',
                { key: i, 'data-dsh-archify-finding': f.level, style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, background: C.layer1, border: `1px solid ${C.border1}` } },
                h(
                  'div',
                  { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
                  h('span', { style: { flex: 'none', fontSize: 11, fontWeight: 700, color: LEVEL_COLOR[f.level] ?? C.faint } }, t(`level.${f.level}`)),
                  h('span', { style: { fontSize: 13, fontWeight: 620, color: C.primary, lineHeight: 1.5 } }, f.title),
                ),
                h('div', { style: { fontSize: 12.5, color: C.muted, lineHeight: 1.65, userSelect: 'text', whiteSpace: 'pre-line' } }, f.detail),
                f.suggestion ? h('div', { style: { fontSize: 12.5, color: C.primary, lineHeight: 1.65, userSelect: 'text', whiteSpace: 'pre-line' } }, h('span', { style: { fontWeight: 620 } }, `${t('suggestion')}　`), f.suggestion) : null,
                f.evidence.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, f.evidence.map((e, j) => h(Citation, { key: j, t, e }))) : null,
              ),
            ),
          ),
        );
      return h(
        'div',
        { 'data-dsh-archify-review': item.id, style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, action, job?.sessionId && env?.canOpen?.() ? h(Btn, { onClick: () => env.openSession(job.sessionId) }, t(running ? 'watchReview' : 'readReview')) : null),
        error ? h('div', { style: { fontSize: 12, color: C.error } }, error) : null,
        body,
        h('div', { style: { fontSize: 11.5, color: C.faint, lineHeight: 1.6 } }, t('reviewNote')),
      );
    }

    /** Change a drawn diagram: said here, done by the conversation that drew it, which knows its context. */
    function EditBox({ t, item, env, jobs, onJob, onShowPage, onDismiss }) {
      const [text, setText] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const job = (jobs ?? []).find((j) => j.kind === 'edit' && j.pageId === item.id);
      const running = job && live(job);
      const send = () => {
        if (!text.trim() || busy || running) return;
        setBusy(true);
        setError('');
        void postJson(EDIT_ROUTE, { id: item.id, text, lang: langOf(t) })
          .then((r) => {
            if (r?.job) onJob?.(r.job);
            if (r?.ok) setText('');
            else setError(r?.reason || t('actionFailed'));
          })
          .catch(() => setError(t('actionFailed')))
          .finally(() => setBusy(false));
      };
      return h(
        'div',
        { 'data-dsh-archify-edit': item.id, style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { style: { fontSize: 12.5, color: C.muted, lineHeight: 1.6 } }, t('editHow')),
        h('textarea', { value: text, rows: 4, placeholder: t('editPlaceholder'), onChange: (e) => setText(e.target.value), 'data-dsh-archify-edit-text': true, style: { ...fieldStyle, width: '100%', resize: 'vertical', lineHeight: 1.55 } }),
        h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          editSuggestions(langOf(t), item.type).map((c) => h(Chip, { key: c, on: text === c, title: c, onClick: () => setText(c), 'data-dsh-archify-edit-chip': true }, c)),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h(Btn, { kind: 'primary', onClick: send, disabled: !text.trim() || busy || running || env?.canRun?.() === false, 'data-dsh-archify-edit-send': item.id }, h(ChatIcon, { size: 14 }), t('editSend')),
          error ? h('span', { style: { fontSize: 12, color: C.error } }, error) : null,
        ),
        job ? h(JobRow, { t, job, env, onShowPage, onDismiss }) : null,
        h('div', { style: { fontSize: 11.5, color: C.faint, lineHeight: 1.6 } }, t('editNote')),
      );
    }

    /** Beside a drawing: changing it, and (for an architecture) its review; docked on a wide pane, over the drawing on a narrow one. */
    function SidePanel({ t, item, mode, onMode, onClose, docked, children }) {
      const tabs = [['edit', t('editTitle')], ...(item.type === 'architecture' ? [['review', t('reviewTitle')]] : [])];
      return h(
        'div',
        {
          'data-dsh-archify-side-panel': mode,
          style: docked
            ? { width: 360, flex: 'none', position: 'sticky', top: 0, maxHeight: 'calc(100vh - 150px)', display: 'flex', flexDirection: 'column', border: `1px solid ${C.border1}`, borderRadius: 12, background: C.base, overflow: 'hidden' }
            : { height: '100%', display: 'flex', flexDirection: 'column', background: C.base },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '8px 8px 8px 12px', borderBottom: `1px solid ${C.border1}`, flex: 'none' } },
          tabs.map(([key, label]) =>
            h('button', { key, type: 'button', 'data-dsh-archify-side-tab': key, onClick: () => onMode(key), style: { font: 'inherit', fontSize: SMALL, fontWeight: mode === key ? 650 : 500, color: mode === key ? C.primary : C.muted, background: mode === key ? C.hover : 'none', border: 'none', borderRadius: 7, padding: '5px 10px', cursor: 'pointer' } }, label),
          ),
          h('span', { style: { flex: 1 } }),
          h(ToolButton, { onClick: onClose, title: t('close'), icon: h(CloseIcon, { size: 14 }), 'data-dsh-archify-side-close': true }),
        ),
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 14px 18px' } }, children),
      );
    }

    /**
     * The "?" card: what can be done and where, each item a step away. It replaces a page of
     * prompts to copy, which mostly needed a diagram or an answer that a new conversation lacks.
     */
    function QuickHelp({ t, onGo, onClose }) {
      const [copied, setCopied] = useState(false);
      useEffect(() => {
        const onKey = (e) => {
          if (e.key === 'Escape') onClose();
        };
        try {
          window.addEventListener('keydown', onKey);
        } catch {
          return undefined;
        }
        return () => window.removeEventListener('keydown', onKey);
      }, []);
      const group = (title, rows) =>
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { fontSize: 11.5, fontWeight: 650, color: C.faint, letterSpacing: 0.3 } }, title),
          rows.map(([key, body, action]) =>
            h(
              'div',
              { key, 'data-dsh-archify-help': key, style: { display: 'flex', alignItems: 'flex-start', gap: 10 } },
              h('div', { style: { flex: 1, minWidth: 0, fontSize: 12.5, color: C.muted, lineHeight: 1.6 } }, body),
              action ?? null,
            ),
          ),
        );
      const go = (label, target, extra) => h(Btn, { onClick: () => onGo(target, extra), 'data-dsh-archify-help-go': target + (extra?.side ? `:${extra.side}` : extra?.type ? `:${extra.type}` : '') }, label);
      const rules = '[archify explainer: proactive]';
      return h(
        'div',
        { 'data-dsh-archify-quick-help': true, role: 'dialog', 'aria-label': t('helpTitle'), style: { position: 'absolute', top: 50, right: 16, width: 420, maxWidth: 'calc(100% - 32px)', maxHeight: 'calc(100% - 70px)', overflowY: 'auto', zIndex: 30, background: C.base, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: '0 14px 40px rgba(0,0,0,.16)', padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 16 } },
        h('div', { style: { display: 'flex', alignItems: 'center' } }, h('span', { style: { fontSize: 14, fontWeight: 660, flex: 1 } }, t('helpTitle')), h(ToolButton, { onClick: onClose, title: t('close'), icon: h(CloseIcon, { size: 14 }) })),
        group(t('helpStart'), [
          ['new', t('helpNew'), go(t('goNew'), 'new')],
          ['chat', t('helpChat'), null],
          ['mermaid', t('helpMermaid'), go(t('goNew'), 'new', { mode: 'describe', type: 'auto' })],
        ]),
        group(t('helpDrawn'), [
          ['edit', t('helpEdit'), go(t('goGallery'), 'gallery', { side: 'edit' })],
          ['review', t('helpReview'), go(t('goGallery'), 'gallery', { side: 'review' })],
          ['view', t('helpView'), null],
        ]),
        group(t('helpExplainer'), [
          ['explainer', t('helpExplainerHow'), go(t('goNew'), 'new', { mode: 'describe', type: 'explainer' })],
          [
            'rules',
            h('span', null, t('helpRules'), ' ', h('code', { style: { fontSize: 11.5, padding: '1px 6px', borderRadius: 5, background: C.layer2, color: C.primary } }, rules)),
            h(Btn, { onClick: () => { copyText(rules); setCopied(true); setTimeout(() => setCopied(false), 1400); }, 'data-dsh-archify-help-copy': true }, copied ? t('copied') : t('copyLine')),
          ],
        ]),
      );
    }

    /** A request from outside the panel (a card's Review button) to show one page. */
    const panelRequests = { pending: null, listeners: new Set() };
    function requestPage(id, { review = false } = {}) {
      panelRequests.pending = { id, review };
      for (const fn of panelRequests.listeners) fn(panelRequests.pending);
    }

    function ArchifyPanel(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT;
      const env = props.env ?? {};
      const [items, setItems] = useState(null);
      const [total, setTotal] = useState(0);
      const [hasMore, setHasMore] = useState(false);
      const [failed, setFailed] = useState(false);
      const [selected, setSelected] = useState('');
      const [full, setFull] = useState(false);
      const [query, setQuery] = useState('');
      const [tab, setTab] = useState('');
      const [jobs, setJobs] = useState([]);
      const [seed, setSeed] = useState(null);
      // Beside the drawing: '' (closed), 'edit' or 'review'; and the "?" card.
      const [side, setSide] = useState('');
      const [help, setHelp] = useState(false);
      const [, setTick] = useState(0);
      const alive = useRef(true);
      const itemsRef = useRef(items);
      itemsRef.current = items;
      const jobsRef = useRef(jobs);
      jobsRef.current = jobs;
      const pane = useRef(null);
      const [paneW, setPaneW] = useState(0);
      const root = useRef(null);
      const [rootW, setRootW] = useState(0);
      useEffect(() => {
        const el = root.current;
        if (!el) return undefined;
        setRootW(el.clientWidth);
        if (typeof ResizeObserver !== 'function') return undefined;
        const ro = new ResizeObserver(() => setRootW(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
      }, []);
      const wide = rootW >= 920;

      const refresh = () =>
        getJson(`${LIST_ROUTE}?limit=${PAGE}`)
          .then((body) => {
            if (!alive.current) return;
            if (body === null || !Array.isArray(body.items)) {
              if (itemsRef.current === null) setFailed(true);
              return;
            }
            setFailed(false);
            setTotal(body.total ?? body.items.length);
            const known = itemsRef.current;
            if (known === null) {
              setItems(body.items);
              setHasMore(body.hasMore === true);
              return;
            }
            const fresh = new Map(body.items.map((i) => [i.id, i]));
            const rest = known.slice(PAGE).filter((i) => !fresh.has(i.id));
            const next = [...body.items, ...rest];
            const same = next.length === known.length && next.every((i, at) => i.id === known[at].id && i.version === known[at].version && i.missing === known[at].missing && i.reviewedAt === known[at].reviewedAt);
            if (!same) setItems(next);
          })
          .catch(() => alive.current && itemsRef.current === null && setFailed(true));

      const refreshJobs = () =>
        getJson(JOBS_ROUTE)
          .then((body) => {
            if (!alive.current || !Array.isArray(body?.jobs)) return;
            const before = jobsRef.current;
            setJobs(body.jobs);
            // A run that just delivered: its page joins the gallery now, not at the next poll.
            if (body.jobs.some((j) => j.pages?.length && !before.find((b) => b.id === j.id && b.pages?.length === j.pages.length))) void refresh();
          })
          .catch(() => {});

      const loadMore = () => {
        const known = itemsRef.current;
        if (!hasMore || !known || known.length === 0) return;
        getJson(`${LIST_ROUTE}?limit=${PAGE}&before=${encodeURIComponent(known[known.length - 1].id)}`)
          .then((body) => {
            if (!alive.current || body === null || !Array.isArray(body.items)) return;
            const have = new Set((itemsRef.current ?? []).map((i) => i.id));
            setItems([...(itemsRef.current ?? []), ...body.items.filter((i) => !have.has(i.id))]);
            setHasMore(body.hasMore === true);
          })
          .catch(() => {});
      };

      const showPage = (id) => {
        setTab('gallery');
        setQuery('');
        setSelected(id);
        if (!(itemsRef.current ?? []).some((i) => i.id === id)) void refresh();
      };

      useEffect(() => {
        alive.current = true;
        refresh();
        refreshJobs();
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden) return;
          refresh();
        }, POLL_MS);
        // Runs move fast: their status every two seconds while one is live, and the clock with it.
        const jobTimer = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden) return;
          if (jobsRef.current.some(live)) {
            refreshJobs();
            setTick((n) => n + 1);
          }
        }, 2000);
        const onRequest = (req) => {
          showPage(req.id);
          if (req.review) setSide('review');
          panelRequests.pending = null;
        };
        panelRequests.listeners.add(onRequest);
        if (panelRequests.pending) onRequest(panelRequests.pending);
        return () => {
          alive.current = false;
          clearInterval(timer);
          clearInterval(jobTimer);
          panelRequests.listeners.delete(onRequest);
        };
      }, []);

      useEffect(() => {
        const el = pane.current;
        if (!el) return undefined;
        setPaneW(el.clientWidth);
        if (typeof ResizeObserver !== 'function') return undefined;
        const ro = new ResizeObserver(() => setPaneW(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
      }, [items === null, tab]);

      // The first view: the gallery when there is something in it, else New.
      const view = tab || (items !== null && items.length === 0 ? 'new' : 'gallery');

      const q = query.trim().toLowerCase();
      const shown = (items ?? []).filter((i) => !q || `${i.title} ${i.type} ${typeLabel(t, i.type)} ${i.path}`.toLowerCase().includes(q));
      const current = shown.find((i) => i.id === selected) ?? shown[0];

      const sessions = props.sessions;
      const openSession =
        current && current.sessionId && sessions?.available?.() && sessions.state(current.sessionId).state !== 'gone'
          ? () => {
              setFull(false);
              sessions.open(current.sessionId);
            }
          : undefined;

      const [review, setReview] = useState(null);
      const reviewKey = current && current.type === 'architecture' && !current.missing ? `${current.id}:${current.version}:${current.reviewedAt ?? 0}` : '';
      useEffect(() => {
        let alive = true;
        setReview(null);
        if (!reviewKey) return undefined;
        const id = reviewKey.split(':')[0];
        void getJson(`${REVIEW_ROUTE}?id=${encodeURIComponent(id)}`)
          .then((r) => alive && setReview({ key: reviewKey, ...(r ?? { supported: false, findings: [] }) }))
          .catch(() => alive && setReview({ key: reviewKey, supported: false, findings: [] }));
        return () => {
          alive = false;
        };
      }, [reviewKey]);
      const reviewData = review && review.key === reviewKey ? review : null;
      const concerns = (reviewData?.review?.findings ?? []).filter((f) => f.level !== 'good').length;

      const remove = (item) => {
        setItems((list) => (list ?? []).filter((i) => i.id !== item.id));
        setTotal((n) => Math.max(0, n - 1));
        void postJson(DELETE_ROUTE, { id: item.id }).catch(() => {});
      };
      const addJob = (job) => {
        setJobs((list) => [job, ...(list ?? []).filter((j) => j.id !== job.id)]);
        setTimeout(refreshJobs, 800);
      };
      const dismissJob = (job) => {
        setJobs((list) => (list ?? []).filter((j) => j.id !== job.id));
        void postJson(DISMISS_ROUTE, { id: job.id }).catch(() => {});
      };
      const use = (fill) => {
        setSeed({ ...fill, at: Date.now() });
        setTab('new');
      };
      // From the "?" card to where a thing is done.
      const go = (target, extra) => {
        setHelp(false);
        if (target === 'new') {
          if (extra) use(extra);
          else setTab('new');
          return;
        }
        setTab('gallery');
        setQuery('');
        if (extra?.side === 'review') {
          const arch = (itemsRef.current ?? []).find((i) => i.type === 'architecture' && !i.missing);
          if (arch) setSelected(arch.id);
        }
        if (extra?.side) setSide(extra.side);
      };

      const tabButton = (key, label) =>
        h(
          'button',
          {
            type: 'button',
            key,
            'data-dsh-archify-tab': key,
            onClick: () => setTab(key),
            style: { font: 'inherit', fontSize: SMALL, fontWeight: view === key ? 640 : 500, color: view === key ? C.primary : C.muted, background: view === key ? C.hover : 'transparent', border: 'none', borderRadius: 7, padding: '5px 10px', cursor: 'pointer' },
          },
          label,
        );

      const header = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px 10px', borderBottom: `1px solid ${C.border1}`, flex: 'none', flexWrap: 'wrap' } },
        h(ArchifyGlyph, { size: 18, active: true }),
        h('span', { style: { fontSize: 15.5, fontWeight: 640, color: C.primary, marginRight: 6 } }, t('title')),
        tabButton('new', t('tabNew')),
        tabButton('gallery', total > 0 ? `${t('tabGallery')} ${total}` : t('tabGallery')),
        h('span', { style: { flex: 1 } }),
        view === 'gallery' && items && items.length > 0
          ? h('input', {
              type: 'search',
              value: query,
              placeholder: t('search'),
              onChange: (e) => setQuery(e.target.value),
              style: { ...fieldStyle, padding: '5px 10px', width: 200 },
            })
          : null,
        h(
          'button',
          { type: 'button', 'data-dsh-archify-help-open': true, title: t('helpTitle'), 'aria-label': t('helpTitle'), onClick: () => setHelp((v) => !v), style: { width: 28, height: 28, borderRadius: 14, font: 'inherit', fontSize: 13, fontWeight: 650, color: help ? C.primary : C.muted, background: help ? C.hover : 'transparent', border: `1px solid ${C.border1}`, cursor: 'pointer' } },
          '?',
        ),
      );

      let body;
      if (view === 'new') {
        body = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, h(NewView, { t, env, jobs, onJob: addJob, onShowPage: showPage, onDismiss: dismissJob, seed, wide }));
      } else if (failed) body = h('div', { style: { padding: 24, color: C.faint } }, t('unavailable'));
      else if (items === null) body = h('div', { style: { padding: 24, color: C.faint } }, '…');
      else if (items.length === 0)
        body = h(
          'div',
          { style: { padding: '48px 24px', color: C.muted, maxWidth: 560, lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 14 } },
          h('div', { style: { fontSize: 14, fontWeight: 650, color: C.primary } }, t('emptyTitle')),
          h(
            'div',
            { 'data-dsh-archify-empty-ways': true, style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            [
              ['new', t('emptyNew'), h(Btn, { kind: 'primary', onClick: () => setTab('new') }, t('goNew'))],
              ['chat', t('emptyChat'), null],
              ['mermaid', t('emptyMermaid'), h(Btn, { onClick: () => use({ mode: 'describe', type: 'auto' }) }, t('goNew'))],
            ].map(([key, words, action]) => h('div', { key, style: { display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: C.layer1, border: `1px solid ${C.border1}` } }, h('span', { style: { flex: 1, fontSize: 12.5, lineHeight: 1.6 } }, words), action)),
          ),
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 } },
            ['architecture', 'sequence', 'workflow', 'erd', 'dataflow', 'timeline'].map((k) =>
              h('div', { key: k, style: { display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }, onClick: () => setTab('new') }, h(Thumb, { type: k, height: 84 }), h('span', { style: { fontSize: 11.5, color: C.faint } }, typeLabel(t, k))),
            ),
          ),
          h(Jobs, { t, jobs, env, onShowPage: showPage, onDismiss: dismissJob }),
        );
      else {
        const list = h(
          'div',
          {
            'data-dsh-archify-list': true,
            onScroll: (e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) loadMore();
            },
            style: { width: wide ? 300 : 240, flex: 'none', overflowY: 'auto', borderRight: `1px solid ${C.border1}`, padding: '8px 8px 40px' },
          },
          shown.map((item) => {
            const on = current && item.id === current.id;
            return h(
              'div',
              {
                key: item.id,
                role: 'button',
                tabIndex: 0,
                'data-dsh-archify-item': item.id,
                onClick: () => setSelected(item.id),
                onDoubleClick: () => {
                  setSelected(item.id);
                  setFull(true);
                },
                onKeyDown: (e) => {
                  if (e.key === 'Enter') setSelected(item.id);
                },
                style: { padding: '9px 10px', borderRadius: 9, cursor: 'pointer', background: on ? C.hover : 'transparent', display: 'flex', flexDirection: 'column', gap: 4, opacity: item.missing ? 0.55 : 1 },
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
                h(TypeChip, { t, type: item.type }),
                h('span', { style: { fontSize: SMALL, fontWeight: 600, color: C.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, item.title),
              ),
              h(
                'div',
                { style: { fontSize: 11.5, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: item.path },
                [fmtWhen(t, item.updatedAt ?? item.createdAt), item.missing ? t('missing') : item.folder?.split(/[\\/]/).slice(-3, -2)[0]].filter(Boolean).join(' · '),
              ),
            );
          }),
        );
        // What the side panel shows: a review only for an architecture.
        const sideMode = current && side === 'review' && current.type !== 'architecture' ? 'edit' : side;
        const sidePanel = (docked) =>
          h(
            SidePanel,
            { t, item: current, mode: sideMode, onMode: setSide, onClose: () => setSide(''), docked },
            sideMode === 'review' ? h(ReviewBox, { t, item: current, env, jobs, onJob: addJob, data: reviewData }) : h(EditBox, { t, item: current, env, jobs, onJob: addJob, onShowPage: showPage, onDismiss: dismissJob }),
          );
        const preview = current
          ? h(
              'div',
              { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 8px 16px', borderBottom: `1px solid ${C.border1}`, minWidth: 0 } },
                h('span', { title: current.path, style: { fontSize: SMALL, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 } }, current.title),
                openSession ? h(ToolButton, { onClick: openSession, title: t('openSession'), icon: h(ChatIcon) }) : null,
                current.missing ? null : h(Btn, { kind: side === 'edit' ? 'primary' : 'plain', onClick: () => setSide((v) => (v === 'edit' ? '' : 'edit')), 'data-dsh-archify-to-edit': current.id, title: t('editOpenHint') }, h(EditIcon, { size: 14 }), t('editTitle')),
                reviewKey
                  ? h(Btn, { kind: side === 'review' ? 'primary' : 'plain', onClick: () => setSide((v) => (v === 'review' ? '' : 'review')), 'data-dsh-archify-to-review': current.id, title: t('reviewOpenHint') }, h(ReviewIcon, { size: 14 }), reviewData?.review ? t('reviewCount', { n: concerns }) : t('reviewTitle'))
                  : null,
                current.missing ? null : h(PageActions, { t, item: current, onExpand: () => setFull(true), compact: paneW < 620 }),
                h(ToolButton, { onClick: () => remove(current), title: t('remove'), icon: h(TrashIcon) }),
              ),
              h(
                'div',
                { ref: pane, style: { flex: 1, minHeight: 0, overflow: 'auto', padding: 16 } },
                jobs.some(live) ? h('div', { style: { marginBottom: 12 } }, h(Jobs, { t, jobs: jobs.filter(live), env, onShowPage: showPage, onDismiss: dismissJob })) : null,
                (() => {
                  const besides = Boolean(sideMode) && !current.missing && paneW >= 1100;
                  const drawing = h(
                    'div',
                    { style: { flex: 1, minWidth: 0 } },
                    current.missing
                      ? h('div', { style: { color: C.faint, padding: 12 } }, t('missingLong', { path: current.path }))
                      : h('div', { style: { border: `1px solid ${C.border1}`, borderRadius: 12, overflow: 'hidden', background: C.layer1 } }, h(FittedFrame, { item: current, width: paneW - 34 - (besides ? 356 : 0), title: current.title })),
                    h('div', { style: { marginTop: 8, fontSize: 11.5, color: C.faint, wordBreak: 'break-all', userSelect: 'text' } }, current.path),
                  );
                  if (besides) return h('div', { style: { display: 'flex', gap: 16, alignItems: 'flex-start' } }, drawing, sidePanel(true));
                  return drawing;
                })(),
              ),
              // A narrower pane: the side panel slides over the right of the drawing.
              sideMode && !current.missing && !(paneW >= 1100)
                ? h('div', { 'data-dsh-archify-side-sheet': current.id, style: { position: 'absolute', top: 45, right: 0, bottom: 0, width: Math.min(420, Math.max(300, Math.round(paneW * 0.5))), borderLeft: `1px solid ${C.border1}`, boxShadow: '-12px 0 28px rgba(0,0,0,.10)', zIndex: 5 } }, sidePanel(false))
                : null,
            )
          : h('div', { style: { flex: 1, padding: 24, color: C.faint } }, t('noMatch'));
        body = h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } }, list, preview);
      }

      return h(
        'div',
        { ref: root, 'data-dsh-archify-panel': true, 'data-dsh-archify-view': view, 'data-dsh-archify-wide': wide ? 'yes' : 'no', style: { position: 'relative', height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: C.base, color: C.primary, fontSize: FONT, boxSizing: 'border-box' } },
        h('style', null, '@keyframes dsh-archify-pulse{0%,100%{opacity:1}50%{opacity:.35}}'),
        header,
        body,
        full && current ? h(FullScreen, { t, item: current, onClose: () => setFull(false), onOpenSession: openSession }) : null,
        help ? h(QuickHelp, { t, onGo: go, onClose: () => setHelp(false) }) : null,
      );
    }

    // --- words -------------------------------------------------------------------------

    const DICTIONARY = {
      en: {
        title: 'Archify',
        count: '{n} pages',
        search: 'Search',
        toolTitle: 'Archify',
        writing: 'writing the diagram…',
        rendering: 'rendering and checking…',
        rerun: 'after a repair',
        running: 'running…',
        delivered: 'delivered',
        failed: 'The render failed.',
        stoppedAt: 'stopped at {stage}',
        diagnostics: '{n} diagnostics',
        modelRepairs: 'The model repairs the candidate and renders it again.',
        browserSkipped: 'No Chrome, Chromium or Edge installed: the real-browser check was skipped.',
        'gate.validate': 'validate',
        'gate.deliver': 'deliver',
        'gate.check': 'check',
        'gate.browser-check': 'browser',
        'gate.prepare': 'prepare',
        fullScreen: 'Full screen (double-click the drawing)',
        fullScreenShort: 'Full screen',
        openBrowser: 'Open in your default browser',
        openBrowserShort: 'Browser',
        newTab: 'Open in a new tab',
        download: 'Download the HTML',
        reveal: 'Show in folder',
        copyPath: 'Copy the path',
        copied: 'Copied',
        close: 'Close (Esc)',
        openSession: 'Open the conversation it was drawn in',
        openSessionShort: 'Conversation',
        remove: 'Remove from this list (the file stays)',
        missing: 'file gone',
        missingLong: 'This page is no longer at {path}.',
        noMatch: 'Nothing matches.',
        unavailable: 'Cannot reach the Archify list. Refresh the page, or check the plugin is enabled.',
        justNow: 'just now',
        minutesAgo: '{n} min ago',
        hoursAgo: '{n} h ago',
        daysAgo: '{n} d ago',
        'type.architecture': 'Architecture',
        'type.workflow': 'Workflow',
        'type.sequence': 'Sequence',
        'type.dataflow': 'Data flow',
        'type.lifecycle': 'Lifecycle',
        'type.erd': 'ERD',
        'type.tree': 'Tree',
        'type.class': 'Class',
        'type.timeline': 'Timeline',
        'type.waterfall': 'Waterfall',
        'type.explainer': 'Explainer',
        'type.compare': 'Before and after',
        "lang": "en",
        "tabNew": "New",
        "tabGallery": "Gallery",


        "folderPlaceholder": "Project folder, e.g. /Users/me/code/shop",
        "pickFolder": "Choose…",
        "pickFailed": "The folder dialog could not open; type the path instead.",
        "recentFolders": "Recent:",
        "newType": "Diagram type",
        "optional": "optional: leave empty for the whole picture",
        "examples": "Examples:",
        "newQuality": "Quality",
        "qualityShowcase": "Fine",
        "qualityStandard": "Fast",
        "qualityShowcaseHint": "the full checks Archify ships with",
        "qualityStandardHint": "skips the showcase-only polish checks, for a first look sooner",
        "generate": "Generate",
        "generateHint": "Starts a conversation of its own and draws the diagram there; follow it here.",
        "cannotRun": "This Harness cannot start conversations from a plugin; use Open in a conversation.",
        "starting": "Starting…",
        "openInChat": "Open in a conversation",
        "openInChatHint": "A new conversation in that folder with this prompt in the composer, for you to send",
        "copyPrompt": "Copy the prompt",
        "showPrompt": "Show the prompt",
        "scanNote": "Generate also attaches the plugin's scan of the repository (folders, manifests, deployment files, Git revision), so the model skips listing it.",
        "actionFailed": "That did not work. Try again.",
        "jobReview": "Review",
        "showPage": "Show",
        "dismiss": "Dismiss",
        "steps": "{n} steps",
        "act.starting": "starting",
        "act.thinking": "thinking",
        "act.loading": "loading the skill",
        "act.scanning": "scanning the repository",
        "act.reading": "reading",
        "act.editing": "editing the candidate",
        "act.rendering": "rendering and checking",
        "act.delivered": "page delivered",
        "state.starting": "starting",
        "state.running": "working",
        "state.done": "done",
        "state.ended": "ended without a page",
        "state.failed": "could not start",
        "type.auto": "Best fit",
        "use.auto": "not sure? the model picks",
        "use.architecture": "what a system is made of and how the parts connect",
        "use.workflow": "steps, branches, approvals, CI/CD",
        "use.sequence": "who calls whom, in order",
        "use.dataflow": "where data comes from and goes",
        "use.lifecycle": "states and the moves between them",
        "use.erd": "tables, columns, keys",
        "use.class": "classes, interfaces, inheritance",
        "use.tree": "a breakdown: modules, an org, features",
        "use.timeline": "what happened when",
        "use.waterfall": "where the time went",
        "use.explainer": "an answer as one page",



















        "reviewTitle": "Review",
        "askReview": "Review it from the code",
        "askAgain": "Review again",
        "askReviewHint": "The model reads the code and writes the review, in the conversation that drew the diagram; every point cites its evidence",
        "watchReview": "Watch",
        "readReview": "Read the review",
        "reviewUnavailable": "This page cannot be reviewed: its diagram file is gone.",
        "reviewNote": "Points are kept only when their citations check out: the files exist and the lines hold code. Whether the reasoning holds is for you to judge; open a citation to see the code.",
        "level.risk": "Risk",
        "level.warn": "Check",
        "level.info": "Note",
        "level.good": "Good",
        "reviewInPanel": "Review this architecture (Archify panel)",
        "scanned": "scanned {root}",
        "helpTitle": "How to use Archify",
        "helpStart": "START A DIAGRAM",
        "helpDrawn": "A DIAGRAM YOU HAVE",
        "helpExplainer": "ONE-PAGE EXPLAINERS",
        "helpNew": "In New, pick a type and describe it; pick a project folder to draw from its code.",
        "helpChat": "Or ask in any conversation: \"draw the architecture of this repo\" (in a conversation opened in the project), \"draw this as a sequence diagram: …\". The page appears in the conversation and here.",
        "helpMermaid": "Have Mermaid? Paste it into New's \"What to draw\" with no project, and it is drawn afresh from its meaning.",
        "helpEdit": "Change it: in the Gallery, select it and open Edit. Say what to change (layout, style, language, splitting or merging parts, a before/after page); the conversation that drew it does it, and the page updates.",
        "helpReview": "Review an architecture: the model reads the code and cites the lines each point rests on.",
        "helpView": "Read it full screen: ? lists the shortcuts, a click on a part shows what goes in and out, the menu exports PNG, SVG or WebM.",
        "helpExplainerHow": "In a conversation, after an answer, say \"make the answer above a one-page explainer\"; or pick One-page explainer in New and describe the subject.",
        "helpRules": "For pages without asking, add this line to your rules:",
        "goNew": "Go to New",
        "goGallery": "Go to the Gallery",
        "copyLine": "Copy the line",
        "editTitle": "Edit",
        "editOpenHint": "Change this diagram, through the conversation that drew it",
        "editHow": "Say what to change. It goes to the conversation that drew this diagram, which knows its context, and the page here updates when it is done.",
        "editPlaceholder": "e.g. Split the payment service into payments and reconciliation",
        "editSend": "Send to its conversation",
        "editNote": "Suggestions with … need your words where the dots are.",
        "fullscreenTip": "Press ? for the shortcuts · click a part to see what goes in and out · pick two parts for the route between them · the menu at the top right exports",
        "emptyTitle": "No diagrams yet. Three ways to start:",
        "emptyNew": "In New: pick a type, and a project folder to draw from its code or a description.",
        "emptyChat": "In any conversation: \"draw the architecture of this repo\", \"画一下下单的时序图\", \"make this answer a one-page explainer\".",
        "emptyMermaid": "Paste Mermaid into New and it is drawn afresh.",
        "reviewHowCode": "No review yet. The model reads the code of {repo} and reviews the architecture as it is built: what kind of software it is, then only what matters for that kind. Every point cites the files and lines it rests on, and the plugin checks those citations before it keeps the review. About one to three minutes.",
        "reviewHowDesign": "No review yet. This diagram was drawn from a description, with no code behind it, so the review is of the design it shows: every point names the components it is about, and nothing beyond the diagram is assumed.",
        "reviewBasisCode": "checked against the code of {repo} at {rev}",
        "reviewBasisDesign": "a review of the drawn design (no code)",
        "suggestion": "Suggestion",
        "citeHint": "Show the code this rests on",
        "reviewChecking": "checking the citations…",
        "reviewRefused": "not saved: a citation did not check out (the model fixes it)",
        "reviewSaved": "saved: {n} points, each with its evidence",
        "newFrom": "From a project",
        "newFromHint": "optional: without a folder, only your description is drawn",
        "newWhatToDraw": "What to draw",
        "required": "required without a project",
        "clearFolder": "Clear",
        "clearFolderHint": "Draw from the description only",
        "runFromCode": "The model reads the code of {name} (the plugin scans it first), cites the files it is drawn from and pins the commit. About one to two minutes. Leave the box empty for the whole picture.",
        "runFromText": "Only what you write is drawn; no file is read, so it can be any system, a plan, or something that is not software. Mermaid can be pasted as is. About half a minute.",
        "needSomething": "Pick a project folder, or write what to draw.",
        "folderMissing": "There is no folder at this path.",
        "reviewCount": "Review · {n}",
        "reviewOpenHint": "The architecture review, beside the drawing",
        "typeHint": "point at a card to see it on the right",
        "promptTitle": "The prompt that will be sent",
        "hidePrompt": "Hide the prompt",
        "runs": "Runs",
        "exampleOf": "{type}: an example",
        "looksLike": "What a {type} looks like",
        "seeExample": "Open the full example",
        "exampleNote": "One of Archify's own examples. Click it to open the live page: zoom, search, click a part for what goes in and out, switch light and dark.",
      },
      zh: {
        title: 'Archify',
        count: '{n} 个页面',
        search: '搜索',
        toolTitle: 'Archify',
        writing: '正在写图…',
        rendering: '正在渲染和检查…',
        rerun: '修复后重画',
        running: '运行中…',
        delivered: '已生成',
        failed: '渲染失败。',
        stoppedAt: '停在「{stage}」',
        diagnostics: '{n} 条诊断',
        modelRepairs: '模型会按诊断修改后重新渲染。',
        browserSkipped: '没装 Chrome、Chromium 或 Edge，跳过了真实浏览器检查。',
        'gate.validate': '校验',
        'gate.deliver': '生成',
        'gate.check': '检查',
        'gate.browser-check': '浏览器',
        'gate.prepare': '准备',
        fullScreen: '全屏查看（双击图也可以）',
        fullScreenShort: '全屏',
        openBrowser: '用默认浏览器打开',
        openBrowserShort: '浏览器',
        newTab: '在新标签页打开',
        download: '下载 HTML',
        reveal: '在文件夹中显示',
        copyPath: '复制路径',
        copied: '已复制',
        close: '关闭（Esc）',
        openSession: '打开画这张图的会话',
        openSessionShort: '所属会话',
        remove: '从列表移除（文件保留）',
        missing: '文件已不在',
        missingLong: '这个页面已经不在 {path} 了。',
        noMatch: '没有匹配的。',
        unavailable: '连不上 Archify 列表。刷新页面，或确认插件已启用。',
        justNow: '刚刚',
        minutesAgo: '{n} 分钟前',
        hoursAgo: '{n} 小时前',
        daysAgo: '{n} 天前',
        'type.architecture': '架构图',
        'type.workflow': '流程图',
        'type.sequence': '时序图',
        'type.dataflow': '数据流图',
        'type.lifecycle': '状态图',
        'type.erd': 'ER 图',
        'type.tree': '树图',
        'type.class': '类图',
        'type.timeline': '时间线',
        'type.waterfall': '瀑布图',
        'type.explainer': '讲解页',
        'type.compare': '前后对比',
        "lang": "zh",
        "tabNew": "新建",
        "tabGallery": "图库",


        "folderPlaceholder": "项目文件夹，例如 /Users/me/code/shop",
        "pickFolder": "选择…",
        "pickFailed": "打不开文件夹对话框，直接输入路径吧。",
        "recentFolders": "最近：",
        "newType": "图的类型",
        "optional": "可选：留空就画整体",
        "examples": "例子：",
        "newQuality": "质量",
        "qualityShowcase": "精致",
        "qualityStandard": "快速",
        "qualityShowcaseHint": "Archify 自带的全套检查",
        "qualityStandardHint": "跳过只为精致版准备的打磨检查，更快看到第一版",
        "generate": "生成",
        "generateHint": "开一个新会话在里面画图，进度在这里看。",
        "cannotRun": "这个 Harness 不支持插件开会话，用「在对话中打开」。",
        "starting": "正在开始…",
        "openInChat": "在对话中打开",
        "openInChatHint": "在那个文件夹开一个新会话，提示词填进输入框，你确认后发送",
        "copyPrompt": "复制提示词",
        "showPrompt": "查看提示词",
        "scanNote": "点「生成」时会附上插件对仓库的扫描（目录、清单、部署文件、Git 版本），模型不用再逐个列目录。",
        "actionFailed": "没成功，再试一次。",
        "jobReview": "点评",
        "showPage": "查看",
        "dismiss": "移除",
        "steps": "{n} 步",
        "act.starting": "启动中",
        "act.thinking": "思考中",
        "act.loading": "读取技能",
        "act.scanning": "扫描仓库",
        "act.reading": "阅读中",
        "act.editing": "修改候选图",
        "act.rendering": "渲染和检查",
        "act.delivered": "已出图",
        "state.starting": "启动中",
        "state.running": "进行中",
        "state.done": "完成",
        "state.ended": "结束了，没有出图",
        "state.failed": "没能开始",
        "type.auto": "自动选择",
        "use.auto": "拿不准就让模型选",
        "use.architecture": "系统由哪些部分组成、怎么连接",
        "use.workflow": "步骤、分支、审批、CI/CD",
        "use.sequence": "谁调用谁，按先后顺序",
        "use.dataflow": "数据从哪来、到哪去",
        "use.lifecycle": "有哪些状态、怎么转换",
        "use.erd": "表、字段、主外键",
        "use.class": "类、接口、继承和依赖",
        "use.tree": "层级拆分：模块、组织、功能",
        "use.timeline": "事情按时间发生的顺序",
        "use.waterfall": "时间都花在哪",
        "use.explainer": "把一个回答做成一页",



















        "reviewTitle": "点评",
        "askReview": "读代码点评",
        "askAgain": "再点评一次",
        "askReviewHint": "让模型在画这张图的会话里读代码写点评，每条结论都附依据",
        "watchReview": "查看进度",
        "readReview": "看点评",
        "reviewUnavailable": "这张图没法点评：图的数据文件已经不在了。",
        "reviewNote": "只有依据核对通过（文件存在、行号对得上）的结论才会保存。推理是否成立由你判断：点开依据就能看到对应的代码。",
        "level.risk": "风险",
        "level.warn": "注意",
        "level.info": "提示",
        "level.good": "做得好",
        "reviewInPanel": "点评这张架构图（Archify 面板）",
        "scanned": "已扫描 {root}",
        "helpTitle": "怎么用 Archify",
        "helpStart": "开始画一张图",
        "helpDrawn": "对已经画好的图",
        "helpExplainer": "一页讲解页",
        "helpNew": "在「新建」里选类型、写要画什么；选一个项目文件夹，就从它的代码画。",
        "helpChat": "也可以在任何会话里直接说：「画一下这个仓库的架构图」（在打开了项目的会话里）、「把下面这段画成时序图：……」。画好的页面出现在对话里，也收进这里。",
        "helpMermaid": "有 Mermaid？在「新建」里不选项目，把它贴进「要画什么」，会按它的意思重画。",
        "helpEdit": "改图：在图库选中它，点「改图」，说要改什么（布局、风格、语言、拆分合并组件、改造前后对比）。画它的那个会话去改，改好这里自动更新。",
        "helpReview": "点评架构：模型读代码评审，每条结论都附依据的代码位置。",
        "helpView": "全屏看图：按 ? 看快捷键，点组件看上下游，右上角菜单导出 PNG、SVG、WebM。",
        "helpExplainerHow": "在会话里得到回答后，说「把上面的回答做成一页」；或者在「新建」里选「讲解页」，写下主题。",
        "helpRules": "想让模型在合适的时候自动出页，在你的规则里加一行：",
        "goNew": "去「新建」",
        "goGallery": "去图库",
        "copyLine": "复制这行",
        "editTitle": "改图",
        "editOpenHint": "改这张图：交给画它的那个会话去改",
        "editHow": "说要改什么。它会发到画这张图的会话里，那里知道这张图的来龙去脉；改好后这里的页面自动更新。",
        "editPlaceholder": "比如：把支付服务拆成支付和对账两个服务",
        "editSend": "发给画它的会话",
        "editNote": "带「……」的建议需要你把省略的部分补上。",
        "fullscreenTip": "按 ? 看快捷键 · 点组件看上下游 · 选两个组件看它们之间的路径 · 右上角菜单可以导出",
        "emptyTitle": "还没有图。三种开始方式：",
        "emptyNew": "在「新建」里：选图的类型；想从代码画就选项目文件夹，否则写下要画什么。",
        "emptyChat": "在任何会话里直接说：「画一下这个仓库的架构图」「画一下下单的时序图」「把这个回答做成一页」。",
        "emptyMermaid": "有 Mermaid？贴进「新建」，会按它的意思重画。",
        "reviewHowCode": "还没有点评。点评由模型读 {repo} 的代码完成：先弄清它是什么软件、怎么运行，再只评这类软件真正重要的方面。每条结论都附上依据的文件和行号，插件核对这些位置确实存在后才保存。大约 1–3 分钟。",
        "reviewHowDesign": "还没有点评。这张图是按描述画的，没有代码，所以点评针对的是图里的设计：每条结论都指明涉及哪些组件，不假设图以外的事实。",
        "reviewBasisCode": "依据 {repo} 的代码（提交 {rev}）核实",
        "reviewBasisDesign": "依据图里的设计（没有代码）",
        "suggestion": "建议",
        "citeHint": "查看这条依据的代码",
        "reviewChecking": "正在核对依据…",
        "reviewRefused": "没有保存：有依据核对不通过（模型会改）",
        "reviewSaved": "已保存：{n} 条，每条都有依据",
        "newFrom": "从哪个项目画",
        "newFromHint": "可选：不选就只按你的描述画",
        "newWhatToDraw": "要画什么",
        "required": "没选项目时必填",
        "clearFolder": "清除",
        "clearFolderHint": "不用项目，只按描述画",
        "runFromCode": "模型会读 {name} 的代码（插件先扫描一遍），图里标出依据的源码并固定在当前提交上。大约 1–2 分钟。留空就画整体结构。",
        "runFromText": "只画你写的内容，不读任何文件：可以是任何系统、一个方案，甚至不是软件的东西；也可以直接贴 Mermaid。大约半分钟。",
        "needSomething": "选一个项目文件夹，或者写下要画什么。",
        "folderMissing": "这个路径下没有文件夹。",
        "reviewCount": "点评 · {n}",
        "reviewOpenHint": "在图旁边打开这张架构图的点评",
        "typeHint": "鼠标移到卡片上，右边就显示它的样子",
        "promptTitle": "将要发送的提示词",
        "hidePrompt": "收起提示词",
        "runs": "运行记录",
        "exampleOf": "{type}示例",
        "looksLike": "{type}长这样",
        "seeExample": "看完整示例",
        "exampleNote": "Archify 自带的示例。点开就是可交互的页面：可以缩放、搜索、点组件看上下游、切换明暗主题。",
      },
    };

    function fallbackT(key, params) {
      const template = DICTIONARY.en[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
    }

    function sessionState(id, sessions, workspaces) {
      if (!id || !sessions || !workspaces || workspaces.state === 'error') return { state: 'unknown' };
      if (sessions.phase === 'pending' || workspaces.phase === 'pending') return { state: 'unknown' };
      const archived = new Set(Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : []);
      const byId = sessions.byId && typeof sessions.byId === 'object' ? sessions.byId : {};
      for (let at = id, hops = 0; at && hops < 16; hops += 1) {
        if (archived.has(at)) return { state: 'archived', archived: at };
        const row = byId[at];
        at = row?.origin === 'subagent' ? row.parentId : undefined;
      }
      const listed = (Array.isArray(sessions.ids) && sessions.ids.includes(id)) || byId[id] !== undefined;
      return { state: listed ? 'available' : 'gone' };
    }

    function openPanel(ctx) {
      try {
        const layout = ctx.get?.('layout');
        if (!layout || typeof layout.selectPanel !== 'function') return false;
        layout.selectPanel(PANEL_ID);
        return true;
      } catch {
        return false;
      }
    }

    return {
      inject: ['slots', 'locale', 'uiConversation'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARY), 'archify: dictionaries');
        let bound = null;
        const tr = (key, params) => {
          try {
            if (bound === null && typeof ctx.locale.bind === 'function') bound = ctx.locale.bind(NS);
            if (typeof bound === 'function') return bound(key, params);
          } catch {
            // The English below.
          }
          return fallbackT(key, params);
        };
        const withT = (Component, extra) => (props) => h(Component, { ...props, ...extra, t: typeof props.t === 'function' ? props.t : tr });

        const service = (name) => {
          try {
            return ctx.get?.(name);
          } catch {
            return undefined;
          }
        };
        const snapshot = (name) => {
          try {
            return service(name)?.list?.getSnapshot?.();
          } catch {
            return undefined;
          }
        };
        const sessions = {
          available: () => typeof service('uiWorkspace')?.openSession === 'function',
          state: (id) => sessionState(id, snapshot('sessions'), snapshot('workspaces')),
          open: (id) => {
            try {
              service('uiWorkspace').openSession(id);
              return true;
            } catch {
              return false;
            }
          },
        };

        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: RENDER_TOOL, locale: NS }, withT(RenderToolView)));
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: CLI_TOOL, locale: NS }, withT(CliToolView)));
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: SCAN_TOOL, locale: NS }, withT(ScanToolView)));
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: REVIEW_TOOL, locale: NS }, withT(ReviewToolView)));
        ctx.uiConversation.events.register(pageResultDefinition);
        ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: RESULT_KIND, locale: NS }, withT(PageRow)));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 31, label: () => tr('title') }, ArchifyGlyph));
        // The Host's own folder dialog: the desktop shell's when there is one, else the workspace service's.
        const directoryPicker = () => {
          const desktop = globalThis.__DSH_DIRECTORY_PICKER__;
          if (typeof desktop?.pick === 'function') return () => desktop.pick();
          const ws = service('uiWorkspace');
          return typeof ws?.pickDirectory === 'function' ? () => ws.pickDirectory() : null;
        };
        const samePath = (a, b) => String(a ?? '').replace(/[\\/]+$/, '') === String(b ?? '').replace(/[\\/]+$/, '');
        const hostState = { canRun: true };
        if (typeof fetch === 'function') {
          void getJson(STATE_ROUTE)
            .then((s) => {
              if (s && typeof s.canRun === 'boolean') hostState.canRun = s.canRun;
            })
            .catch(() => {});
        }
        const env = {
          canRun: () => hostState.canRun,
          canPickDirectory: () => directoryPicker() !== null,
          pickDirectory: () => (directoryPicker() ?? (() => null))(),
          /** The Harness's workspaces, in sidebar order: the folders a person works in. */
          workspaces: () => {
            try {
              const items = service('workspaces')?.list?.getSnapshot?.()?.items;
              return Array.isArray(items) ? items.map((w) => ({ id: w.workspaceId, path: w.path, title: w.displayTitle })) : [];
            } catch {
              return [];
            }
          },
          canOpen: () => sessions.available(),
          openSession: (id) => sessions.open(id),
          canDraft: () => typeof service('uiWorkspace')?.startSession === 'function',
          /** A new conversation (in `dir`'s workspace, made when missing) with `prompt` in its composer, to send. */
          startDraft: async (prompt, dir) => {
            const ui = service('uiWorkspace');
            if (typeof ui?.startSession !== 'function') return false;
            let workspaceId;
            if (dir) {
              const hit = env.workspaces().find((w) => samePath(w.path, dir));
              if (hit) workspaceId = hit.id;
              else if (typeof service('workspaces')?.create === 'function') workspaceId = (await service('workspaces').create({ path: dir }))?.workspaceId;
            }
            ui.startSession(workspaceId, { prompt, whenDraftExists: 'replace' });
            return true;
          },
        };
        panelOpener.fn = () => openPanel(ctx);
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, withT(ArchifyPanel, { sessions, env })));
        if (typeof ctx.inject === 'function') {
          ctx.inject(['commandUi'], (scope) => {
            scope.effect(
              () =>
                scope.commandUi.decorate({
                  name: 'archify',
                  available: () => typeof ctx.get?.('layout')?.selectPanel === 'function',
                  ui: { kind: 'action', run: () => void openPanel(ctx) },
                }),
              'archify: /archify opens the panel',
            );
          });
        }
      },
    };
  },
});
