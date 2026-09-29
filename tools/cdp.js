#!/usr/bin/env node
// Drive a test kiosk over the DevTools protocol (tools/test-kiosk.sh starts
// one with CINEMA_DEBUG_PORT). Keys sent this way reach the page like a
// remote's, except that Electron's before-input-event does not see them
// (preload.js has a volume-key fallback for exactly this).
//
//   node tools/cdp.js <port> <command>...
//
//   key:<Key>         a key press (ArrowUp/Down/Left/Right, Enter, Escape,
//                     BrowserBack, AudioVolumeUp/Down/Mute, ...), then 450 ms
//   where[:label]     what the focus ring is on: path | x,y wxh op=<ring opacity> | text
//   eval:<js>         evaluate in the page's main world, print the result (JSON)
//   evalf:<file>      the same, from a file
//   url:<path>        navigate (location.href = ...)
//   wait:<ms>
//   shot:<file.png>   screenshot
//   mmove:<x>,<y>     real mouse move (window coordinates)
//   mclick:<x>,<y>    real mouse click
//
// e.g. node tools/cdp.js 9333 url:/v/ wait:4000 where key:ArrowDown where key:Enter wait:2500 where
'use strict';

const fs = require('fs');

const KEYS = {
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27, Backspace: 8,
  BrowserBack: 166, BrowserHome: 172, ' ': 32, AudioVolumeUp: 175, AudioVolumeDown: 174, AudioVolumeMute: 173,
};

const WHERE = `(() => {
  const g = document.getElementById('cinema-focus-ring');
  if (!g) return location.pathname + ' | no ring';
  const r = g.getBoundingClientRect();
  const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const t = e ? ((e.closest('a,button,[class*=card-root],[class*=cursor-pointer]') || e).innerText || '') : '';
  return location.pathname + ' | ' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
    + ' op=' + g.style.opacity + ' | ' + t.slice(0, 30).split(String.fromCharCode(10)).join(' ');
})()`;

async function main() {
  const [port, ...cmds] = process.argv.slice(2);
  if (!port || !cmds.length) {
    console.error('usage: cdp.js <port> <command>...   (see the header of this file)');
    process.exit(2);
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((x) => x.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = {};
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const res = r.result || {};
    return res.exceptionDetails ? `ERROR ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}` : res.result?.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const c of cmds) {
    const i = c.indexOf(':');
    const k = i < 0 ? c : c.slice(0, i);
    const v = i < 0 ? '' : c.slice(i + 1);
    if (k === 'key') {
      const key = v === 'Space' ? ' ' : v;
      const ev = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: KEYS[key] || key.charCodeAt(0) };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ev });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev });
      await sleep(450);
    } else if (k === 'where') {
      console.log(`${v ? v + ': ' : ''}${await evaluate(WHERE)}`);
    } else if (k === 'eval' || k === 'evalf') {
      console.log(JSON.stringify(await evaluate(k === 'evalf' ? fs.readFileSync(v, 'utf8') : v)));
    } else if (k === 'url') {
      await send('Runtime.evaluate', { expression: `location.href = ${JSON.stringify(v)}` });
    } else if (k === 'wait') {
      await sleep(Number(v));
    } else if (k === 'shot') {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(v, Buffer.from(r.result.data, 'base64'));
      console.log('shot', v);
    } else if (k === 'mmove' || k === 'mclick') {
      const [x, y] = v.split(',').map(Number);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      if (k === 'mclick') {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      }
    } else {
      console.error(`unknown command: ${c}`);
    }
  }
  ws.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
