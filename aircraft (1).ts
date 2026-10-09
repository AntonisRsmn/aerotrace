@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700;800&display=swap');

:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #e7edf6;
  background: #090d14;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  --bg: #090d14;
  --panel: #0e141e;
  --panel-2: #121b28;
  --line: rgba(150, 174, 205, .13);
  --muted: #7e8da2;
  --soft: #a7b4c6;
  --text: #e7edf6;
  --blue: #58a9ff;
  --mono: "DM Mono", ui-monospace, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; background: var(--bg); }
button, input { font: inherit; }
button { color: inherit; }
button:focus-visible, input:focus-visible { outline: 2px solid #5aaeff; outline-offset: 2px; }
.app-shell { height: 100vh; min-height: 600px; display: flex; flex-direction: column; overflow: hidden; }
.topbar { height: 68px; flex: 0 0 68px; display: flex; align-items: center; padding: 0 22px; background: rgba(12,17,26,.98); border-bottom: 1px solid var(--line); z-index: 10; }
.brand { display: flex; align-items: center; gap: 11px; color: inherit; text-decoration: none; min-width: 255px; }
.brand-mark { width: 38px; height: 38px; border: 1px solid rgba(84,166,255,.38); color: var(--blue); display: grid; place-items: center; border-radius: 10px; background: linear-gradient(145deg, rgba(64,145,232,.16), rgba(22,43,67,.12)); }
.brand-copy { display: flex; flex-direction: column; gap: 3px; }
.brand-name { letter-spacing: .13em; font-size: 16px; font-weight: 800; }
.brand-name span { color: #66b3ff; }
.brand-subtitle { font: 9px var(--mono); letter-spacing: .105em; color: #77869a; }
.topbar-center { display: flex; align-items: center; gap: 10px; font: 10px var(--mono); letter-spacing: .09em; color: #aebbd0; }
.system-dot, .tiny-dot, .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #4dd5a0; box-shadow: 0 0 10px rgba(77,213,160,.45); }
.topbar-divider, .bottom-separator, .status-divider { height: 14px; width: 1px; background: var(--line); margin: 0 4px; }
.muted { color: #69788d; }
.topbar-actions { margin-left: auto; display: flex; align-items: center; gap: 14px; }
.demo-pill { display: flex; align-items: center; gap: 7px; font: 10px var(--mono); color: #e5c37a; border: 1px solid rgba(229,195,122,.23); background: rgba(229,195,122,.07); padding: 7px 9px; border-radius: 5px; letter-spacing: .06em; }
.demo-pill span { width: 5px; height: 5px; border-radius: 50%; background: #e5c37a; }
.icon-button, .subtle-icon { display: grid; place-items: center; border: 1px solid transparent; background: transparent; color: #8796ab; border-radius: 7px; width: 34px; height: 34px; cursor: pointer; }
.icon-button:hover, .subtle-icon:hover, .subtle-icon.active { color: #e6effa; background: #172333; border-color: var(--line); }
.avatar { width: 30px; height: 30px; border-radius: 8px; background: #1b2a3d; color: #9acbff; border: 1px solid #2b4562; font: 10px var(--mono); }
.workspace { display: flex; flex: 1; min-height: 0; }
.traffic-sidebar { width: 330px; flex: 0 0 330px; display: flex; flex-direction: column; background: #0c121b; border-right: 1px solid var(--line); z-index: 4; min-height: 0; }
.sidebar-heading { padding: 23px 20px 17px; display: flex; align-items: center; justify-content: space-between; }
.eyebrow { font: 9px var(--mono); letter-spacing: .13em; color: #74849a; }
.sidebar-heading h1 { margin: 7px 0 0; font-size: 18px; letter-spacing: -.035em; font-weight: 600; }
.close-mobile { display: none; }
.traffic-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 16px 20px; }
.stat-card { position: relative; min-width: 0; padding: 13px 12px 12px; background: linear-gradient(135deg, #121d2b, #101722); border: 1px solid rgba(135,166,204,.13); border-radius: 9px; }
.stat-icon { width: 27px; height: 27px; display: grid; place-items: center; border-radius: 7px; margin-bottom: 13px; }
.stat-icon.blue { background: rgba(69,155,255,.13); color: #68b7ff; }
.stat-icon.violet { background: rgba(163,123,255,.13); color: #b59aff; }
.stat-value { font-size: 25px; font-weight: 600; letter-spacing: -.04em; }
.stat-label { margin-top: 4px; font: 9px var(--mono); color: #7d8da3; letter-spacing: .035em; }
.stat-foot { display: flex; align-items: center; gap: 6px; margin-top: 12px; color: #728299; font-size: 10px; }
.stat-foot .tiny-dot { width: 5px; height: 5px; background: #e1b96c; box-shadow: none; }
.section-title-row { padding: 14px 17px 10px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--line); }
.section-title { display: flex; align-items: center; gap: 8px; font: 10px var(--mono); letter-spacing: .1em; color: #a7b5c8; }
.count-chip { padding: 3px 6px; background: #1b2b3e; border-radius: 4px; color: #8ec7ff; font-size: 9px; }
.subtle-icon { width: 29px; height: 29px; }
.search-box { margin: 0 15px 10px; display: flex; align-items: center; gap: 9px; padding: 0 10px; height: 38px; border-radius: 7px; border: 1px solid rgba(135,166,204,.16); background: #0a1018; color: #6d7e94; }
.search-box:focus-within { border-color: rgba(88,169,255,.55); }
.search-box input { min-width: 0; flex: 1; outline: none; border: 0; background: transparent; color: #e6edf7; font-size: 11px; }
.search-box input::placeholder { color: #64748a; }
.search-box kbd { font: 10px var(--mono); padding: 2px 5px; border: 1px solid #283649; border-radius: 4px; color: #708197; }
.search-box button { border: 0; background: transparent; color: #8494a9; display: grid; place-items: center; padding: 2px; cursor: pointer; }
.filter-panel { padding: 11px 15px 13px; border-bottom: 1px solid var(--line); background: #101824; }
.filter-label { display: flex; align-items: center; gap: 6px; color: #8293a9; font: 9px var(--mono); margin-bottom: 9px; }
.category-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.category-chip { border: 1px solid #263448; background: #111b29; color: #95a6bc; font-size: 10px; padding: 6px 8px; border-radius: 5px; cursor: pointer; }
.category-chip.selected { color: #a8d4ff; background: rgba(69,155,255,.12); border-color: rgba(69,155,255,.38); }
.aircraft-list { flex: 1; overflow: auto; min-height: 0; scrollbar-width: thin; scrollbar-color: #253448 transparent; }
.aircraft-row { width: 100%; display: flex; align-items: flex-start; gap: 10px; padding: 13px 15px; border: 0; border-bottom: 1px solid rgba(135,166,204,.075); background: transparent; text-align: left; cursor: pointer; position: relative; }
.aircraft-row:hover { background: rgba(30,47,68,.48); }
.aircraft-row.selected { background: linear-gradient(90deg, rgba(47,126,204,.17), rgba(47,126,204,.035)); }
.aircraft-row.selected::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: #5dafff; }
.row-plane { flex: 0 0 30px; width: 30px; height: 30px; border: 1px solid #293c53; border-radius: 7px; display: grid; place-items: center; color: #8cc8ff; background: #152234; margin-top: 1px; }
.row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.row-topline { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.row-topline strong { font: 12px var(--mono); letter-spacing: .03em; color: #dce8f8; }
.row-alt { color: #9aabc0; font: 11px var(--mono); }
.row-alt small { color: #61758e; font-size: 8px; }
.row-type { color: #7d8da2; font-size: 10px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.row-route { color: #aab8ca; font-size: 10px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.row-route span { color: #5c8cbd; padding: 0 3px; }
.row-chevron { color: #53677f; transform: rotate(-90deg); margin-top: 7px; }
.empty-state { color: #78899f; font-size: 12px; padding: 24px 17px; }
.sidebar-footer { height: 38px; flex: 0 0 38px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; color: #74869c; font: 8px var(--mono); letter-spacing: .05em; }
.sidebar-footer span:first-child { display: flex; align-items: center; gap: 7px; }
.sidebar-footer .tiny-dot { width: 5px; height: 5px; background: #e1b96c; box-shadow: none; }
.sidebar-footer span:last-child { color: #b18b58; }
.map-section { position: relative; flex: 1; min-width: 0; background: #101923; overflow: hidden; }
.map-canvas { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 300px; }
.map-top-controls { position: absolute; z-index: 2; top: 16px; left: 16px; right: 16px; display: flex; justify-content: space-between; align-items: flex-start; pointer-events: none; }
.map-location, .map-control-group { pointer-events: auto; display: flex; align-items: center; background: rgba(12,18,28,.92); backdrop-filter: blur(14px); border: 1px solid rgba(157,185,218,.15); box-shadow: 0 8px 28px rgba(0,0,0,.18); border-radius: 8px; }
.map-location { padding: 9px 12px; gap: 10px; }
.location-icon { display: grid; place-items: center; width: 31px; height: 31px; border-radius: 7px; background: rgba(81,160,241,.12); color: #76baff; }
.map-location > span:last-child { display: flex; flex-direction: column; gap: 4px; }
.map-location strong { font: 10px var(--mono); letter-spacing: .1em; }
.map-location small { color: #8192a8; font-size: 10px; }
.map-control-group { gap: 2px; padding: 4px; }
.map-control { display: flex; align-items: center; gap: 7px; padding: 8px 9px; border: 0; border-radius: 5px; background: transparent; color: #a9b7ca; font-size: 10px; cursor: pointer; }
.map-control:hover { background: #1c2a3b; color: white; }
.map-legend { position: absolute; z-index: 2; left: 17px; bottom: 53px; display: flex; gap: 14px; align-items: center; background: rgba(12,18,28,.9); backdrop-filter: blur(12px); border: 1px solid rgba(157,185,218,.13); border-radius: 7px; padding: 9px 11px; }
.legend-item { display: flex; align-items: center; gap: 6px; font-size: 9px; color: #9cacc0; }
.legend-plane { font-style: normal; font-size: 13px; color: #66b4ff; }
.legend-plane.cargo { color: #b49aff; }
.legend-plane.other { color: #e7c178; }
.map-bottom-left { position: absolute; z-index: 2; left: 19px; bottom: 17px; display: flex; align-items: center; gap: 8px; color: #8192a7; font: 9px var(--mono); letter-spacing: .07em; pointer-events: none; }
.coords { display: flex; align-items: center; gap: 6px; }
.map-provider { color: #64758b; }
.detail-panel { position: absolute; z-index: 3; top: 77px; right: 16px; bottom: 55px; width: 315px; display: flex; flex-direction: column; overflow: auto; background: rgba(12,18,28,.96); backdrop-filter: blur(18px); border: 1px solid rgba(157,185,218,.17); border-radius: 10px; box-shadow: 0 16px 45px rgba(0,0,0,.3); scrollbar-width: thin; scrollbar-color: #293a50 transparent; }
.detail-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 18px 17px 14px; border-bottom: 1px solid var(--line); }
.detail-header h2 { margin: 7px 0 6px; font: 600 21px var(--mono); letter-spacing: -.03em; }
.detail-registration { display: flex; align-items: center; gap: 7px; font: 9px var(--mono); color: #8b9bb0; letter-spacing: .05em; }
.detail-dot { width: 3px; height: 3px; border-radius: 50%; background: #435b77; }
.detail-aircraft-visual { min-height: 127px; position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: center; align-items: center; border-bottom: 1px solid var(--line); background: radial-gradient(ellipse at 50% 36%, rgba(49,118,184,.15), transparent 57%); }
.aircraft-visual-glow { position: absolute; width: 180px; height: 70px; border: 1px solid rgba(85,157,226,.12); border-radius: 50%; transform: rotate(-20deg); }
.big-plane { z-index: 1; color: #8ccaff; margin-bottom: 7px; filter: drop-shadow(0 0 12px rgba(83,167,243,.25)); }
.visual-type { z-index: 1; font-size: 11px; color: #d0dcec; }
.visual-airline { z-index: 1; margin-top: 4px; color: #778aa2; font-size: 9px; }
.detail-metrics { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--line); }
.metric { display: flex; flex-direction: column; padding: 13px 15px 12px; min-width: 0; border-bottom: 1px solid rgba(135,166,204,.075); }
.metric:nth-child(odd) { border-right: 1px solid rgba(135,166,204,.075); }
.metric-label { color: #7d8da3; font: 8px var(--mono); letter-spacing: .09em; margin-bottom: 8px; }
.metric strong { font: 500 19px var(--mono); color: #e4edf8; white-space: nowrap; }
.metric strong small { font-size: 9px; color: #8597ae; }
.metric-note { margin-top: 5px; color: #71839b; font-size: 9px; }
.vertical-rate { display: flex; align-items: center; gap: 2px; font-size: 15px !important; }
.detail-section { padding: 15px 16px; border-bottom: 1px solid var(--line); }
.detail-section-heading { display: flex; justify-content: space-between; color: #a5b4c8; font: 9px var(--mono); letter-spacing: .08em; margin-bottom: 17px; }
.detail-section-heading span { color: #5e7189; }
.route-visual { display: flex; flex-direction: column; padding-left: 3px; }
.route-point { display: flex; gap: 11px; align-items: center; }
.route-ring { width: 9px; height: 9px; border: 2px solid #5dafff; border-radius: 50%; box-shadow: 0 0 8px rgba(93,175,255,.16); flex: 0 0 9px; }
.route-point.destination .route-ring { border-color: #a78bfa; box-shadow: 0 0 8px rgba(167,139,250,.16); }
.route-point > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.route-point strong { font-size: 11px; font-weight: 500; }
.route-point small { color: #7688a0; font: 9px var(--mono); }
.route-line { height: 27px; margin-left: 4px; border-left: 1px dashed #354960; display: flex; flex-direction: column; justify-content: space-around; padding-left: 0; }
.route-line span { width: 3px; height: 3px; margin-left: -2px; border-radius: 50%; background: #527ca5; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 12px; }
.info-grid > div { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.info-grid span { color: #788aa1; font-size: 9px; }
.info-grid strong { font-size: 10px; color: #c5d2e2; font-weight: 500; overflow-wrap: anywhere; }
.info-grid strong small { font-size: 9px; color: #74869b; font-weight: 400; }
.detail-disclaimer { margin: auto 12px 12px; padding: 10px; display: flex; gap: 8px; align-items: flex-start; background: rgba(225,185,108,.06); border: 1px solid rgba(225,185,108,.12); border-radius: 6px; color: #a99572; font-size: 9px; line-height: 1.5; }
.detail-disclaimer svg { flex: 0 0 auto; margin-top: 1px; }
.map-statusbar { position: absolute; z-index: 2; bottom: 0; left: 0; right: 0; height: 35px; display: flex; align-items: center; gap: 11px; padding: 0 16px; background: rgba(10,15,23,.95); border-top: 1px solid rgba(157,185,218,.12); color: #73859c; font: 8px var(--mono); letter-spacing: .04em; }
.map-statusbar > span:first-child, .map-statusbar > span:nth-of-type(3) { display: flex; align-items: center; gap: 6px; }
.map-statusbar .status-dot { width: 5px; height: 5px; }
.map-statusbar svg { color: #7e9dbf; }
.status-spacer { flex: 1; }
.mobile-list-toggle { display: none; }
.aircraft-marker { display: flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; color: #72baff; cursor: pointer; filter: drop-shadow(0 1px 4px #000); transform: translateZ(0); white-space: nowrap; }
.marker-plane { font-size: 20px; line-height: 1; display: inline-block; transform: rotate(var(--heading, 0deg)); color: #75bdff; text-shadow: 0 0 9px rgba(67,159,255,.4); }
.marker-callsign { font: 9px var(--mono); color: #c7d9ed; text-shadow: 0 1px 3px #000, 0 0 5px #000; background: rgba(8,14,22,.72); padding: 2px 4px; border: 1px solid rgba(103,164,221,.25); border-radius: 3px; }
.aircraft-marker.is-selected .marker-plane { color: #fff; text-shadow: 0 0 13px #3298ff; }
.aircraft-marker.is-selected .marker-callsign { color: #fff; border-color: #58a9ff; background: #173451; }
.maplibregl-ctrl-group { background: rgba(12,18,28,.92) !important; border: 1px solid rgba(157,185,218,.18) !important; box-shadow: 0 4px 15px rgba(0,0,0,.2) !important; }
.maplibregl-ctrl-group button { background-color: transparent !important; }
.maplibregl-ctrl-group button span { filter: invert(.85); }
.maplibregl-ctrl-attrib { background: rgba(12,18,28,.75) !important; color: #8b9ab0 !important; font-size: 9px !important; }
.maplibregl-ctrl-attrib a { color: #a9bfd8 !important; }
@media (max-width: 1100px) {
  .traffic-sidebar { width: 290px; flex-basis: 290px; }
  .detail-panel { width: 292px; right: 12px; }
  .map-top-controls { left: 12px; right: 12px; }
  .map-control { padding: 8px 7px; }
}
@media (max-width: 850px) {
  .topbar { padding: 0 14px; }
  .brand { min-width: 0; }
  .topbar-center { display: none; }
  .traffic-sidebar { position: absolute; top: 68px; bottom: 0; left: 0; width: 320px; max-width: calc(100vw - 42px); transform: translateX(-105%); transition: transform .22s ease; box-shadow: 15px 0 45px rgba(0,0,0,.35); z-index: 8; }
  .traffic-sidebar.mobile-open { transform: translateX(0); }
  .close-mobile { display: grid; }
  .mobile-list-toggle { display: flex; position: absolute; z-index: 3; top: 82px; left: 12px; align-items: center; gap: 8px; padding: 9px 11px; border: 1px solid rgba(157,185,218,.18); border-radius: 7px; background: rgba(12,18,28,.94); color: #c5d5e7; font-size: 11px; box-shadow: 0 6px 20px rgba(0,0,0,.22); }
  .mobile-list-toggle span { background: #1b2b3e; color: #8ec7ff; padding: 2px 5px; border-radius: 4px; font: 9px var(--mono); }
  .map-top-controls { top: 15px; }
  .detail-panel { top: 132px; bottom: 48px; width: min(310px, calc(100vw - 24px)); }
  .map-legend { bottom: 48px; }
  .map-bottom-left { display: none; }
}
@media (max-width: 500px) {
  .topbar { height: 60px; flex-basis: 60px; }
  .brand-mark { width: 34px; height: 34px; }
  .brand-name { font-size: 14px; }
  .brand-subtitle { font-size: 7px; }
  .topbar-actions { gap: 7px; }
  .demo-pill { font-size: 8px; padding: 6px 7px; }
  .avatar { display: none; }
  .traffic-sidebar { top: 60px; }
  .map-location { padding: 7px 8px; gap: 7px; }
  .location-icon { width: 27px; height: 27px; }
  .map-location strong { font-size: 9px; }
  .map-location small { font-size: 9px; }
  .map-control-group { padding: 3px; }
  .map-control { padding: 7px; }
  .map-control span { display: none; }
  .detail-panel { top: 127px; right: 8px; bottom: 44px; width: calc(100vw - 16px); }
  .map-legend { left: 8px; bottom: 43px; gap: 9px; padding: 8px; }
  .legend-item { font-size: 8px; }
  .map-statusbar { height: 32px; padding: 0 8px; gap: 7px; font-size: 7px; }
  .map-statusbar > span:last-child { max-width: 90px; overflow: hidden; white-space: nowrap; }
}
