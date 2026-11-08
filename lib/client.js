/**
 * dsh-think-guard —— 思考过程监督者（浏览器半侧）
 *
 * 两个插槽条目共用一份模块级状态：
 *  - `conversation.session.header.actions`：标题栏上的开关按钮（会话作用域）。
 *  - `shell.overlay`：判定面板本身（根作用域）。
 *
 * 所有数据都从 Host 的 `/dsh-think-guard` RPC 通道拉取，Client 不自己折叠会话日志。
 */

window.__ModuleLoader__.load({
  id: 'dsh-think-guard',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    const NS = 'dsh-think-guard';
    const CHANNEL = '/dsh-think-guard';
    const POLL_MS = 4000;

    /* ---------------------------------------------------------------- 文案 */

    const ZH = {
      'action.title': '思考监督',
      'action.on': '监督中',
      'action.off': '未开启',
      'action.tooltip': '用独立模型旁路检查当前思路，发现明显问题就注入纠正',
      'panel.title': '思考监督',
      'panel.subtitle': '独立裁判模型旁路复核；只读，不写文件',
      'panel.close': '关闭',
      'panel.enable': '开启监督',
      'panel.disable': '关闭监督',
      'panel.mode': '模式',
      'panel.mode.observe': '观察（只记录）',
      'panel.mode.advise': '建议（发现即纠正）',
      'panel.test': '立即检查一次',
      'panel.testing': '检查中…',
      'panel.clear': '清空记录',
      'panel.empty': '还没有判定记录。让 agent 跑一会儿，或点「立即检查一次」。',
      'panel.stats': '审阅 {reviews} 次 · 介入 {interventions} 次',
      'panel.turn': '第 {turn} 轮 · 第 {step} 步',
      'panel.injected': '已注入',
      'panel.notInjected': '未介入',
      'panel.evidence': '依据',
      'panel.correction': '建议',
      'panel.error': '裁判失败',
      'panel.nosession': '没有选中的会话',
      'panel.notracked': '这个会话还没被监督接管（可能插件是刚装的，新开一轮对话即可）',
      'panel.severity': '严重度',
      'panel.reason.heuristic': '启发式命中',
      'panel.reason.boundary': '轮次收尾',
      'panel.reason.every-steps': '例行检查',
      'panel.reason.manual': '手工触发',
      'panel.reason.elapsed': '长时间运行',
      'panel.reason.periodic': '定时检查',
      'panel.sources': '会话数据',
      'panel.judge': '裁判模型',
      'panel.judge.auto': '跟随当前会话模型',
      'panel.judge.save': '保存裁判模型',
      'panel.judge.saved': '已保存',
      'panel.judge.loading': '正在读取模型列表…',
    };

    const EN = {
      'action.title': 'Thinking guard',
      'action.on': 'Watching',
      'action.off': 'Off',
      'action.tooltip': 'Review this reasoning trace with a separate model and inject a correction when something is clearly off',
      'panel.title': 'Thinking guard',
      'panel.subtitle': 'Reviewed by a separate judge model; read-only, never writes files',
      'panel.close': 'Close',
      'panel.enable': 'Enable',
      'panel.disable': 'Disable',
      'panel.mode': 'Mode',
      'panel.mode.observe': 'Observe (record only)',
      'panel.mode.advise': 'Advise (correct on sight)',
      'panel.test': 'Review now',
      'panel.testing': 'Reviewing…',
      'panel.clear': 'Clear log',
      'panel.empty': 'No verdicts yet. Let the agent run, or press Review now.',
      'panel.stats': '{reviews} reviews · {interventions} interventions',
      'panel.turn': 'turn {turn} · step {step}',
      'panel.injected': 'injected',
      'panel.notInjected': 'not injected',
      'panel.evidence': 'Evidence',
      'panel.correction': 'Suggestion',
      'panel.error': 'Judge failed',
      'panel.nosession': 'No session selected',
      'panel.notracked': 'This session is not supervised yet (the plugin may have been installed just now; start a new turn)',
      'panel.severity': 'Severity',
      'panel.reason.heuristic': 'heuristic',
      'panel.reason.boundary': 'turn boundary',
      'panel.reason.every-steps': 'routine',
      'panel.reason.manual': 'manual',
      'panel.reason.elapsed': 'long-running',
      'panel.reason.periodic': 'periodic check',
      'panel.sources': 'Session data',
      'panel.judge': 'Judge model',
      'panel.judge.auto': 'Follow current session model',
      'panel.judge.save': 'Save judge model',
      'panel.judge.saved': 'Saved',
      'panel.judge.loading': 'Loading models…',
    };

    /* ------------------------------------------------------------ 共享状态 */

    const store = {
      open: false,
      target: null,
      cache: Object.create(null),
      busy: Object.create(null),
      listeners: new Set(),
    };

    function emit() {
      for (const listener of Array.from(store.listeners)) {
        try {
          listener();
        } catch (error) {
          console.error('[dsh-think-guard] listener failed', error);
        }
      }
    }

    function subscribe(listener) {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    }

    function useStore() {
      const [, force] = React.useReducer((n) => n + 1, 0);
      React.useEffect(() => subscribe(force), []);
      return store;
    }

    function viewOf(sessionId) {
      return store.cache[sessionId] || null;
    }

    function setView(sessionId, view) {
      if (!sessionId) return;
      store.cache[sessionId] = view;
      emit();
    }

    function openPanel(target) {
      store.target = typeof target === 'string' && target !== '' ? target : null;
      store.open = true;
      emit();
    }

    function closePanel() {
      store.open = false;
      emit();
    }

    // Token usage follows decimal SI units; expose the exact figure in the tooltip.
    function formatTokenCount(value) {
      const n = Math.max(0, Number(value) || 0);
      if (n < 1000) return Math.floor(n).toLocaleString();
      const unit = n >= 1000000 ? 'M' : 'K';
      const scaled = n / (unit === 'M' ? 1000000 : 1000);
      return String(Number(scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0))) + unit;
    }

    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
        values && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole,
      );
    }

    /* ---------------------------------------------------------------- 传输 */

    function connectionOf(ctx) {
      try {
        const found = ctx.get('connection');
        if (found && found.rpc && typeof found.rpc.call === 'function') return found;
      } catch {
        /* 没有浏览器载体 */
      }
      return undefined;
    }

    async function callHost(ctx, method, payload, signal) {
      const connection = connectionOf(ctx);
      if (connection) {
        const result = await Promise.resolve(connection.rpc.call(CHANNEL, method, payload || {}, signal));
        if (!result || result.ok !== true) {
          const failure = result && result.error ? result.error : { message: 'rpc failed' };
          throw new Error(failure.message || 'rpc failed');
        }
        return result.value;
      }
      const rpcId = 'dsh-think-guard-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const response = await fetch(CHANNEL + '/' + method, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: payload || {} }),
        signal,
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const envelope = await response.json();
      const result = envelope && envelope.result;
      if (!result || result.ok !== true) {
        const failure = result && result.error ? result.error : { message: 'rpc failed' };
        throw new Error(failure.message || 'rpc failed');
      }
      return result.value;
    }

    /* ------------------------------------------------------------ 样式 */

    const CSS = [
      '.dtg-dialog{position:fixed;right:24px;bottom:24px;width:min(480px,calc(100vw - 48px));',
      'height:min(580px,calc(100vh - 140px));display:flex;flex-direction:column;pointer-events:auto;',
      'background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);',
      'border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.22);overflow:hidden;',
      'font-family:inherit;font-size:13px;color:var(--dsw-alias-label-primary);z-index:60}',
      '.dtg-head{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;flex:0 0 auto;',
      'border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dtg-head-text{flex:1 1 auto;min-width:0}',
      '.dtg-title{font-size:13px;font-weight:600;line-height:1.4}',
      '.dtg-sub{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:2px}',
      '.dtg-iconbtn{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;',
      'width:24px;height:24px;border:0;border-radius:6px;background:transparent;cursor:pointer;',
      'color:var(--dsw-alias-label-secondary);padding:0}',
      '.dtg-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dtg-bar{display:flex;align-items:center;gap:8px;padding:8px 14px;flex:0 0 auto;flex-wrap:wrap;',
      'border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dtg-chip{font:inherit;font-size:11px;padding:4px 9px;border-radius:999px;cursor:pointer;',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);',
      'border:1px solid var(--dsw-alias-border-l1);line-height:1.2}',
      '.dtg-chip.is-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dtg-btn{font:inherit;font-size:12px;padding:5px 12px;border-radius:7px;cursor:pointer;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);',
      'color:var(--dsw-alias-label-primary);line-height:1.2}',
      '.dtg-btn:disabled{opacity:.45;cursor:default}',
      '.dtg-btn.is-primary{border-color:transparent;color:#fff;background:var(--dsw-alias-brand-primary)}',
      '.dtg-stat{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:auto}',
      '.dtg-log{flex:1 1 auto;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:10px}',
      '.dtg-empty{color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;margin:auto 0;line-height:1.8}',
      '.dtg-row{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:9px 11px;',
      'display:flex;flex-direction:column;gap:5px;background:var(--dsw-alias-bg-layer-1)}',
      '.dtg-row.is-warn{border-color:var(--dsw-alias-state-warning-primary,#e8a33d)}',
      '.dtg-row.is-bad{border-color:var(--dsw-alias-state-error-primary,#d93025)}',
      '.dtg-row-head{display:flex;align-items:center;gap:7px;font-size:11px;',
      'color:var(--dsw-alias-label-secondary);flex-wrap:wrap}',
      '.dtg-badge{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid currentColor;line-height:1.4}',
      '.dtg-verdict{font-weight:600;color:var(--dsw-alias-label-primary);font-size:12px}',
      '.dtg-body{font-size:12px;line-height:1.65;white-space:pre-wrap;word-break:break-word}',
      '.dtg-field{display:flex;gap:6px;font-size:12px;line-height:1.6}',
      '.dtg-field-label{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}',
      '.dtg-trigger{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:6px;',
      'border:1px solid transparent;background:transparent;cursor:pointer;font:inherit;font-size:12px;',
      'color:var(--dsw-alias-label-secondary);white-space:nowrap;line-height:1}',
      '.dtg-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dtg-trigger.is-open{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dtg-trigger.is-live{color:var(--dsw-alias-brand-primary)}',
      '.dtg-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto}',
      '.dtg-judge-label{font-size:11px;color:var(--dsw-alias-label-secondary);flex:0 0 auto;white-space:nowrap}',
      '.dtg-judge{position:relative;flex:0 1 auto;min-width:0}',
      '.dtg-select{display:flex;align-items:center;gap:6px;max-width:190px;font:inherit;font-size:11px;',
      'padding:4px 8px;border-radius:7px;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);line-height:1.3}',
      '.dtg-select:disabled{opacity:.5;cursor:default}',
      '.dtg-select-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dtg-select-caret{flex:0 0 auto;opacity:.6;font-size:9px}',
      '.dtg-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:70;width:250px;max-height:260px;',
      'overflow-y:auto;padding:6px;border-radius:10px;background:#20242c;color:#f5f7fa;',
      'border:1px solid var(--dsw-alias-border-l1);box-shadow:0 10px 28px rgba(0,0,0,.2);',
      'display:flex;flex-direction:column;gap:1px}',
      '.dtg-judge-group{flex:0 0 auto;padding:8px 8px 4px;font-size:12px;text-transform:none;',
      'color:#b5c3d4;letter-spacing:.02em}',
      '.dtg-judge-item{flex:0 0 auto;min-height:32px;font:inherit;font-size:13px;text-align:left;padding:6px 8px;border:0;border-radius:6px;',
      'background:transparent;cursor:pointer;color:#f5f7fa;line-height:1.5;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dtg-judge-item:hover{background:#3a4656}',
      '.dtg-judge-item.is-on{background:#39485b;font-weight:600}',
      '.dtg-model-search{flex:0 0 auto;width:100%;box-sizing:border-box;padding:7px;border:1px solid #69798b;border-radius:6px;background:#151a21;color:#fff;font:inherit}',
      '.dtg-dialog{--dsw-alias-label-primary:#edf3fa;--dsw-alias-label-secondary:#adbdce;--dsw-alias-bg-overlay:#17212e;--dsw-alias-bg-layer-1:#263547;--dsw-alias-bg-layer-2:#3a5167;--dsw-alias-border-l1:#405367;--dsw-alias-brand-primary:#2b6db0;width:min(520px,calc(100vw - 32px));height:min(690px,calc(100vh - 100px));color:#edf3fa;background:#17212e;font-size:14px}',
      '.dtg-head{background:#1c2c3e;padding:16px 18px}.dtg-title{font-size:17px;font-weight:700}.dtg-sub{font-size:12px}',
      '.dtg-chat{user-select:text;-webkit-user-select:text;cursor:text;background:#101b29;padding:12px!important;max-height:270px!important;border-block:1px solid #34495f}',
      '.dtg-detached{position:fixed;z-index:200;width:min(560px,90vw);max-height:75vh;display:flex;flex-direction:column;background:#17212e;border:1px solid #526d87;border-radius:12px;box-shadow:0 18px 55px #0009;color:#edf3fa;font:14px sans-serif;overflow:hidden}',
      '.dtg-detached-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#263d54;cursor:grab;user-select:none;touch-action:none}.dtg-detached .dtg-chat{max-height:60vh!important;overflow-y:auto}',
      '.dtg-message{margin:9px 0;padding:10px 12px;border:1px solid #34495f;border-radius:10px;background:#1e3044;line-height:1.6;overflow-wrap:anywhere}',
      '.dtg-message.is-user{background:#25455d}.dtg-message.is-system{background:#202b38;color:#b9c8d7}.dtg-message-label{font-size:11px;color:#98bdd7;font-weight:700;margin-bottom:5px}.dtg-md p{margin:4px 0}.dtg-md code{background:#111d2b;border-radius:4px;padding:1px 4px}.dtg-md h4{font-size:14px;margin:8px 0 3px}.dtg-md ul{margin:4px 0;padding-left:20px}',
      '.dtg-table-wrap{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain}.dtg-md table{border-collapse:collapse;width:max-content;min-width:100%;margin:8px 0}.dtg-md th,.dtg-md td{border:1px solid #6385a8;padding:6px 9px;text-align:left;min-width:90px;vertical-align:top}.dtg-md th{background:#264769}.dtg-upload-list{display:flex;gap:8px;flex-wrap:wrap}.dtg-upload-list img{width:52px;height:52px;object-fit:cover;border-radius:5px}',
      '.dtg-compose .dtg-image-button{display:inline-flex;align-items:center;justify-content:center;width:38px;min-width:38px;padding:8px}.dtg-image-button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
      '.dtg-head{cursor:grab;touch-action:none;user-select:none}.dtg-head:active{cursor:grabbing}.dtg-head button{cursor:pointer}',
      '.dtg-dialog{touch-action:pan-y}.dtg-resize{position:sticky;bottom:0;align-self:flex-end;flex:0 0 20px;width:20px;cursor:nwse-resize;touch-action:none;z-index:85;background:linear-gradient(135deg,transparent 50%,#9db6ca 52%,#9db6ca 57%,transparent 59%,transparent 69%,#9db6ca 71%,#9db6ca 76%,transparent 78%)}',
      '.dtg-status{margin:12px 14px 4px;padding:11px 13px;border:1px solid #46627c;border-left:4px solid #68a9e4;background:#203448;border-radius:9px;line-height:1.55}',
      '.dtg-status strong{display:block;color:#fff;font-size:14px}.dtg-status small{display:block;color:#bfcedd;font-size:12px}',
      '.dtg-chip,.dtg-btn,.dtg-select{font-size:13px;min-height:34px}.dtg-chip.is-on{background:#356d99;border-color:#8bc7f2;color:#fff;font-weight:700;box-shadow:0 0 0 2px rgba(130,197,246,.2)}',
      '.dtg-row{background:#203043}.dtg-row-head,.dtg-stat,.dtg-empty,.dtg-judge-label{font-size:12px}.dtg-body{font-size:13px}',
      '.dtg-dialog,.dtg-detached{--dsw-alias-label-primary:#f2f2ef;--dsw-alias-label-secondary:#aab5b3;--dsw-alias-bg-overlay:#171c1d;--dsw-alias-bg-layer-1:#242c2c;--dsw-alias-bg-layer-2:#384641;--dsw-alias-border-l1:#3a4845;--dsw-alias-brand-primary:#72c8a8;background:#171c1d;color:#f2f2ef}',
      '.dtg-dialog{overflow-y:auto;border-color:#485653;box-shadow:0 20px 65px #0009}.dtg-log{min-height:150px}.dtg-head,.dtg-detached-head{background:#222a29;border-color:#3a4845}',
      '.dtg-title{letter-spacing:.02em}.dtg-title:before{content:"";display:inline-block;width:8px;height:8px;margin-right:9px;border-radius:50%;background:#79d4b0;box-shadow:0 0 12px #79d4b088}',
      '.dtg-status.is-off{border-color:#b66d4f;border-left-color:#ff9f75;background:#513229}.dtg-status.is-on{border-color:#4a8c69;border-left-color:#85edb3;background:#244638}.dtg-toggle-on{background:#df926d!important;color:#25150d!important;border-color:#ffb994!important;font-weight:700}.dtg-toggle-off{background:#a6dfbd!important;color:#10261a!important;border-color:#a6dfbd!important;font-weight:700}',
      '.dtg-status{border-color:#4a6658;border-left-color:#8cd8b5;background:#26372f}.dtg-status small{color:#c1cfc6}.dtg-bar{border-color:#35403d}.dtg-row{background:#242c2a;border-color:#3d4c46}',
      '.dtg-chip,.dtg-btn,.dtg-select{background:#2c3733;color:#eef2ef;border:1px solid #4b5a52}.dtg-chip:hover,.dtg-btn:hover{background:#405349}.dtg-chip.is-on,.dtg-btn.is-primary{background:#90d7b4;border-color:#90d7b4;color:#10251b;box-shadow:none}',
      '.dtg-chat{background:#111716;border-color:#394641}.dtg-detached{border-color:#66796f}.dtg-message{background:#242d2b;border-color:#3c4c45}.dtg-message.is-user{background:#3a3327;border-color:#65543b}.dtg-message.is-system{background:#222a27;color:#c1cbc5}.dtg-message-label{color:#9ed4b8}.dtg-message.is-user .dtg-message-label{color:#e9c995}.dtg-md code{background:#151b18}',
      '.dtg-msg-actions{display:flex;gap:5px;margin-top:8px}.dtg-mini{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:5px;border:1px solid #51625a;border-radius:7px;background:#25302b;color:#cbd8cf;cursor:pointer}.dtg-mini:hover,.dtg-mini:focus-visible{color:#fff;background:#40584a;border-color:#a3d6ba}.dtg-mini:disabled{opacity:.4;cursor:default}.dtg-mini svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
      '.dtg-compose{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.dtg-compose input{flex:1 1 220px;min-width:0;box-sizing:border-box;padding:9px 11px;border:1px solid #52645a;border-radius:8px;background:#1a2320;color:#f6f8f5;font:inherit;outline:none}.dtg-compose input:focus{border-color:#8ed6ad;box-shadow:0 0 0 2px #8ed6ad33}.dtg-compose button{font:inherit;font-size:12px;border-radius:8px;padding:8px 10px;border:1px solid #52645a;background:#303e37;color:#eef5ef;cursor:pointer}.dtg-compose button[type=submit]{background:#a6dfbd;color:#10261a;border-color:#a6dfbd;font-weight:700}.dtg-compose button:disabled{opacity:.4;cursor:default}',
      '.dtg-chip.is-wait{background:#705721!important;border-color:#eac671!important;color:#fff2c8!important;font-weight:700}.dtg-warning{color:#f6d47c;font-size:12px;line-height:1.55}.dtg-chip:disabled,.dtg-btn:disabled,.dtg-dialog input:disabled{opacity:.48!important;cursor:not-allowed}.dtg-field-hint{color:#bdc9c2;font-size:12px;line-height:1.55;flex-basis:100%}',
      '.dtg-menu{background:#202927;color:#f4f5f1;border-color:#586a60}.dtg-judge-item{color:#f4f5f1}.dtg-judge-item:hover{background:#405247}.dtg-judge-item.is-on{background:#4c6455}',
      /* Blue surfaces are separate from the semantic green, amber and red status colors. */
      '.dtg-dialog,.dtg-detached{--dsw-alias-label-primary:#eef6ff;--dsw-alias-label-secondary:#aabfd7;--dsw-alias-bg-overlay:#111e31;--dsw-alias-bg-layer-1:#1c3049;--dsw-alias-bg-layer-2:#294969;--dsw-alias-border-l1:#385575;--dsw-alias-brand-primary:#79baff;background:#111e31;color:#eef6ff}',
      '.dtg-dialog{border-color:#426382;box-shadow:0 22px 70px #050d1bbf}.dtg-detached{border-color:#517394}.dtg-head,.dtg-detached-head{background:linear-gradient(115deg,#1d385b,#172c47);border-color:#385575}',
      '.dtg-title:before{background:#8ac9ff;box-shadow:0 0 12px #8ac9ff88}.dtg-bar{border-color:#304b68}.dtg-status{border-color:#42668a;border-left-color:#83bff6;background:#1b3552}.dtg-status small{color:#c4d6e9}',
      '.dtg-row{background:#1a2c43;border-color:#385575}.dtg-chip,.dtg-btn,.dtg-select{background:#233b57;color:#edf6ff;border-color:#496986;transition:background-color .15s,border-color .15s}',
      '.dtg-chip:hover:not(:disabled),.dtg-btn:hover:not(:disabled),.dtg-select:hover:not(:disabled){background:#315477;border-color:#719cc5}.dtg-chip.is-on,.dtg-btn.is-primary{background:#a9d8ff;border-color:#a9d8ff;color:#102d49;box-shadow:none}',
      '.dtg-chat{background:#0d1929;border-color:#304b68}.dtg-message{background:#1a2e47;border-color:#385a7b}.dtg-message.is-user{background:#254d72;border-color:#497da9}.dtg-message.is-system{background:#1a2a3c;color:#c0d2e4}.dtg-message-label,.dtg-message.is-user .dtg-message-label{color:#add9ff}.dtg-md code{background:#0e1e30}',
      '.dtg-mini{border-color:#4d708e;background:#203c58;color:#d2e6fa}.dtg-mini:hover,.dtg-mini:focus-visible{color:#fff;background:#345d80;border-color:#a2d4ff}',
      '.dtg-compose input{border-color:#4c6d8c;background:#12263c;color:#f2f8ff}.dtg-compose input:focus{border-color:#8bc8ff;box-shadow:0 0 0 2px #8bc8ff33}.dtg-compose button{border-color:#4c6d8c;background:#264563;color:#eaf5ff}.dtg-compose button[type=submit]{background:#addcff;color:#102d49;border-color:#addcff}.dtg-field-hint{color:#bfcee0}',
      '.dtg-menu{background:#192d44;color:#eff7ff;border-color:#537596}.dtg-judge-item{color:#eff7ff}.dtg-judge-item:hover{background:#2a4c6c}.dtg-judge-item.is-on{background:#365f84}.dtg-model-search{background:#102237;border-color:#587898}',
    ].join('');

    /* ------------------------------------------------------------ 图标 */

    function eyeIcon(size) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('path', { d: 'M1.5 8S3.9 3.8 8 3.8 14.5 8 14.5 8 12.1 12.2 8 12.2 1.5 8 1.5 8Z' }),
        h('circle', { cx: 8, cy: 8, r: 2.1 }),
      );
    }

    function closeIcon() {
      return h(
        'svg',
        {
          width: 13,
          height: 13,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M4 4l8 8M12 4l-8 8' }),
      );
    }

    /* ------------------------------------------------------------ 组件 */

    function Trigger(props) {
      const state = useStore();
      const t = props.t;
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : '';
      const view = viewOf(sessionId);
      const live = Boolean(view && view.enabled);
      const active = state.open && state.target === sessionId;
      const label = live ? t('action.on') : t('action.title');
      return h(
        'button',
        {
          type: 'button',
          className: 'dtg-trigger' + (active ? ' is-open' : '') + (live ? ' is-live' : ''),
          title: t('action.tooltip'),
          'aria-label': label,
          'aria-expanded': active,
          onClick: () => (active ? closePanel() : openPanel(sessionId)),
        },
        eyeIcon(14),
        h('span', null, label),
      );
    }

    /**
     * 裁判模型选择器。
     * 值形如 `provider::model`；空串表示「跟随当前默认模型」。
     * 选完立刻写回 Host，这样同一个会话后续的审阅都用这个模型。
     */
    function JudgePicker(props) {
      const { ctx, t, target } = props;
      const [open, setOpen] = React.useState(false);
      const [modelList, setModelList] = React.useState(store.models || null);
      const [loading, setLoading] = React.useState(false);
      const [saving, setSaving] = React.useState(false);
      const [query, setQuery] = React.useState('');
      const view = viewOf(target);
      const current = (view && view.judge) || { provider: '', model: '' };
      const value = current.provider && current.model ? current.provider + '::' + current.model : '';

      function loadModels() {
        if (loading) return;
        setLoading(true);
        callHost(ctx, 'models', {}, undefined)
          .then((result) => {
            const providers = (result && result.providers) || [];
            store.models = providers;
            setModelList(providers);
          })
          .catch(() => {
            setModelList(null);
          })
          .finally(() => {
            setLoading(false);
          });
      }

      async function choose(provider, model) {
        setSaving(true);
        try {
          const next = await callHost(ctx, 'judge', { sessionId: target, provider, model }, undefined);
          setView(target, next);
          setOpen(false);
        } catch {
          /* 失败就保持原样，面板会显示当前生效的模型 */
        } finally {
          setSaving(false);
        }
      }

      const label = value === '' ? t('panel.judge.auto') : current.provider + ' · ' + current.model;

      const options = [];
      if (modelList) {
        for (const provider of modelList) {
          const q = query.trim().toLowerCase();
          const defaults = (provider.models || []).filter((model) => !q || [provider.id, provider.name, model.id, model.name].some((v) => String(v || '').toLowerCase().includes(q)));
          if (defaults.length === 0) continue;
          options.push(
            h('div', { key: 'p:' + provider.id, className: 'dtg-judge-group' }, provider.name || provider.id),
          );
          for (const model of defaults) {
            const selected = current.provider === provider.id && current.model === model.id;
            options.push(
              h(
                'button',
                {
                  key: 'm:' + provider.id + ':' + model.id,
                  type: 'button',
                  className: 'dtg-judge-item' + (selected ? ' is-on' : ''),
                  onClick: () => choose(provider.id, model.id),
                },
                model.name || model.id,
              ),
            );
          }
        }
      }

      return h(
        'div',
        { className: 'dtg-judge' },
        h(
          'button',
          {
            type: 'button',
            className: 'dtg-select',
            disabled: saving,
            title: value === '' ? t('panel.judge') : value,
            onClick: () => {
              loadModels();
              setOpen((previous) => !previous);
            },
          },
          h('span', { className: 'dtg-select-text' }, label),
          h('span', { className: 'dtg-select-caret' }, '\u25BE'),
        ),
        open
          ? h(
              'div',
              { className: 'dtg-menu' },
              h('input', { className: 'dtg-model-search', value: query, onChange: (event) => setQuery(event.target.value), placeholder: '搜索模型或服务商', 'aria-label': '搜索模型或服务商' }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dtg-judge-item' + (value === '' ? ' is-on' : ''),
                  onClick: () => choose('', ''),
                },
                t('panel.judge.auto'),
              ),
              loading ? h('div', { className: 'dtg-judge-group' }, t('panel.judge.loading')) : null,
              options.length > 0 ? options : null,
            )
          : null,
      );
    }

    function Row(props) {
      const { t } = props;
      const entry = props.entry;
      const bad = entry.ok === false;
      const warned = !bad && entry.verdict === 'intervene' && entry.severity >= 3;
      const tone = bad ? ' is-bad' : warned ? ' is-warn' : '';
      const reasonKey = 'panel.reason.' + String(entry.reason || 'manual');
      const headline = bad
        ? t('panel.error')
        : entry.verdict === 'intervene'
          ? t('panel.severity') + ' ' + String(entry.severity || 0) + '/5 · ' + String(entry.category || '')
          : 'ok';
      const preview = (value, limit) => { const chars = Array.from(String(value || '')); return chars.length > limit ? chars.slice(0, limit).join('') + '…' : chars.join(''); };
      const hasDetails = !bad && (entry.finding || entry.correction || entry.evidence?.length);
      return h(
        'div',
        { className: 'dtg-row' + tone },
        h(
          'div',
          { className: 'dtg-row-head' },
          h('span', { className: 'dtg-badge' }, t(reasonKey)),
          h('span', null, format(t('panel.turn'), { turn: entry.turn, step: entry.step })),
          h('span', { className: 'dtg-stat', style: { marginLeft: 'auto' } },
            entry.injected ? t('panel.injected') : t('panel.notInjected'),
          ),
        ),
        h('div', { className: 'dtg-verdict' }, headline),
        entry.triggerDetails?.length ? h('div', { className: 'dtg-sub' }, '触发原因：' + entry.triggerDetails.join('；')) : null,
        entry.coverage?.length ? h('div', { className: 'dtg-warning', role: 'status' }, '检查范围：' + entry.coverage.join('；')) : null,
        entry.injectionStatus ? h('div', { className: 'dtg-body' }, entry.injectionStatus) : null,
        entry.finding ? h('div', { className: 'dtg-body' }, bad ? String(entry.finding) : preview(entry.finding, 140)) : null,
        !bad && entry.correction ? h('div', { className: 'dtg-body' }, t('panel.correction') + '：' + preview(entry.correction, 140)) : null,
        hasDetails ? h('details', { className: 'dtg-details' },
          h('summary', null, '查看完整判定'),
          entry.finding ? h('div', { className: 'dtg-body' }, '问题：' + String(entry.finding)) : null,
          entry.evidence?.length ? h('div', { className: 'dtg-body' }, t('panel.evidence') + '（模型给出，尚未自动核验）：' + entry.evidence.join('；')) : null,
          entry.correction ? h('div', { className: 'dtg-body' }, t('panel.correction') + '：' + String(entry.correction)) : null,
        ) : null,
      );
    }

    // Render a small safe Markdown subset as React nodes; no HTML execution.
    function markdownInline(text) {
      return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? h('strong', { key: i }, part.slice(2, -2)) : part.startsWith('`') && part.endsWith('`') ? h('code', { key: i }, part.slice(1, -1)) : part);
    }
    function pastedImageFiles(event) {
      const items = Array.from(event.clipboardData?.items || []);
      const images = items.filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
      if (images.length && !items.some(item => item.kind === 'string' && item.type === 'text/plain')) event.preventDefault();
      return images;
    }
    function actionIcon(name) {
      return h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true }, name === 'copy' ? h(React.Fragment, null, h('rect', { x: 8, y: 8, width: 11, height: 11, rx: 2 }), h('path', { d: 'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2' })) : h(React.Fragment, null, h('path', { d: 'M4 12h13M13 7l5 5-5 5' }), h('path', { d: 'M20 5v14' })));
    }
    async function copyMessage(text) {
      if (navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(String(text)); return; } catch {} }
      const area = document.createElement('textarea'); area.value = String(text); area.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(area); area.select();
      try { if (!document.execCommand('copy')) throw new Error('复制失败，请选中文字复制'); } finally { area.remove(); }
    }

    function MarkdownMessage(props) {
      const lines = String(props.text || '').split('\n'), blocks = [];
      const cells = line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(x => x.trim().replace(/\\\|/g, '|'));
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
          const header = cells(line), rows = []; i += 2;
          while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
          i--;
          blocks.push(h('div', { className: 'dtg-table-wrap', key: 'table-' + i }, h('table', null, h('thead', null, h('tr', null, header.map((x,j) => h('th', {key:j}, markdownInline(x))))), h('tbody', null, rows.map((row,j) => h('tr', {key:j}, header.map((_,k) => h('td', {key:k}, markdownInline(row[k] || ''))))))))); continue;
        }
        if (/^#{1,4}\s+/.test(line)) blocks.push(h('h4', { key: i }, markdownInline(line.replace(/^#{1,4}\s+/, ''))));
        else if (/^\s*[-*]\s+/.test(line)) blocks.push(h('p', { key: i }, '• ', markdownInline(line.replace(/^\s*[-*]\s+/, ''))));
        else blocks.push(line ? h('p', { key: i }, markdownInline(line)) : h('div', { key: i, style: { height: 5 } }));
      }
      return h('div', { className: 'dtg-md' }, blocks);
    }

    function DetachedChat(props) {
      const [position, setPosition] = React.useState({ left: 40, top: 90 });
      const drag = React.useRef(null);
      return h('div', { className: 'dtg-detached', style: position, role: 'dialog', 'aria-label': '监察对话', onPointerDown: e => e.stopPropagation(), onPointerMove: e => e.stopPropagation(), onPointerUp: e => e.stopPropagation(), onPointerCancel: e => e.stopPropagation() },
        h('div', { className: 'dtg-detached-head', onPointerDown: (e) => { if (e.button !== 0 || e.target.closest('button')) return; drag.current = { id: e.pointerId, x: e.clientX - position.left, y: e.clientY - position.top }; e.currentTarget.setPointerCapture(e.pointerId); }, onPointerMove: (e) => { if (drag.current?.id === e.pointerId) setPosition({ left: Math.max(48 - e.currentTarget.parentElement.offsetWidth, Math.min(window.innerWidth - 48, e.clientX - drag.current.x)), top: Math.max(0, Math.min(window.innerHeight - 48, e.clientY - drag.current.y)) }); }, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; } },
          h('strong', null, '监察对话 · 独立窗口'), h('button', { type: 'button', className: 'dtg-btn', onClick: props.onDock }, '收回面板')),
        props.children);
    }

    function Panel(props) {
      const state = useStore();
      const t = props.t;
      const target = state.target || '';
      const view = viewOf(target);
      const busy = Boolean(state.busy[target]);
      const logRef = React.useRef(null);
      const abortRef = React.useRef(null);
      const [chatText, setChatText] = React.useState('');
      const [chatImages, setChatImages] = React.useState([]);
      const [imagesLoading, setImagesLoading] = React.useState(0);
      const imageInputRef = React.useRef(null);
      const imageCountRef = React.useRef(0);
      const imagePendingRef = React.useRef(0);
      imageCountRef.current = chatImages.length;
      const [chatDetached, setChatDetached] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const [approvalOffPending, setApprovalOffPending] = React.useState(false);
      const approvalOffRef = React.useRef(false);
      const [position, setPosition] = React.useState(null);
      const [size, setSize] = React.useState(null);
      const dragRef = React.useRef(null);

      async function addChatImages(files) {
        const list = Array.from(files || []);
        const available = Math.max(0, 3 - imageCountRef.current - imagePendingRef.current);
        if (list.length > available) setNotice('最多添加 3 张图片，请先移除已有图片。');
        const chosen = list.slice(0, available);
        imagePendingRef.current += chosen.length;
        setImagesLoading(value => value + chosen.length);
        for (const file of chosen) {
          try {
            if (file.size > 4 * 1024 * 1024 || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setNotice('仅支持 PNG、JPEG、WebP、GIF，每张不超过 4 MB。'); continue; }
            const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); });
            imageCountRef.current += 1;
            setChatImages(old => old.concat({ name:file.name || '粘贴的图片', data }).slice(0, 3));
          } catch { setNotice('图片读取失败，请重试。'); }
          finally { imagePendingRef.current -= 1; setImagesLoading(value => Math.max(0, value - 1)); }
        }
      }

      function startDrag(event) {
        if (event.button !== 0 || event.target.closest('button,input,select,textarea,a,summary,details,[role="button"],.dtg-resize,.dtg-chat')) return;
        const rect = event.currentTarget.getBoundingClientRect();
        dragRef.current = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top, width: rect.width, height: rect.height };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      function moveDrag(event) {
        const drag = dragRef.current;
        if (!drag || drag.resize || drag.id !== event.pointerId) return;
        setPosition({ left: Math.max(48 - drag.width, Math.min(window.innerWidth - 48, event.clientX - drag.dx)), top: Math.max(48 - drag.height, Math.min(window.innerHeight - 48, event.clientY - drag.dy)) });
      }
      function endDrag(event) { if (dragRef.current?.id === event.pointerId) dragRef.current = null; }
      function startResize(event) {
        if (event.button !== 0) return;
        event.stopPropagation();
        const rect = event.currentTarget.parentElement.getBoundingClientRect();
        dragRef.current = { id: event.pointerId, resize: true, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      function moveResize(event) {
        const drag = dragRef.current;
        if (!drag?.resize || drag.id !== event.pointerId) return;
        setSize({ width: Math.max(320, Math.min(window.innerWidth * 2, drag.width + event.clientX - drag.x)), height: Math.max(260, Math.min(window.innerHeight * 2, drag.height + event.clientY - drag.y)) });
      }

      const refresh = React.useCallback(
        async (signal) => {
          if (target === '') return;
          try {
            const next = await callHost(props.ctx, 'status', { sessionId: target }, signal);
            setView(target, next);
          } catch (error) {
            if (!signal.aborted) setView(target, { ok: false, message: '监察服务未连接：' + String(error.message || error), reviews: [] });
          }
        },
        [target, props.ctx],
      );

      React.useEffect(() => {
        if (!state.open || target === '') return undefined;
        const controller = new AbortController();
        void refresh(controller.signal);
        const timer = setInterval(() => {
          if (store.open) void refresh(controller.signal);
        }, POLL_MS);
        return () => {
          controller.abort();
          clearInterval(timer);
        };
      }, [state.open, target, refresh]);

      React.useEffect(() => {
        const node = logRef.current;
        if (node) node.scrollTop = node.scrollHeight;
      }, [view && view.reviews ? view.reviews.length : 0, state.open]);

      React.useEffect(() => {
        if (!state.open) return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape') closePanel();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [state.open]);

      React.useEffect(
        () => () => {
          if (abortRef.current) abortRef.current.abort();
        },
        [],
      );

      if (!state.open) return null;

      async function run(label, method, payload) {
        const stopping = method === 'set' && payload?.enabled === false;
        if (target === '' || (store.busy[target] && !stopping)) return;
        if (stopping && abortRef.current) abortRef.current.abort();
        store.busy[target] = true;
        emit();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const next = await callHost(props.ctx, method, Object.assign({ sessionId: target }, payload || {}), controller.signal);
          if (controller.signal.aborted) return;
          if (stopping) setNotice('监督已关闭，已请求取消正在进行的监察检查。');
          else if (next.notice) setNotice(next.notice);
          else if (method === 'injectAdvice') setNotice('未收到发送结果。');
          setView(target, next);
        } catch (error) {
          if (!controller.signal.aborted && !(error && error.name === 'AbortError')) {
            setView(target, Object.assign({ ok: false, message: String(error.message || error), reviews: (viewOf(target) || {}).reviews || [] }));
          }
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null;
            store.busy[target] = false;
            emit();
          }
        }
      }

      // The user can stop plugin approval even while a long review or chat is
      // running; it must not take over or abort that unrelated client request.
      async function turnOffApproval() {
        if (!target || approvalOffRef.current) return;
        approvalOffRef.current = true; setApprovalOffPending(true);
        try {
          const next = await callHost(props.ctx, 'set', { sessionId: target, approvalMode: 'off' });
          if (next?.approvalMode !== 'off') { setNotice('无法关闭指令审查：主机版本未更新，请重载插件。'); return; }
          setView(target, next); setNotice('插件指令审查已关闭；系统和其他插件的规则仍生效。');
        } catch (error) { setNotice('关闭指令审查失败：' + String(error?.message || error)); }
        finally { approvalOffRef.current = false; setApprovalOffPending(false); }
      }

      const reviews = (view && Array.isArray(view.reviews) ? view.reviews : []).slice().reverse();
      const enabled = Boolean(view && view.enabled);
      const mode = (view && view.mode) || 'observe';
      const tracked = Boolean(view && view.ok);
      const stats = (view && view.stats) || { reviews: 0, interventions: 0 };
      const iterationMissing = [!enabled && '开启监督', mode !== 'advise' && '切换建议模式', !view?.afterOutput && '开启输出后复查'].filter(Boolean);
      const iterationWaiting = Boolean(view?.iteration?.enabled && iterationMissing.length);
      const periodicWaiting = Boolean(view?.periodicEnabled && !enabled);

      const chatPanel =
        h('div', { className: 'dtg-chat', style: { flex: '0 0 auto', maxHeight: 130, overflowY: 'auto', padding: '8px' } },
          h('button', { type: 'button', className: 'dtg-btn', onClick: () => setChatDetached(!chatDetached) }, chatDetached ? '收回面板' : '独立聊天窗口'),
          h('div', { className: 'dtg-sub' }, '可说“自行注入”“5分钟后注入：内容”或“第5步注入：内容”；计划仅在插件运行时有效。'),
          h('div', { className: 'dtg-sub' }, '独立监察对话 · 不自动写入主会话 · ' + (view?.historyStatus || '主会话快照按需读取')),
          h('div', { className: 'dtg-sub' }, '可输入工作区内文件路径检查文档或图片；图片需模型支持，会经 DSH 附件服务发送给模型服务商。每次最多发送 3 张图片；PDF 可尝试提取嵌入图片，页面排版及未提取的内容需另行核验。'),
          view?.memoryError ? h('div', { role: 'alert' }, view.memoryError) : null,
          (view?.chat || []).map((item, i) => h('div', { key: i, className: 'dtg-message is-' + item.role },
            h('div', { className: 'dtg-message-label' }, item.role === 'user' ? '你' : item.role === 'system' ? '状态' : '监察'),
            h(MarkdownMessage, { text: item.text }),
            h('div', { className: 'dtg-msg-actions' },
              h('button', { type: 'button', className: 'dtg-mini', title: '复制', 'aria-label': '复制', onClick: () => { void copyMessage(item.text).then(() => setNotice('已复制到剪贴板')).catch(e => setNotice(e.message)); } }, actionIcon('copy')),
              item.role === 'assistant' ? h('button', { type: 'button', className: 'dtg-mini', title: '提炼并注入此建议', 'aria-label': '注入此建议', disabled: busy || !tracked, onClick: () => run('inject', 'injectAdvice', { text: item.text, source: 'assistant' }) }, actionIcon('inject')) : null))),
          h('div', { className: 'dtg-upload-list' }, chatImages.map((item, i) => h('div', { key: i }, h('img', { src: item.data, alt: item.name }), h('button', { type:'button', onClick: () => setChatImages(chatImages.filter((_, j) => j !== i)), title:'移除图片' }, '×')))),
          h('form', { className: 'dtg-compose', onSubmit: (e) => { e.preventDefault(); if (!imagesLoading && (chatText.trim() || chatImages.length)) { void run('chat', 'chat', { text: chatText, images: chatImages }); setChatText(''); setChatImages([]); } } },
            h('button', { type:'button', className:'dtg-image-button', title:'添加图片，也可在输入框粘贴图片（最多 3 张，每张 4 MB）', 'aria-label':'添加图片', disabled:busy || !tracked, onClick:() => imageInputRef.current?.click() }, h('svg', {viewBox:'0 0 24 24', 'aria-hidden':true}, h('rect', {x:3,y:3,width:18,height:18,rx:3}), h('circle',{cx:8.5,cy:8.5,r:1.5}), h('path',{d:'m4 17 5-5 3 3 3-3 5 5'}))),
            h('input', { ref:imageInputRef, type:'file', accept:'image/png,image/jpeg,image/webp,image/gif', multiple:true, disabled:busy || !tracked, style:{display:'none'}, onChange:e => { const files = Array.from(e.target.files || []); e.target.value = ''; void addChatImages(files); } }),
            h('input', { value: chatText, onChange: (e) => setChatText(e.target.value), onPaste: e => { const images = pastedImageFiles(e); if (images.length) void addChatImages(images); }, placeholder: '输入监察要求或粘贴图片，/new 开始新对话', disabled: busy || !tracked }),
            h('button', { type: 'submit', disabled: busy || !tracked || imagesLoading > 0 }, imagesLoading ? '读取图片…' : '发送'),
            h('button', { type: 'button', disabled: busy || !tracked || !(view?.chat || []).length, onClick: () => { if (window.confirm('清空此会话的监察对话及监察要求？不会删除主会话。')) run('chat', 'clearChat', {}); } }, '清空监察对话'),
            h('button', { type: 'button', disabled: busy || !tracked || !chatText.trim(), onClick: () => run('inject', 'injectAdvice', { text: chatText }) }, '注入主会话')),
          notice ? h('div', { role: 'status', className: 'dtg-body' }, notice) : null);

      return h(
        'div',
        {
          className: 'dtg-dialog',
          style: Object.assign({}, position ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' } : {}, size || {}),
          role: 'dialog',
          'aria-modal': false,
          'aria-label': t('panel.title'),
          onMouseDown: (event) => event.stopPropagation(),
          onPointerDown: startDrag,
          onPointerMove: moveDrag,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          onKeyDown: (event) => event.stopPropagation(),
        },
        h(
          'div',
          { className: 'dtg-head', title: '拖动窗口空白处移动' },
          h(
            'div',
            { className: 'dtg-head-text' },
            h('div', { className: 'dtg-title' }, t('panel.title')),
            h('div', { className: 'dtg-sub' }, t('panel.subtitle')),
          ),
          h(
            'button',
            { type: 'button', className: 'dtg-iconbtn', title: t('panel.close'), 'aria-label': t('panel.close'), onClick: closePanel },
            closeIcon(),
          ),
        ),

        h('div', { className: 'dtg-status ' + (enabled ? 'is-on' : 'is-off'), role: 'status' },
          h('strong', null, !tracked ? '连接或会话不可用' : !enabled ? '监督已关闭' : mode === 'advise' ? '建议模式 · 可向下一步骤排队纠正' : '观察模式 · 只记录，不注入纠正'),
          h('small', null, enabled ? (view?.approvalMode === 'autonomous' ? '完全自主：按档位审查操作，也审查可关联的单次沙箱提权；无法判断时拒绝。' : view?.approvalMode === 'off' ? '指令审查已关闭：交给 DSH 和其他策略。' : '指令审查：' + (view?.approvalMode === 'auto' ? '监察模型审查，明确不合理时拒绝；不确定时请求确认' : '命中规则时请求用户确认') + '；规则覆盖有限。') : '开启后检查当前会话；审批规则也随监督启用。'),
        ),

        h(
          'div',
          { className: 'dtg-bar' },
          h(
            'button',
            {
              type: 'button',
              className: 'dtg-btn ' + (enabled ? 'dtg-toggle-on' : 'dtg-toggle-off'),
              disabled: !tracked || (busy && !enabled),
              title: enabled ? '关闭监督并取消正在进行的监察请求' : '开启监督',
              onClick: () => run('toggle', 'set', { enabled: !enabled }),
            },
            enabled ? t('panel.disable') : t('panel.enable'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dtg-chip' + (mode === 'observe' ? ' is-on' : ''),
              disabled: busy || !tracked,
              title: '检查结果只记录；自动纠正需切换到建议模式，手动注入仍可使用。',
              onClick: () => run('mode', 'set', { mode: 'observe' }),
            },
            t('panel.mode.observe'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dtg-chip' + (mode === 'advise' ? ' is-on' : ''),
              disabled: busy || !tracked,
              title: enabled ? '发现有依据的问题时可注入参考建议；需要相应检查触发。' : '先开启监督，建议模式才会运行。',
              onClick: () => run('mode', 'set', { mode: 'advise' }),
            },
            t('panel.mode.advise'),
          ),
          h(
            'span',
            { className: 'dtg-stat' },
            format(t('panel.stats'), { reviews: stats.reviews, interventions: stats.interventions }),
          ),
        ),

        h(
          'div',
          { className: 'dtg-bar' },
          h(
            'span',
            { className: 'dtg-judge-label' },
            t('panel.judge'),
          ),
          h(JudgePicker, { ctx: props.ctx, t, target }),
        ),

        h('div', { className: 'dtg-bar' }, h('span', { className: 'dtg-judge-label' }, '监察 Token'),
          h('span', { className: 'dtg-sub', title: view?.usage?.chatReported ? '精确值：' + view.usage.chat.toLocaleString() + ' Token' : '服务商未报告' }, '本监察对话：' + (view?.usage?.chatReported ? formatTokenCount(view.usage.chat) : '未报告')),
          h('span', { className: 'dtg-sub', title: view?.usage?.reported ? '精确值：' + view.usage.total.toLocaleString() + ' Token' : '服务商未报告' }, '本主会话累计：' + (view?.usage?.reported ? formatTokenCount(view.usage.total) : '未报告')),
          h('span', { className: 'dtg-sub' }, '（服务商报告，可能不完整）')),

        h('div', { className: 'dtg-bar' },
          h('span', { className: 'dtg-judge-label' }, '指令审批'),
          h('button', { type: 'button', className: 'dtg-chip' + (view?.approvalMode === 'off' ? ' is-on' : ''), disabled: !tracked || approvalOffPending, title: '插件不参与指令审批；DSH 和其他插件的策略仍生效。', onClick: turnOffApproval }, approvalOffPending ? '正在关闭审查…' : '不审查（交给系统）'),
          h('button', { type: 'button', className: 'dtg-chip' + (!view?.approvalMode || view?.approvalMode === 'manual' ? ' is-on' : ''), disabled: busy || !tracked, title: '命中所选档位的操作交由用户确认。', onClick: () => run('approval', 'set', { approvalMode: 'manual' }) }, '由用户审批'),
          h('button', { type: 'button', className: 'dtg-chip' + (view?.approvalMode === 'auto' ? ' is-on' : ''), disabled: busy || !tracked, title: '命中规则后先由模型审查；无法安全放行时请求用户确认。', onClick: () => run('approval', 'set', { approvalMode: 'auto' }) }, '自动审批'),
          h('button', { type: 'button', className: 'dtg-chip' + (view?.approvalMode === 'autonomous' ? ' is-on' : ''), disabled: busy || !tracked, title: '命中规则后由模型决定；失败或无法判断时拒绝，其他策略仍有效。', onClick: () => run('approval', 'set', { approvalMode: 'autonomous' }) }, '完全自主审核'),
          h('span', { className: 'dtg-sub' }, view?.approvalMode === 'autonomous' ? '审查命中当前档位的操作及可关联的 DSH 单次沙箱提权请求；超时或无法判断时拒绝。其他权限和策略仍可能要求确认。' : view?.approvalMode === 'off' ? '插件不参与指令审批；由系统及其他策略处理。' : view?.approvalMode === 'auto' ? '命中当前档位后由模型审查；无法自动放行时请求确认。' : '命中当前档位时请求用户确认。'),
        ),
        h('div', { className: 'dtg-bar' },
          h('span', { className: 'dtg-judge-label' }, '检查深度'),
          h('button', { type:'button', className:'dtg-chip' + (view?.inspectionDepth !== 'detailed' ? ' is-on' : ''), disabled:busy || !tracked, onClick:() => run('depth','set',{inspectionDepth:'standard'}) }, '常规检查'),
          h('button', { type:'button', className:'dtg-chip' + (view?.inspectionDepth === 'detailed' ? ' is-on' : ''), disabled:busy || !tracked, onClick:() => run('depth','set',{inspectionDepth:'detailed'}) }, '细致检查'),
          h('span', { className:'dtg-sub' }, view?.inspectionDepth === 'detailed' ? '长文档分段检查并汇总；提高聊天及输出复查额度，耗时和费用可能增加，仍受模型及服务商限制。' : '使用较小预算快速检查，长内容可能截断。与指令审批档位分别设置。')),
        h('div', { className: 'dtg-bar' },
          h('button', { type: 'button', className: 'dtg-chip' + (view?.afterOutput ? ' is-on' : ''), disabled: busy || !tracked, title: '主 Agent 准备结束本轮时复查；观察模式只记录，建议模式可提出纠正。', onClick: () => run('afterOutput', 'set', { afterOutput: !view?.afterOutput }) }, view?.afterOutput ? '输出后复查：开启' : '输出后复查：关闭'),
          h('span', { className: view?.afterOutput && !enabled ? 'dtg-warning' : 'dtg-sub' }, !enabled && view?.afterOutput ? '已设置，需开启监督后才会在本轮结束时复查。' : mode === 'observe' ? '每轮最终回答都会复查，包括问答、方案和项目任务；观察模式仅记录。长输出可能截断。' : '每轮最终回答都会复查，包括问答、方案和项目任务；长输出可能截断。自动迭代开启后，纠正结果可能再次复查。'),
        ),
        h('div', { className: 'dtg-bar' },
          h('button', { type: 'button', className: 'dtg-chip' + (iterationWaiting ? ' is-wait' : view?.iteration?.enabled ? ' is-on' : ''), disabled: busy || !tracked, title: iterationWaiting ? '已配置但尚未运行：请' + iterationMissing.join('、') : '开启后可按上限反复复查和纠正；关闭可停止后续迭代。', onClick: () => run('iteration', 'set', { iterationEnabled: !view?.iteration?.enabled }) }, iterationWaiting ? '自动迭代：待启用' : view?.iteration?.enabled ? '自动迭代：运行中' : '自动迭代：关闭'),
          h('span', { className: 'dtg-sub' }, '每项任务最多纠正'),
          h('input', { type: 'number', min: 1, max: 5, defaultValue: view?.iteration?.max ?? 2, key: target + '-iteration-' + (view?.iteration?.max ?? 2), style: { width: 45 }, disabled: busy || !tracked, onBlur: e => run('iteration', 'set', { iterationMax: Math.max(1, Math.min(5, Number(e.target.value) || 2)) }) }),
          h('span', { className: iterationWaiting ? 'dtg-warning' : 'dtg-sub' }, iterationWaiting ? '注意：当前不会运行，请先' + iterationMissing.join('、') + '。' : view?.iteration?.enabled ? '次；满足条件时会自动复查并按上限纠正。' + (view?.iteration?.status || '') : '次；开启后需同时开启监督、建议模式和输出后复查。'),
        ),
        h('div', { className: 'dtg-bar' },
          h('span', { className: 'dtg-judge-label' }, '审查档位'),
          h('button', { type: 'button', className: 'dtg-chip' + (view?.approvalLevel !== 'off' && view?.approvalLevel !== 'high' ? ' is-on' : ''), disabled: busy || !tracked || view?.approvalMode === 'off', title: view?.approvalMode === 'off' ? '启用一种审批方式后可选择档位' : undefined, onClick: () => run('approval', 'set', { approvalLevel: 'standard' }) }, '常规'),
          h('button', { type: 'button', className: 'dtg-chip' + (view?.approvalLevel === 'high' ? ' is-on' : ''), disabled: busy || !tracked || view?.approvalMode === 'off', title: view?.approvalMode === 'off' ? '启用一种审批方式后可选择档位' : undefined, onClick: () => run('approval', 'set', { approvalLevel: 'high' }) }, '高频'),
          h('span', { className: 'dtg-sub' }, view?.approvalMode === 'off' ? '当前不审查；选择审批方式后生效' : view?.approvalLevel === 'high' ? '高危操作与敏感文件修改' : '高危删除、权限变更与数据发送等'),
        ),

        h('div', { className: 'dtg-bar' },
          h('button', { type: 'button', className: 'dtg-chip' + (periodicWaiting ? ' is-wait' : view?.periodicEnabled ? ' is-on' : ''), disabled: busy || !tracked, title: '仅主 Agent 运行时定时触发检查；关闭不影响长任务、步数和其他触发条件。', onClick: () => run('periodic', 'set', { periodicEnabled: !view?.periodicEnabled }) }, periodicWaiting ? '定时检查：待启用' : view?.periodicEnabled ? '定时检查：开启' : '定时检查：关闭'),
          h('span', null, '每'),
          h('input', { type: 'number', min: 5, max: 3600, defaultValue: (view?.periodicMs ?? 45000) / 1000, key: target + '-periodic-' + (view?.periodicMs ?? 'loading'), style: { width: 65 }, title: view?.periodicEnabled ? '定时检查间隔，最短 5 秒' : '先开启定时检查', onBlur: (e) => run('frequency', 'set', { periodicMs: Math.max(5, Number(e.target.value) || 45) * 1000 }), disabled: busy || !tracked || !view?.periodicEnabled }),
          h('span', null, '秒'),
          h('span', { className: periodicWaiting ? 'dtg-warning' : 'dtg-field-hint' }, periodicWaiting ? '已配置，但需先开启监督才会运行。' : '仅主 Agent 运行中触发；仍受检查冷却、并发和每轮次数限制。'),
        ),
        h('div', { className: 'dtg-bar' },
          h('span', null, '检查冷却（秒）'),
          h('input', { type: 'number', min: 0, max: 3600, defaultValue: (view?.cooldownMs ?? 45000) / 1000, key: target + '-cooldown-' + (view?.cooldownMs ?? 'loading'), style: { width: 65 }, title: '两次自动检查的最短间隔；不是定时触发。0 表示不限制。', onBlur: (e) => run('frequency', 'set', { cooldownMs: Math.max(0, Number(e.target.value) || 0) * 1000 }), disabled: busy || !tracked }),
          h('span', null, '每 N 步（0 关闭）'),
          h('input', { type: 'number', min: 0, max: 1000, defaultValue: view?.everySteps ?? 0, key: target + '-steps-' + (view?.everySteps ?? 'loading'), style: { width: 55 }, onBlur: (e) => run('frequency', 'set', { everySteps: Math.max(0, Number(e.target.value) || 0) }), disabled: busy || !tracked }),
          h('span', null, '长任务检查（分钟，0 关闭）'),
          h('input', { type: 'number', min: 0, max: 1440, defaultValue: (view?.longReviewMs ?? 600000) / 60000, key: target + '-long-' + (view?.longReviewMs ?? 'loading'), style: { width: 55 }, title: '连续运行达到设定分钟数后检查；0 关闭。', onBlur: (e) => run('frequency', 'set', { longReviewMs: Math.max(0, Number(e.target.value) || 0) * 60000 }), disabled: busy || !tracked }),
          h('span', { className: 'dtg-field-hint' }, '冷却限制自动触发频率，0 为不限制；每 N 步指模型步骤，不是用户对话轮次。手动检查和输出后复查不受冷却限制。'),
        ),
        chatDetached ? ReactDOM.createPortal(h(DetachedChat, { onDock: () => setChatDetached(false) }, chatPanel), document.body) : chatPanel,

        h(
          'div',
          { className: 'dtg-bar' },
          h(
            'button',
            {
              type: 'button',
              className: 'dtg-btn',
              disabled: busy || !tracked,
              onClick: () => run('test', 'test', {}),
            },
            busy ? t('panel.testing') : t('panel.test'),
          ),
          h(
            'button',
            { type: 'button', className: 'dtg-btn', disabled: busy || !tracked, onClick: () => run('clear', 'clear', {}) },
            t('panel.clear'),
          ),
        ),

        h(
          'div',
          { className: 'dtg-log', ref: logRef },
          (view?.deliveries || []).slice(-5).reverse().map((item) => h('div', { key: 'delivery:' + item.id, className: 'dtg-row' },
            h('div', { className: 'dtg-verdict' }, '监察建议 · ' + (item.status === 'claimed' ? '已由下一步取出' : item.status === 'discarded' ? '已从队列移除' : item.status === 'failed' ? '发送失败' : '已排队')),
            item.summary ? h('div', { className: 'dtg-body' }, '摘要：' + item.summary) : null,
            h('div', { className: 'dtg-sub' }, item.status === 'claimed' ? '消息已进入下一步准备流程；不代表模型已采纳。' : item.status === 'queued' ? '等待主会话的下一步骤。' : '请检查任务是否已停止。'))),
          (view?.scheduled || []).slice(-5).reverse().map((job) => h('div', { key: 'schedule:' + job.id, className: 'dtg-row' }, h('div', { className: 'dtg-verdict' }, job.status === 'pending' ? '等待注入' : job.status === 'delivered' ? '已发送到队列' : job.status === 'cancelled' ? '已取消' : '发送失败'), h('div', { className: 'dtg-body' }, job.text), h('div', { className: 'dtg-sub' }, job.result || (job.dueAt ? '触发时间：' + new Date(job.dueAt).toLocaleString() : '目标：第 ' + job.targetStep + ' 步')), job.status === 'pending' ? h('button', { type: 'button', className: 'dtg-btn', disabled: busy, onClick: () => run('cancelScheduled', 'cancelScheduled', { id: job.id }) }, '取消计划') : null)),
          (view?.alerts || []).slice(-5).reverse().map((alert, i) => h('div', { key: 'alert:' + i, className: 'dtg-row is-warn' }, h('div', { className: 'dtg-verdict' }, (alert.decision === 'pending' ? '监察审核中' : alert.decision === 'allow' ? '监察自动同意' : alert.decision === 'deny' ? '监察已拒绝' : '请求用户确认') + ' · ' + alert.tool), h('div', { className: 'dtg-body' }, alert.reason), alert.target ? h('div', { className: 'dtg-sub' }, '目标：' + alert.target) : null, alert.detail ? h('div', { className: 'dtg-sub' }, (alert.decision === 'pending' ? '状态：' : '理由：') + alert.detail) : null, alert.userQuote ? h('div', { className: 'dtg-sub' }, '用户原话：' + alert.userQuote) : null)),
          target === ''
            ? h('div', { className: 'dtg-empty' }, t('panel.nosession'))
            : !tracked
              ? h('div', { className: 'dtg-empty' }, (view && view.message) || t('panel.notracked'))
              : reviews.length === 0
                ? h('div', { className: 'dtg-empty' }, t('panel.empty'))
                : reviews.map((entry) => h(Row, { key: entry.id || entry.at, entry, t })),
        ),
        h('div', { className: 'dtg-resize', role: 'separator', 'aria-label': '拖动调整窗口大小', onPointerDown: startResize, onPointerMove: moveResize, onPointerUp: endDrag, onPointerCancel: endDrag }),
      );
    }

    /* ------------------------------------------------------------ 入口 */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-think-guard: dictionaries');

        const t = ctx.locale.bind(NS);

        ctx.effect(() => {
          const style = document.createElement('style');
          style.setAttribute('data-dsh-think-guard', '');
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => {
            if (style.parentNode) style.parentNode.removeChild(style);
          };
        }, 'dsh-think-guard: styles');

        /* 标题栏开关（会话作用域：能拿到 sessionId）。 */
        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.actions',
              id: 'dsh-think-guard-trigger',
              order: 28,
              label: () => t('action.title'),
            },
            function ThinkGuardTrigger(props) {
              return h(Trigger, Object.assign({}, props, { t }));
            },
          ),
        );

        /* 判定面板（根作用域浮层）。 */
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'dsh-think-guard-panel', order: 205 },
            function ThinkGuardPanel(props) {
              return h(Panel, Object.assign({}, props, { t, ctx }));
            },
          ),
        );
      },
    };
  },
});
