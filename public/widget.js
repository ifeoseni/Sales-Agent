// Drop-in chat bubble: <script src="https://YOUR-AGENT-HOST/widget.js" defer></script>
(() => {
  const origin = new URL(document.currentScript.src).origin;
  const btn = document.createElement('button');
  btn.setAttribute('aria-label', 'Chat with us');
  btn.textContent = '💬';
  btn.style.cssText = 'position:fixed;right:18px;bottom:18px;width:56px;height:56px;border-radius:50%;border:0;background:#0b6e4f;color:#fff;font-size:26px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);z-index:2147483646';
  const frame = document.createElement('iframe');
  frame.title = 'Chat';
  frame.style.cssText = 'position:fixed;right:18px;bottom:86px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);border:1px solid #e3e6ec;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);z-index:2147483646;display:none;background:#fff';
  let loaded = false;
  btn.onclick = () => {
    const open = frame.style.display === 'none';
    if (open && !loaded) { frame.src = origin + '/embed.html'; loaded = true; }
    frame.style.display = open ? 'block' : 'none';
    btn.textContent = open ? '✕' : '💬';
  };
  document.body.append(frame, btn);
})();
