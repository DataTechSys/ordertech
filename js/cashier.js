(async function initVideo(){
  const local = document.getElementById('localVideo');
  const remote = document.getElementById('remoteVideo');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: {ideal: 1280}, height: {ideal: 720} },
      audio: false
    });
    local.srcObject = stream;
  } catch (err) {
    console.warn('Camera unavailable:', err);
    local.poster = '/images/video-placeholder.png';
  }
  local.addEventListener('loadedmetadata', () => {
    try { if (!remote.srcObject) remote.srcObject = local.srcObject; } catch {}
  });
  function keepPipOnTop(){ remote.style.zIndex = 10; }
  window.addEventListener('resize', keepPipOnTop, {passive:true});
  keepPipOnTop();
})();
