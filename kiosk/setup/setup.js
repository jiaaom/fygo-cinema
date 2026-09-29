// Fygo Cinema's setup / status screen (see index.html). OK retries (the
// kiosk's main process decides what that means); nothing else to do here.
'use strict';

const q = new URLSearchParams(location.search);
const state = q.get('state') || 'no-account';
const msg = q.get('msg') || '';
const url = q.get('url') || '';
const lang = (q.get('lang') || navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';

const T = {
  en: {
    'no-account': {
      title: 'One more step',
      lead: 'Fygo Cinema needs the Fygo TV account this TV should sign in with.',
      steps: [
        'On a phone or computer, scan the code or open <b>{url}</b>',
        'Sign in to fnOS as an administrator and open <b>Fygo Cinema</b>',
        'Under <b>Account</b>, enter the Fygo TV username and password',
      ],
      hint: 'The TV continues by itself once the account is saved.',
    },
    failed: {
      title: 'Couldn’t sign in',
      lead: 'Fygo TV did not accept the account stored in Fygo Cinema.',
      steps: [
        'On a phone or computer, scan the code or open <b>{url}</b>',
        'Sign in to fnOS as an administrator and open <b>Fygo Cinema</b>',
        'Under <b>Account</b>, enter the username and password again',
      ],
      hint: 'The TV tries again by itself once the account is saved. Press <kbd>OK</kbd> to try again now.',
    },
    connecting: {
      title: 'Connecting to Fygo TV…',
      lead: 'The media server is starting or updating.',
      steps: [],
      hint: 'This screen goes away by itself as soon as Fygo TV answers.',
    },
  },
  zh: {
    'no-account': {
      title: '还差一步',
      lead: 'Fygo Cinema 需要一个飞牛影视账户，电视将用它登录。',
      steps: [
        '在手机或电脑上扫码，或打开 <b>{url}</b>',
        '以管理员身份登录 fnOS，打开 <b>Fygo Cinema</b>',
        '在 <b>账户</b> 中输入飞牛影视的用户名和密码',
      ],
      hint: '保存账户后，电视会自动继续。',
    },
    failed: {
      title: '无法登录',
      lead: '飞牛影视没有接受 Fygo Cinema 中保存的账户。',
      steps: [
        '在手机或电脑上扫码，或打开 <b>{url}</b>',
        '以管理员身份登录 fnOS，打开 <b>Fygo Cinema</b>',
        '在 <b>账户</b> 中重新输入用户名和密码',
      ],
      hint: '保存账户后电视会自动重试。按 <kbd>OK</kbd> 立即重试。',
    },
    connecting: {
      title: '正在连接飞牛影视…',
      lead: '媒体服务器正在启动或更新。',
      steps: [],
      hint: '飞牛影视一响应，这个画面就会自动消失。',
    },
  },
};

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const t = T[lang][state] || T[lang]['no-account'];
const $ = (id) => document.getElementById(id);

document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
$('title').textContent = t.title;
$('lead').textContent = t.lead;
if (state === 'failed' && msg) {
  $('reason').hidden = false;
  $('reason').textContent = msg;
}
if (t.steps.length) {
  $('steps').hidden = false;
  $('steps').innerHTML = t.steps.map((s) => `<li>${s.replace('{url}', esc(url || 'fnOS'))}</li>`).join('');
}
$('hint').innerHTML = t.hint;

if (state === 'connecting') {
  document.querySelector('.card').classList.add('connecting');
  $('spinner').hidden = false;
} else if (url && typeof qrcode === 'function') {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
  $('url').textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  $('qrBox').hidden = false;
}

// OK: try again (reload what the main process thinks is right)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (window.cinema && window.cinema.retry) window.cinema.retry();
  }
});
